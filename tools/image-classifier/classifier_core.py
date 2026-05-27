"""
classifier_core.py — Lógica compartida entre classify_siglip.py (local) y
modal_app.py (cloud). Garantiza paridad funcional: ambos clasificadores
usan EXACTAMENTE las mismas constantes, validators, fórmulas de scoring,
construcción de tags y prompts de discovery.

Antes del refactor (issue #37), la lógica estaba duplicada con ligeras
divergencias que causaban bugs sutiles. Ahora vive aquí y los dos archivos
solo orquestan el IO específico (filesystem local vs R2 cloud, Modal
container vs proceso Python local).

⚠ Algunas funciones requieren `torch` instalado — son llamadas solo desde
contextos que ya lo tienen (classify_siglip.py local con venv, GPU container
de Modal). El módulo a NIVEL DE IMPORTACIÓN no importa torch para que
módulos sin torch (como `compute_prototypes_local` orchestrator parts)
puedan importarlo sin crashear.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import torch
    from torch import Tensor


# ── Configuración del modelo ────────────────────────────────────────────
MODEL_ID         = "google/siglip-base-patch16-256"

# ── Parámetros de scoring (sincronizados, single source of truth) ───────
THRESHOLD        = 0.15   # score sigmoid >= esto → tag "confident"
TOP_K            = 5      # máximo absoluto de tags por imagen
ALWAYS_KEEP_TOP  = 3      # los primeros N tags se mantienen si >= MIN_SCORE
MIN_SCORE        = 0.05   # piso absoluto — debajo no se emite el tag
CONFIRMED_BOOST  = 0.30   # confirmación admin sube score mínimo a este valor
NEG_WEIGHT_DEFAULT = 0.5  # peso de los prompts negativos en el final score

# ── Constantes Fase C: kNN sobre prototipos ─────────────────────────────
KNN_MIN_PROTOS         = 3      # mínimo de protos para aplicar ajuste
KNN_SIM_THRESHOLD      = 0.60   # similitud coseno mínima para que el match "cuente"
KNN_BOOST_WEIGHT       = 0.20   # multiplier del boost positivo
KNN_PENALTY_WEIGHT     = 0.20   # multiplier del penalty negativo
KNN_UNCERTAIN_LO       = 0.05   # zona incierta low bound (boost solo aquí)
KNN_UNCERTAIN_HI       = 0.70   # zona incierta high bound

# Cuántos labels "más relevantes" enviamos al modelo Gemini/Groq en el
# prompt de discovery (en lugar de los ~118 existing_ids completos).
TOP_RELEVANT_FOR_DISCOVERY = 25

# ── Discovery (auto-vocab via Gemini/Groq) ──────────────────────────────
GEMINI_MODEL_ID = "gemini-2.5-flash"
GROQ_MODEL_ID   = "meta-llama/llama-4-scout-17b-16e-instruct"

# IMPORTANTE: sincronizar con `CATEGORIES` en
# `src/app/admin/images-bank/labelMetadata.ts`. Si Groq/Gemini sugiere un
# label con categoría no listada aquí, el validator la RECHAZA.
VALID_CATEGORIES_LIST = [
    "Escenas",
    "Vehículos",
    "Señalización (forma)",
    "Señalización (tipo)",
    "Señales específicas",
    "Interior coche",
    "Factor vehículo",
    "Factor humano",
    "Controles policiales",
    "Condiciones",
    "Peatones y convivencia",
    "Especiales",
]
VALID_CATEGORIES = set(VALID_CATEGORIES_LIST)

# Prompt compartido entre Gemini y Groq. Single source of truth.
DISCOVERY_PROMPT_TEMPLATE = (
    """You are extending a SigLIP zero-shot classifier's vocabulary for Spanish driving theory test (DGT) images.

CONTEXT — the SigLIP base model already scored this image against ~118 existing labels. The top labels (by similarity to this image) are listed below with their scores. These are the labels MOST RELATED to this image — do NOT propose anything semantically duplicate to them, but feel free to propose something COMPLEMENTARY or more SPECIFIC.

TOP EXISTING LABELS related to this image (top {n_top} by SigLIP score, do NOT propose duplicates):
{top_relevant}

There are ~{n_other} other labels in the vocabulary not shown here (less related to this image). The validator will reject any duplicate id we already have — but choose snake_case ids that are clearly novel concepts to maximize the chance of acceptance.

VALID CATEGORIES (use exactly one of these strings):
"""
    + "\n".join(f"- {c}" for c in VALID_CATEGORIES_LIST)
    + """

YOUR TASK:
Suggest 1 to 3 NEW classification labels for the image. Each label is a CLASSIFIER CATEGORY (like "stop_sign" or "rainy_road"), NOT a caption of the image. If nothing truly new is needed, return {{"labels": []}}.

OUTPUT FORMAT — you MUST return a JSON object with a single key "labels":
{{"labels": [ <label_object>, ... ]}}

Each label_object has EXACTLY these 4 fields:
{{
  "id":        "snake_case_english_id (max 30 chars)",
  "displayEs": "Texto en español (2-5 palabras)",
  "category":  "<exact category string from the list above>",
  "prompts":   ["sentence 1", "sentence 2", "sentence 3"]
}}

The "prompts" array must contain EXACTLY 3 English sentences of 8-25 words each that describe what this label looks like visually. They go INSIDE the label object, not at the top level.

❌ WRONG — plain strings at top level (REJECTED immediately):
{{"labels": ["a wide road with a divider", "a highway", "guardrails"]}}

✅ CORRECT — objects with the sentences inside "prompts":
{{
  "labels": [
    {{
      "id": "divided_highway",
      "displayEs": "Carretera dividida",
      "category": "Escenas",
      "prompts": [
        "a wide road with a central median divider separating two directions of traffic",
        "a highway with two lanes in each direction split by a grassy or barrier median",
        "a divided road with guardrails along both sides and a separator in the middle"
      ]
    }}
  ]
}}

Return ONLY the JSON object. No markdown fences. No explanatory text."""
)


# ── Estado compartido del discovery ─────────────────────────────────────
class GeminiState:
    """Estado del flujo Gemini durante un run. Compartido entre clasificadores."""
    def __init__(self) -> None:
        self.available: bool         = True
        self.disabled_reason: str    = ""
        self.calls_made: int         = 0
        self.suggestions_added: int  = 0
        self.images_with_gemini: int = 0


class GroqState:
    """Estado de Groq (paralelo a GeminiState)."""
    def __init__(self) -> None:
        self.available: bool         = True
        self.disabled_reason: str    = ""
        self.calls_made: int         = 0
        self.suggestions_added: int  = 0
        self.images_with_groq: int   = 0


# Buffer global de sugerencias RECHAZADAS por validate_discovery_suggestion.
# Cada clasificador puede leerlo al final del run para persistir el audit.
REJECTED_SUGGESTIONS: list[dict] = []


# ── Utilities ───────────────────────────────────────────────────────────

def mime_of_filename(name: str) -> str:
    """Mime type a partir del filename (no del path completo)."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext == "png":  return "image/png"
    if ext == "webp": return "image/webp"
    return "image/jpeg"


def format_top_relevant(top_relevant: list[tuple[str, float]]) -> str:
    """Renderiza top-N labels como lista markdown para el prompt:
        - urban_street          (score 0.42)
        - intersection          (score 0.31)
    """
    if not top_relevant:
        return "(no labels with significant score for this image)"
    lines = []
    for lid, sc in top_relevant:
        lines.append(f"- {lid:<30s} (score {sc:.3f})")
    return "\n".join(lines)


def render_discovery_prompt(
    top_relevant:  list[tuple[str, float]],
    total_labels:  int,
) -> str:
    """Genera el prompt completo para Gemini/Groq. Single source of truth."""
    n_other = max(0, total_labels - len(top_relevant))
    return DISCOVERY_PROMPT_TEMPLATE.format(
        top_relevant=format_top_relevant(top_relevant),
        n_top=len(top_relevant),
        n_other=n_other,
    )


# ── Validación de sugerencias Gemini/Groq ───────────────────────────────

def validate_discovery_suggestion(
    s:            object,
    existing_ids: set[str],
    image_name:   str = "?",
) -> Optional[dict]:
    """Valida una sugerencia de label de Gemini/Groq. Devuelve dict normalizado
    o None si es inválida/duplicada. Si rechaza, registra el motivo en
    REJECTED_SUGGESTIONS (global del módulo) para audit posterior.

    Reglas de validación:
      - dict con campos id, displayEs, category, prompts
      - id: snake_case lowercase, máx 30 chars, único respecto a existing_ids
      - displayEs: no vacío, máx 60 chars
      - category: ∈ VALID_CATEGORIES
      - prompts: lista de exactamente 3 strings, cada uno con 8-25 palabras
    """
    def reject(reason: str) -> None:
        REJECTED_SUGGESTIONS.append({
            "image":      image_name,
            "rejectedAt": datetime.now(timezone.utc).isoformat(),
            "reason":     reason,
            "suggestion": s if isinstance(s, dict) else {"raw": str(s)[:200]},
        })

    if not isinstance(s, dict):
        reject("not a dict")
        return None
    sid = str(s.get("id", "")).strip()
    if not sid:
        reject("id vacío")
        return None
    if len(sid) > 30:
        reject(f"id demasiado largo ({len(sid)} > 30): {sid}")
        return None
    if not sid.replace("_", "").isalnum() or not sid.islower():
        reject(f"id no es snake_case lowercase: {sid}")
        return None
    if sid in existing_ids:
        reject(f"id ya existe (duplicate): {sid}")
        return None
    display = str(s.get("displayEs", "")).strip()
    if not display:
        reject(f"displayEs vacío (id={sid})")
        return None
    if len(display) > 60:
        reject(f"displayEs demasiado largo ({len(display)} > 60) (id={sid})")
        return None
    cat = str(s.get("category", "")).strip()
    if cat not in VALID_CATEGORIES:
        reject(f"category inválida '{cat}' (id={sid}); válidas: {sorted(VALID_CATEGORIES)}")
        return None
    prompts = s.get("prompts")
    if not isinstance(prompts, list):
        reject(f"prompts no es list (id={sid})")
        return None
    if len(prompts) != 3:
        reject(f"prompts debe tener exactamente 3 elementos, tiene {len(prompts)} (id={sid})")
        return None
    bad_prompts = [
        (i, len(p.split()) if isinstance(p, str) else "not-str")
        for i, p in enumerate(prompts)
        if not (isinstance(p, str) and 8 <= len(p.split()) <= 25)
    ]
    if bad_prompts:
        reject(f"prompts mal formados (id={sid}): {bad_prompts} — deben ser strings de 8-25 palabras")
        return None
    return {
        "id":        sid,
        "displayEs": display,
        "category":  cat,
        "prompts":   [p.strip() for p in prompts],
    }


# ── Funciones que requieren torch — lazy import dentro ──────────────────

def encode_label_embedding(
    processor,
    model,
    prompts: list[str],
    device,
):
    """Codifica una LISTA de prompts (ensemble de 1 label), promedia en la
    esfera unitaria y devuelve un tensor 1×emb_dim. Reusable para añadir
    discovered labels en caliente o para re-codificar tras refinements.
    """
    import torch
    with torch.no_grad():
        ti  = processor(text=prompts, padding="max_length", return_tensors="pt").to(device)
        e   = model.get_text_features(**ti)
        e   = e / e.norm(dim=-1, keepdim=True)
        avg = e.mean(dim=0, keepdim=True)
        avg = avg / avg.norm(dim=-1, keepdim=True)
    return avg


def compute_text_embeds_for_labels(
    processor,
    model,
    labels:           list[tuple[str, list[str]]],
    device,
):
    """Pre-computa el embedding por label haciendo ensemble + avg + L2 normalize.

    Args:
      labels: list[(label_id, [prompts])]
    Returns:
      (label_ids: list[str], text_embeds: Tensor N×D, emb_dim: int)
    """
    import torch
    label_ids:        list[str] = []
    flat_prompts:     list[str] = []
    prompt_to_label:  list[int] = []
    for li, (lid, prompts) in enumerate(labels):
        label_ids.append(lid)
        for p in prompts:
            flat_prompts.append(p)
            prompt_to_label.append(li)

    with torch.no_grad():
        ti  = processor(text=flat_prompts, padding="max_length", return_tensors="pt").to(device)
        raw = model.get_text_features(**ti)
        raw = raw / raw.norm(dim=-1, keepdim=True)
    n_labels = len(label_ids)
    emb_dim  = raw.shape[1]
    text_embeds = torch.zeros((n_labels, emb_dim), device=device, dtype=raw.dtype)
    counts      = torch.zeros(n_labels, device=device, dtype=raw.dtype)
    for i, li in enumerate(prompt_to_label):
        text_embeds[li] += raw[i]
        counts[li]      += 1
    text_embeds = text_embeds / counts.unsqueeze(-1)
    text_embeds = text_embeds / text_embeds.norm(dim=-1, keepdim=True)
    return label_ids, text_embeds, emb_dim


def compute_neg_text_embeds_for_labels(
    processor,
    model,
    label_ids:       list[str],
    label_negatives: dict[str, list[str]],
    emb_dim:         int,
    device,
    dtype,
):
    """Pre-computa neg_text_embeds + has_neg_mask. Vector cero para labels
    sin negativos. Misma técnica de ensemble + avg + normalize.

    Returns:
      (neg_text_embeds: Tensor N×D, has_neg_mask: Tensor N)
    """
    import torch
    n_labels = len(label_ids)
    neg_text_embeds = torch.zeros((n_labels, emb_dim), device=device, dtype=dtype)
    has_neg_mask    = torch.zeros(n_labels, device=device, dtype=dtype)
    for li, lid in enumerate(label_ids):
        neg_prompts = label_negatives.get(lid)
        if not neg_prompts:
            continue
        try:
            neg_emb = encode_label_embedding(processor, model, neg_prompts, device)
            neg_text_embeds[li] = neg_emb.squeeze(0)
            has_neg_mask[li]    = 1.0
        except Exception as e:  # noqa: BLE001
            print(f"   ⚠  No se pudo codificar negativo de '{lid}': {e}", flush=True)
    return neg_text_embeds, has_neg_mask


def build_proto_tensors(
    prototypes_data: dict,
    emb_dim:         int,
    device,
    dtype,
):
    """Convierte JSON de prototipos a tensores GPU normalizados L2.

    Args:
      prototypes_data: dict[lid, {positive: [{embedding}], negative: [...]}]
    Returns:
      (proto_pos: dict[lid, Tensor N_pos×D], proto_neg: dict[lid, Tensor N_neg×D])
    """
    import torch
    proto_pos: dict[str, "Tensor"] = {}
    proto_neg: dict[str, "Tensor"] = {}
    if not prototypes_data:
        return proto_pos, proto_neg

    for lid, data in prototypes_data.items():
        if not isinstance(data, dict):
            continue
        for sign_key, target_dict in [("positive", proto_pos), ("negative", proto_neg)]:
            items = data.get(sign_key)
            if not isinstance(items, list) or len(items) < KNN_MIN_PROTOS:
                continue
            vectors: list[list[float]] = []
            for it in items:
                if not isinstance(it, dict):
                    continue
                emb = it.get("embedding")
                if isinstance(emb, list) and len(emb) == emb_dim:
                    vectors.append(emb)
            if len(vectors) < KNN_MIN_PROTOS:
                continue
            tensor = torch.tensor(vectors, device=device, dtype=dtype)
            # Re-normalizar defensivo — el cómputo coseno requiere unit vectors
            tensor = tensor / tensor.norm(dim=-1, keepdim=True)
            target_dict[lid] = tensor
    return proto_pos, proto_neg


def apply_knn_adjustments(
    probs,         # (N, L) — se modifica IN-PLACE y se devuelve
    img_embeds,    # (N, D)
    label_ids:     list[str],
    proto_pos:     dict,
    proto_neg:     dict,
):
    """Aplica boost (zona incierta) y penalty (siempre) a `probs` basado en
    similitud coseno con los prototipos kNN. Devuelve probs clamp [0,1].

    Boost: img muy similar a proto+ del label, SOLO si score en zona
           incierta (0.05–0.70).
    Penalty: img muy similar a proto- del label, SIEMPRE (corrige falsos+).
    """
    import torch
    if not proto_pos and not proto_neg:
        return probs

    for li, lid in enumerate(label_ids):
        if lid in proto_pos:
            pp = proto_pos[lid]
            sim_pos     = img_embeds @ pp.T          # (n_imgs, N_pos)
            max_sim_pos = sim_pos.max(dim=1).values  # (n_imgs,)
            boost       = torch.clamp(max_sim_pos - KNN_SIM_THRESHOLD, min=0) * KNN_BOOST_WEIGHT
            score_col   = probs[:, li]
            uncertain   = (score_col > KNN_UNCERTAIN_LO) & (score_col < KNN_UNCERTAIN_HI)
            probs[:, li] = score_col + boost * uncertain.to(probs.dtype)
        if lid in proto_neg:
            pn = proto_neg[lid]
            sim_neg     = img_embeds @ pn.T
            max_sim_neg = sim_neg.max(dim=1).values
            penalty     = torch.clamp(max_sim_neg - KNN_SIM_THRESHOLD, min=0) * KNN_PENALTY_WEIGHT
            probs[:, li] = probs[:, li] - penalty
    return probs.clamp(0.0, 1.0)


def score_image_batch(
    img_embeds,        # (N, D) — assumed L2-normalized
    text_embeds,       # (L, D) — assumed L2-normalized
    neg_text_embeds,   # (L, D)
    has_neg_mask,      # (L,)
    logit_scale,
    logit_bias,
    label_ids:        list[str],
    proto_pos:        dict,
    proto_neg:        dict,
    neg_weight:       float = NEG_WEIGHT_DEFAULT,
):
    """Calcula probs (N, L) finales aplicando:
      1. SigLIP scoring: sigmoid(img @ text.T * scale + bias)
      2. Penalización por prompts negativos: probs - neg_weight × neg_probs
      3. Clamp [0, 1]
      4. Ajuste kNN sobre prototipos (boost + penalty)

    Returns: Tensor (N, L) en [0, 1].
    """
    import torch
    logits     = img_embeds @ text_embeds.T * logit_scale + logit_bias
    probs      = torch.sigmoid(logits)
    neg_logits = img_embeds @ neg_text_embeds.T * logit_scale + logit_bias
    neg_probs  = torch.sigmoid(neg_logits) * has_neg_mask
    probs      = (probs - neg_weight * neg_probs).clamp(0.0, 1.0)
    probs      = apply_knn_adjustments(probs, img_embeds, label_ids, proto_pos, proto_neg)
    return probs


# ── Construcción de tags ────────────────────────────────────────────────

def build_tags_from_scores(
    all_scores:         dict[str, float],
    sha_exclusions:     set[str],
    sha_confirmations:  set[str],
    threshold:          float = THRESHOLD,
    top_k:              int   = TOP_K,
    always_keep_top:    int   = ALWAYS_KEEP_TOP,
    min_score:          float = MIN_SCORE,
    confirmed_boost:    float = CONFIRMED_BOOST,
) -> tuple[list[dict], dict[str, float]]:
    """Construye `tags[]` aplicando confirmaciones (boost a `confirmed_boost`
    si score < threshold), exclusiones (filter ANTES del top-K), y la regla
    de dos niveles (rank 1..N siempre si >= min_score; rank N+1..top_k solo
    si >= threshold).

    Returns:
      (tags: list[dict], all_scores_post_boost: dict[str, float])
      donde tags entries son {tag, score, confident, humanConfirmed?}.
      all_scores_post_boost se devuelve por si el caller quiere persistirlo
      con los boosts ya aplicados.
    """
    # 1. Aplicar CONFIRMACIONES primero — boost del score si era bajo
    scores = dict(all_scores)
    for conf_tag in sha_confirmations:
        if conf_tag in scores and scores[conf_tag] < confirmed_boost:
            scores[conf_tag] = confirmed_boost

    # 2. Aplicar EXCLUSIONES — filter antes del top-K
    filtered = [(lid, sc) for lid, sc in scores.items() if lid not in sha_exclusions]
    candidates = sorted(filtered, key=lambda x: -x[1])[:top_k]

    # 3. Construir tags con la regla de dos niveles
    tags: list[dict] = []
    for rank, (lid, score) in enumerate(candidates):
        if score < min_score:
            break  # están sorted desc → todo lo siguiente también será < min_score
        if rank >= always_keep_top and score < threshold:
            continue  # extras (rank N+1..top_k) solo si pasan threshold
        tag_entry: dict = {
            "tag":       lid,
            "score":     round(float(score), 4),
            "confident": score >= threshold,
        }
        # Marcar el flag humanConfirmed para que la UI muestre el badge verde
        # y el JSON sea self-contained sin necesidad de cruzar con
        # tag_confirmations.json en runtime.
        if lid in sha_confirmations:
            tag_entry["humanConfirmed"] = True
        tags.append(tag_entry)
    return tags, scores


# ── Persistencia de rejected_suggestions ────────────────────────────────

def build_rejected_suggestions_payload() -> Optional[dict]:
    """Construye el payload de REJECTED_SUGGESTIONS para subir a R2 o
    guardar en filesystem. Devuelve None si no hay rejected (skip upload).
    """
    if not REJECTED_SUGGESTIONS:
        return None
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count":       len(REJECTED_SUGGESTIONS),
        "note":        "Sugerencias de Gemini/Groq descartadas por el validator. "
                       "Revisa los `reason` para entender qué fallaba. Si alguna "
                       "es legítima (ej. categoría que olvidaste añadir), puedes "
                       "actualizar VALID_CATEGORIES o el code y volver a correr.",
        "rejected":    list(REJECTED_SUGGESTIONS),
    }


def reset_rejected_suggestions() -> None:
    """Vacía el buffer global. Útil entre runs si el caller comparte proceso."""
    REJECTED_SUGGESTIONS.clear()


# ── Self-test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Smoke test de las partes que NO requieren torch
    print(f"MODEL_ID: {MODEL_ID}")
    print(f"THRESHOLD: {THRESHOLD}  TOP_K: {TOP_K}  MIN_SCORE: {MIN_SCORE}")
    print(f"KNN: min_protos={KNN_MIN_PROTOS}, sim_threshold={KNN_SIM_THRESHOLD}, boost={KNN_BOOST_WEIGHT}")
    print(f"VALID_CATEGORIES: {len(VALID_CATEGORIES)} categorías")
    print(f"DISCOVERY_PROMPT_TEMPLATE: {len(DISCOVERY_PROMPT_TEMPLATE)} chars")

    # Test format_top_relevant
    sample = [("urban_street", 0.42), ("intersection", 0.31), ("crosswalk", 0.18)]
    print("\nformat_top_relevant sample:")
    print(format_top_relevant(sample))

    # Test render_discovery_prompt
    prompt = render_discovery_prompt(sample, total_labels=118)
    print(f"\nrender_discovery_prompt: {len(prompt)} chars (con top-relevant inyectado)")

    # Test validate_discovery_suggestion
    valid = {
        "id":        "test_label",
        "displayEs": "Test label",
        "category":  "Escenas",
        "prompts":   [
            "a test prompt with at least eight words required",
            "another sample prompt for validation purposes with eight words minimum",
            "third valid sentence for the test suggestion entry with extra words",
        ],
    }
    result = validate_discovery_suggestion(valid, set(), "test.png")
    print(f"\nvalidate_discovery_suggestion(valid_input): {'OK' if result else 'FAIL'}")

    # Test build_tags_from_scores
    all_scores = {"a": 0.42, "b": 0.18, "c": 0.03, "d": 0.55}
    tags, _ = build_tags_from_scores(all_scores, set(), set())
    print(f"\nbuild_tags_from_scores: {len(tags)} tags emitidos:")
    for t in tags:
        print(f"  {t}")

    print(f"\n[OK] classifier_core.py self-test passed")
