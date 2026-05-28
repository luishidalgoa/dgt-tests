"""
Multi-label classification de las imágenes sanitizadas usando SigLIP.

Tercer paso del pipeline de banco de imágenes propio:

    sha-audit.json       sanitize-images.ts       classify_siglip.py
    (2.6k archivos)  →   (1748 únicos)        →   classification.json
                         public/images/sanitize/   (sha → tags)

Por qué SigLIP y no TensorFlow puro:
  - SigLIP (Google, abierto, en transformers) es la versión mejorada de
    CLIP con loss sigmoid en lugar de softmax. Eso lo hace nativo para
    multi-label: por cada (imagen, etiqueta) devuelve una prob sigmoid
    independiente que se puede umbralar. Las MobileNet/EfficientNet de
    TensorFlow puro están entrenadas con softmax sobre clases fijas de
    ImageNet — no entienden "intersección urbana con bici" o "señal de
    prohibición circular roja". SigLIP entiende cualquier prompt en
    lenguaje natural y puntúa.
  - Sin entrenamiento: defines la lista de etiquetas en LABELS más abajo
    y listo.
  - Corre en CPU sin drama (~1-2s/imagen con base-patch16-256). Para 1748
    imágenes son ~30-45 min en un portátil decente. Puedes ir a comer.

Output: tools/image-audit/classification.json con la estructura:

  {
    "generatedAt": "2026-05-25T...",
    "model": "google/siglip-base-patch16-256",
    "threshold": 0.5,
    "labels": [...],          # lista usada con prompts
    "images": {
      "<sha>": {
        "filename": "<sha>.png",
        "tags": [
          {"tag": "car", "score": 0.85},
          {"tag": "intersection", "score": 0.72}
        ],
        "allScores": {        # todos los scores por si re-umbralas luego
          "urban_street": 0.12, "car": 0.85, ...
        }
      }
    },
    "stats": {
      "tagCounts": {...},
      "imagesWithoutTags": ...
    }
  }

Como el SHA es la key, joinear este JSON con sha-audit.json es trivial:
    tags + questions_que_la_usan + filenames originales.

Esa es la "referencia de metadatos suficiente para buscar el reemplazo"
de la que hablabas — sabes qué tipo de imagen necesitas y a qué preguntas
afectará.

Uso:
    cd tools/image-classifier
    python -m venv .venv
    # Windows:
    .venv\\Scripts\\activate
    # macOS/Linux:
    source .venv/bin/activate
    pip install -r requirements.txt
    python classify_siglip.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import torch
from PIL import Image
from tqdm import tqdm
from transformers import AutoModel, AutoProcessor

# Gemini SDK — import opcional. Si no está instalado, el flujo sigue
# funcionando sin auto-discovery (solo SigLIP).
try:
    from google import genai as google_genai
    from google.genai import types as genai_types
except ImportError:
    google_genai = None  # type: ignore
    genai_types  = None  # type: ignore

# Groq SDK — proveedor alternativo / fallback de Gemini. Mismo prompt,
# diferente provider → cuotas independientes. Útil cuando Gemini se queda
# sin quota (free tier de Gemini Flash es de ~250 req/día, Groq free es
# ~14400 req/día con Llama 4 Scout).
try:
    from groq import Groq as GroqClient
except ImportError:
    GroqClient = None  # type: ignore

import base64 as _b64

# ── Config (defaults — override via CLI args) ───────────────────────────
ROOT               = Path(__file__).resolve().parent.parent.parent
# Las imágenes únicas viven directamente en public/images/ (sin sub-carpeta
# sanitize/). Si tienes otra disposición, pásala con --input-dir.
DEFAULT_INPUT_DIR  = ROOT / "public" / "images"
DEFAULT_OUTPUT     = ROOT / "tools" / "image-audit" / "classification.json"
MODEL_ID           = "google/siglip-base-patch16-256"
BATCH              = 16        # CPU-friendly. Si tienes RAM de sobra súbelo a 32.
CHECKPOINT_EVERY   = 80        # guarda parcial cada N imgs (5 batches → ~4-5% del progreso)

# Estrategia de tags (v2 — adaptada tras observar que SigLIP base con un
# único prompt "photographic" no reconoce el estilo ilustrativo DGT):
#
#   THRESHOLD: score sigmoid a partir del cual consideramos el tag de
#     "alta confianza" (`confident: true` en el JSON). Marca el flag
#     pero también se usa para filtrar tags "extras" (ver ALWAYS_KEEP_TOP).
#
#   TOP_K: máximo absoluto de tags por imagen.
#
#   ALWAYS_KEEP_TOP: los primeros N tags por score se incluyen siempre
#     (mientras pasen MIN_SCORE) aunque su score sea bajo — nos garantiza
#     información mínima para matching downstream. A partir del N+1, los
#     siguientes solo se incluyen si pasan THRESHOLD (filtra ruido en la
#     cola larga).
#
#   MIN_SCORE: piso absoluto — los tags con score < esto se descartan
#     siempre, incluso en el top-N. Evita ruido garbage cuando el modelo
#     realmente no entiende la imagen.
#
# Comportamiento final:
#   Rank 1-N (ALWAYS_KEEP_TOP):  score >= MIN_SCORE → se emite
#   Rank N+1 hasta TOP_K:        score >= THRESHOLD → se emite
# Constantes movidas a `classifier_core.py` para single source of truth
# entre local (este archivo) y cloud (modal_app.py).
# Re-import limpio (mismos nombres) — el resto del código sigue funcionando
# sin cambios. Solo `CONFIRMED_TAG_MIN_SCORE` se mantiene como alias del
# nuevo nombre `CONFIRMED_BOOST` en core (retrocompat).
from classifier_core import (  # noqa: E402
    THRESHOLD, TOP_K, ALWAYS_KEEP_TOP, MIN_SCORE,
    KNN_MIN_PROTOS, KNN_SIM_THRESHOLD, KNN_BOOST_WEIGHT, KNN_PENALTY_WEIGHT,
    KNN_UNCERTAIN_LO, KNN_UNCERTAIN_HI,
    CONFIRMED_BOOST as CONFIRMED_TAG_MIN_SCORE,  # alias retrocompat
)

# Cuántos labels "más relevantes" enviamos en el prompt a Gemini/Groq
# (en lugar de los ~118 existing_ids completos — reduce tokens y mejora
# tasa de aceptación de sugerencias nuevas).
TOP_RELEVANT_FOR_DISCOVERY = 25

# Variables que se asignan en main() leyendo los args. Las dejamos como
# placeholder a nivel de módulo para que las funciones auxiliares (write_output,
# _build_payload) puedan referenciarlas sin pasarlas explícitamente.
INPUT_DIR: Path           = DEFAULT_INPUT_DIR
OUTPUT:    Path           = DEFAULT_OUTPUT
GENERATED_AT_BEGIN: str   = ""

# ── Auto-discovery con Gemini (opcional) ────────────────────────────────
# Cuando SigLIP no consigue un tag confident para una imagen, opcionalmente
# llamamos a Gemini con la imagen y le pedimos que sugiera 1-3 labels
# nuevos (id, display español, categoría, 3 prompts). Los nuevos labels se
# añaden en tiempo de ejecución al vocabulario (text_embeds) y se persisten
# en `discovered_labels.json` para que futuros runs los hereden.
#
# Activación: setea env var GEMINI_API_KEY. Si no está, el clasificador
# corre normal sin Gemini.
#
# Tolerancia a errores: si Gemini falla por quota (429/rate limit), se
# desactiva para el resto del run — NO se vuelve a intentar. Otros errores
# (red, JSON malformado) se loguean y se sigue.
DISCOVERED_LABELS_PATH = ROOT / "tools" / "image-audit" / "discovered_labels.json"
# Refinamientos de prompts producidos por refine_labels.py (Fase B). Cuando
# un label tiene refinement, el classifier REEMPLAZA los prompts originales
# de LABELS y LABEL_NEGATIVES por los refinados. Persist en R2 también
# (meta/refined_labels.json) — pero como classify_siglip.py local lee
# filesystem, sincronizar antes con `npm run images:download-metadata`.
REFINED_LABELS_PATH    = ROOT / "tools" / "image-audit" / "refined_labels.json"
# Prototipos kNN (Fase C). Embeddings SigLIP de imgs confirmadas/excluidas
# por humanos. Compute via `npm run images:compute-prototypes` (Modal GPU).
# Local lee filesystem — sincronizar con `npm run images:download-metadata`.
PROTOTYPES_PATH        = ROOT / "tools" / "image-audit" / "prototypes.json"
# Exclusiones manuales de tags por imagen (sha → [tags excluidos]).
# Gestionado por el admin desde el banco web (swipe Tinder). El
# classifier las respeta — tags excluidos NO se emiten aunque el score
# sea alto. Si el archivo no existe, no hay exclusiones.
TAG_EXCLUSIONS_PATH         = ROOT / "tools" / "image-audit" / "tag_exclusions.json"
TAG_CONFIRMATIONS_PATH      = ROOT / "tools" / "image-audit" / "tag_confirmations.json"
MANUAL_TAGS_PATH            = ROOT / "tools" / "image-audit" / "manual_tags.json"
MANUAL_TAGS_HISTORY_PATH    = ROOT / "tools" / "image-audit" / "manual_tags_history.json"

# CONFIRMED_TAG_MIN_SCORE viene de classifier_core (re-import al inicio
# del archivo, con alias `CONFIRMED_BOOST as CONFIRMED_TAG_MIN_SCORE`).
# Sincronizado con `CONFIRMED_TAG_MIN_SCORE` en lib.ts (frontend) y con
# `CONFIRMED_BOOST` en modal_app.py — todos derivan del core.
# Cache de embeddings de imagen (visión SigLIP). Los embeddings NO dependen
# del vocabulario, solo del modelo + imagen → cachearlos hace que re-runs
# tras añadir/cambiar labels pasen de ~8 min a ~30 segundos. Se invalida
# automáticamente si cambias el MODEL_ID (validation al cargar).
EMBEDDINGS_CACHE_PATH  = ROOT / "tools" / "image-audit" / ".image-embeddings.pt"
GEMINI_MODEL_ID        = "gemini-2.5-flash"
# Groq vision model — Llama 4 Scout es multimodal nativo con cuota free
# generosa (~14400 req/día vs ~250 de Gemini Flash free).
GROQ_MODEL_ID          = "meta-llama/llama-4-scout-17b-16e-instruct"

# IMPORTANTE: sincronizar con `CATEGORIES` en
# `src/app/admin/images-bank/labelMetadata.ts` cada vez que se añada
# una categoría nueva al frontend. Si Groq/Gemini sugiere un label con
# una categoría no listada aquí, el validator la RECHAZA — y se
# desperdicia la llamada API (cuota de Groq es limitada).
#
# Usado en _validate_suggestion() Y en DISCOVERY_PROMPT_TEMPLATE.
# Mantenido como lista (no set) para preservar orden visual en el
# prompt que ve la IA.
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

# Prompt compartido entre Gemini y Groq — son zero-shot multimodal,
# entienden la misma instrucción. Se construye dinámicamente a partir
# de VALID_CATEGORIES_LIST para que prompt y validator NUNCA se
# desincronicen.
#
# TODO (pendiente — feature pedido el 26/05): añadir 3 modos de
# respuesta: "new" (como ahora), "match" (loguear coincidencia con
# label existente) y "improve" (sugerir prompts adicionales para
# label existente que la IA cree que debería capturar la imagen).
# Implementación pausada — requiere cambiar también call_gemini,
# call_groq, _validate_suggestion y el main loop.
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


def _format_top_relevant(top_relevant: list[tuple[str, float]]) -> str:
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

# Alias para retrocompat — el prompt es el mismo
GEMINI_PROMPT_TEMPLATE = DISCOVERY_PROMPT_TEMPLATE

from labels import LABELS, LABEL_NEGATIVES, NEG_WEIGHT


def collect_image_paths(directory: Path) -> list[Path]:
    """Lista todas las imágenes (.png/.jpg/.jpeg/.webp) de la carpeta."""
    extensions = {".png", ".jpg", ".jpeg", ".webp"}
    return sorted(
        p for p in directory.iterdir()
        if p.is_file() and p.suffix.lower() in extensions
    )


def _load_env_files(*paths: Path) -> None:
    """Carga .env files al `os.environ` sin necesidad de python-dotenv.

    Reglas (= convención de Next/dotenv):
      1. os.environ pre-existente (export en shell) → gana siempre.
      2. Entre files: el PRIMERO de `paths` que defina una key gana.

    Por eso pasa los más específicos primero:
        _load_env_files(ROOT / ".env.local", ROOT / ".env")

    Formato soportado:
      KEY=value
      KEY="value with spaces"
      KEY='same'
      # comentarios y líneas vacías ignoradas

    No soporta multi-line values ni variable expansion (KEY=${OTHER}) —
    sobra para api keys planas como GEMINI_API_KEY.
    """
    for path in paths:
        if not path.exists():
            continue
        try:
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key   = key.strip()
                value = value.strip()
                # Strip surrounding matched quotes
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                    value = value[1:-1]
                # setdefault → no sobreescribe si ya estaba en os.environ o
                # si un file anterior (más específico) ya la definió.
                if key:
                    os.environ.setdefault(key, value)
        except OSError:
            pass


# ── Gemini auto-discovery ───────────────────────────────────────────────

class GeminiState:
    """Estado compartido del flujo Gemini durante un run. Permite que el
    bucle desactive Gemini globalmente al detectar quota agotada."""
    def __init__(self) -> None:
        self.available: bool          = True
        self.disabled_reason: str     = ""
        self.calls_made: int          = 0
        self.suggestions_added: int   = 0
        self.images_with_gemini: int  = 0


def load_discovered_labels() -> list[dict]:
    """Carga labels descubiertos por Gemini en runs anteriores."""
    if not DISCOVERED_LABELS_PATH.exists():
        return []
    try:
        data = json.loads(DISCOVERED_LABELS_PATH.read_text(encoding="utf-8"))
        labels = data.get("labels", [])
        if not isinstance(labels, list):
            return []
        # Filtrar entries inválidas (por si el JSON quedó corrupto)
        return [l for l in labels if isinstance(l, dict) and "id" in l and "prompts" in l]
    except (json.JSONDecodeError, OSError):
        return []


def save_discovered_labels(labels: list[dict]) -> None:
    """Persiste los labels descubiertos. Se llama tras CADA descubrimiento
    para no perder progreso si el script muere."""
    DISCOVERED_LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count":       len(labels),
        "labels":      labels,
    }
    DISCOVERED_LABELS_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def load_refined_labels() -> dict[str, dict]:
    """Carga refinamientos producidos por refine_labels.py (Fase B).

    Returns: dict[label_id, {refinedPositives, refinedNegatives, ...}]. Vacío
    si el archivo no existe o está corrupto. Para que el classifier los use,
    el archivo debe estar en `tools/image-audit/refined_labels.json` — el run
    de prod (modal_app.py) lee directamente de R2; el local hace falta hacer
    `npm run images:download-metadata` antes para sincronizar.
    """
    if not REFINED_LABELS_PATH.exists():
        return {}
    try:
        data = json.loads(REFINED_LABELS_PATH.read_text(encoding="utf-8"))
        refinements = data.get("refinements", {})
        if not isinstance(refinements, dict):
            return {}
        out: dict[str, dict] = {}
        for lid, ref in refinements.items():
            if not isinstance(ref, dict):
                continue
            # Validation suave: solo aceptamos si tiene al menos uno de los dos
            # arrays válidos. El classifier hace fallback al original si falta.
            rp = ref.get("refinedPositives")
            rn = ref.get("refinedNegatives")
            if (isinstance(rp, list) and len(rp) >= 1) or (isinstance(rn, list) and len(rn) >= 1):
                out[lid] = ref
        return out
    except (json.JSONDecodeError, OSError):
        return {}


def load_prototypes() -> dict[str, dict]:
    """Carga meta/prototypes.json (Fase C kNN) desde filesystem.

    Returns: dict[label_id, {positive: [{sha, embedding}], negative: [...]}].
    Vacío si el archivo no existe o está corrupto. Para sincronizar con R2:
    `npm run images:download-metadata` antes del run local.
    """
    if not PROTOTYPES_PATH.exists():
        return {}
    try:
        data = json.loads(PROTOTYPES_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        protos = data.get("prototypes", {})
        return protos if isinstance(protos, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _load_sha_tag_map(path: Path, map_key: str) -> dict[str, set[str]]:
    """Helper genérico para cargar JSONs de la forma
        { generatedAt: ..., [map_key]: { sha_hex: [tag_id, ...] } }
    Usado para tag_exclusions.json y tag_confirmations.json.
    Modo permisivo: si no existe o está corrupto, devuelve {}.
    """
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    raw = data.get(map_key, {}) if isinstance(data, dict) else {}
    if not isinstance(raw, dict):
        return {}
    result: dict[str, set[str]] = {}
    for sha, tags in raw.items():
        if isinstance(sha, str) and isinstance(tags, list):
            valid_tags = {t for t in tags if isinstance(t, str)}
            if valid_tags:
                result[sha] = valid_tags
    return result


def load_tag_exclusions() -> dict[str, set[str]]:
    """Admin marca "esta imagen NO es de este tag" desde el banco. El
    classifier NO emite esos tags aunque score >= threshold."""
    return _load_sha_tag_map(TAG_EXCLUSIONS_PATH, "exclusions")


def load_tag_confirmations() -> dict[str, set[str]]:
    """Admin marca "esta imagen SÍ es de este tag" desde el banco. El
    classifier hace boost del score a CONFIRMED_TAG_MIN_SCORE (0.30)
    si el score real es menor, para que el tag aparezca en filtro
    "Calidad medio" o superior."""
    return _load_sha_tag_map(TAG_CONFIRMATIONS_PATH, "confirmations")


def load_manual_tags_raw() -> dict:
    """Lee meta/manual_tags.json local. Modo permisivo: si no existe o
    está corrupto, devuelve un dict vacío con el shape esperado.
    Devuelve el JSON tal cual para luego pasarlo a
    `parse_manual_tags` (que normaliza el shape).
    """
    if not MANUAL_TAGS_PATH.exists():
        return {"version": 1, "entries": {}}
    try:
        data = json.loads(MANUAL_TAGS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"version": 1, "entries": {}}
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "entries": {}}


def _mime_of(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".png":  return "image/png"
    if ext == ".webp": return "image/webp"
    return "image/jpeg"


# Buffer global de sugerencias RECHAZADAS por _validate_suggestion.
# Se vuelca al final del run a `rejected_suggestions.json` para que
# el humano pueda auditar (y potencialmente recuperar) sugerencias
# que la IA propuso pero el validator descartó. Antes se perdían
# silenciosamente (caso del bug de VALID_CATEGORIES: 37 llamadas
# Groq → 0 aceptadas → 0 guardadas).
REJECTED_SUGGESTIONS: list[dict] = []


def _validate_suggestion(s: object, existing_ids: set[str], image_name: str = "?") -> Optional[dict]:
    """Valida una sugerencia de label de Gemini/Groq. Devuelve dict
    normalizado o None si es inválida/duplicada.

    Si rechaza, registra el motivo en REJECTED_SUGGESTIONS para que
    el humano pueda auditarlo al final del run.
    """
    def reject(reason: str) -> None:
        REJECTED_SUGGESTIONS.append({
            "image":       image_name,
            "rejectedAt":  datetime.now(timezone.utc).isoformat(),
            "reason":      reason,
            "suggestion":  s if isinstance(s, dict) else {"raw": str(s)[:200]},
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
    # snake_case: solo a-z, 0-9, underscore
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


def save_rejected_suggestions() -> None:
    """Vuelca el buffer de sugerencias rechazadas a JSON. Llamado al
    final del run si hay alguna. Útil para auditar por qué Gemini/Groq
    sugirió cosas que el validator descartó (ej. categorías inválidas,
    prompts mal formados, etc.)."""
    if not REJECTED_SUGGESTIONS:
        return
    path = DISCOVERED_LABELS_PATH.parent / "rejected_suggestions.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count":       len(REJECTED_SUGGESTIONS),
        "note":        "Sugerencias de Gemini/Groq descartadas por el validator. "
                       "Revisa los `reason` para entender qué fallaba. Si alguna "
                       "es legítima (ej. categoría que olvidaste añadir), puedes "
                       "actualizar VALID_CATEGORIES o el code y volver a correr.",
        "rejected":    REJECTED_SUGGESTIONS,
    }
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\n📝 {len(REJECTED_SUGGESTIONS)} sugerencias rechazadas guardadas en {path.name}")
    # Resumen por motivo
    from collections import Counter
    reasons = Counter()
    for r in REJECTED_SUGGESTIONS:
        # Agrupar por motivo principal (primer ; o primer ()
        reason_key = r["reason"].split("(")[0].split(";")[0].strip()
        reasons[reason_key] += 1
    print(f"   Motivos más comunes:")
    for reason, cnt in reasons.most_common(5):
        print(f"     {cnt:>4}× {reason}")


def call_gemini(
    client,
    image_path:   Path,
    existing_ids: set[str],
    state:        GeminiState,
    top_relevant: Optional[list[tuple[str, float]]] = None,
) -> Optional[list[dict]]:
    """Pide a Gemini que sugiera labels para una imagen.

    `existing_ids`: set COMPLETO para validation (rechazar duplicados).
    `top_relevant`: top-N labels más relevantes a la imagen (por score SigLIP)
                   — solo estos se incluyen en el prompt para reducir tokens
                   y mejorar tasa de aceptación. Si None o vacío, se pasa
                   un mensaje genérico al modelo.

    Devuelve:
      - list[dict] válida (puede estar vacía si Gemini no propone nada)
      - None si hubo error (incluido quota agotada → state.available=False)
    """
    if not state.available or client is None or genai_types is None:
        return None
    try:
        img_bytes  = image_path.read_bytes()
        mime       = _mime_of(image_path)
        tr         = top_relevant or []
        n_other    = max(0, len(existing_ids) - len(tr))
        prompt     = GEMINI_PROMPT_TEMPLATE.format(
            top_relevant=_format_top_relevant(tr),
            n_top=len(tr),
            n_other=n_other,
        )
        response = client.models.generate_content(
            model    = GEMINI_MODEL_ID,
            contents = [
                genai_types.Part.from_bytes(data=img_bytes, mime_type=mime),
                prompt,
            ],
            config   = genai_types.GenerateContentConfig(
                response_mime_type = "application/json",
                temperature        = 0.3,
                # Limita salida — JSON con 3 labels x 3 prompts son ~400 tokens
                max_output_tokens  = 800,
            ),
        )
        state.calls_made += 1
        text = (response.text or "").strip()
        # Defensivo: si Gemini ignora response_mime_type y mete fences
        if text.startswith("```"):
            text = text.split("```", 2)[1] if "```" in text[3:] else text[3:]
            if text.startswith("json"):
                text = text[4:]
            text = text.rsplit("```", 1)[0].strip()
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return []  # respuesta vacía o malformada — no es error fatal
        if not isinstance(raw, list):
            return []
        validated: list[dict] = []
        for s in raw:
            v = _validate_suggestion(s, existing_ids, image_path.name)
            if v is not None:
                validated.append(v)
                # Importante: añade el id al set para que múltiples
                # sugerencias en el MISMO call no se dupliquen entre sí
                existing_ids.add(v["id"])
        return validated
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        # Errores FATALES — desactivamos Gemini para el resto del run para
        # no spammear N veces el mismo error por cada imagen.
        is_quota = any(k in msg for k in (
            "quota", "rate limit", "429", "resource_exhausted",
            "resource exhausted", "exceeded", "too many requests",
        ))
        is_auth  = any(k in msg for k in (
            "api key not valid", "api_key_invalid", "api key invalid",
            "unauthorized", "permission denied", "permission_denied",
            "401", "403", "invalid api key",
        ))
        # 503 UNAVAILABLE = sobrecarga en el modelo. Técnicamente transitorio
        # pero típicamente persiste minutos/horas — en un run en lotes seguir
        # intentando solo malgasta quota (cada 503 cuenta como request). Mejor
        # desactivar y que el user reintente luego.
        is_overload = any(k in msg for k in (
            "503", "unavailable", "high demand", "model is currently",
        ))
        if is_quota:
            state.available       = False
            state.disabled_reason = "quota_exhausted"
            print(f"\n⚠  Gemini quota agotada — desactivando para resto del run")
            print(f"   Mensaje: {str(e)[:200]}")
        elif is_auth:
            state.available       = False
            state.disabled_reason = "auth_error"
            print(f"\n⚠  Gemini API key INVÁLIDA — desactivando para resto del run")
            print(f"   La key en .env probablemente está expirada o es de otro proyecto.")
            print(f"   Verifica /admin/secrets en la app — esa es la key que SÍ funciona.")
            print(f"   Cópiala al .env.local del root del proyecto.")
            print(f"   Mensaje original: {str(e)[:200]}")
        elif is_overload:
            state.available       = False
            state.disabled_reason = "model_overloaded"
            print(f"\n⚠  Gemini sobrecargado (503) — desactivando para resto del run")
            print(f"   Es transitorio; vuelve a intentarlo más tarde con --retry-problematic.")
            print(f"   Mensaje: {str(e)[:200]}")
        else:
            # Otro error transitorio (red, JSON malformado): log y seguir
            print(f"\n⚠  Gemini error en {image_path.name[:12]}: {str(e)[:200]}")
        return None


class GroqState:
    """Estado de Groq durante el run (paralelo a GeminiState)."""
    def __init__(self) -> None:
        self.available: bool          = True
        self.disabled_reason: str     = ""
        self.calls_made: int          = 0
        self.suggestions_added: int   = 0
        self.images_with_groq: int    = 0


def call_groq(
    client,
    image_path:   Path,
    existing_ids: set[str],
    state:        GroqState,
    top_relevant: Optional[list[tuple[str, float]]] = None,
) -> Optional[list[dict]]:
    """Pide a Groq que sugiera labels para una imagen.

    Ver `call_gemini` para semántica de `existing_ids` y `top_relevant`.

    Devuelve:
      - list[dict] válida (puede estar vacía si Groq no propone nada)
      - None si hubo error (incluido quota → state.available=False)
    """
    if not state.available or client is None:
        return None
    try:
        img_bytes = image_path.read_bytes()
        mime      = _mime_of(image_path)
        b64       = _b64.b64encode(img_bytes).decode("ascii")
        tr        = top_relevant or []
        n_other   = max(0, len(existing_ids) - len(tr))
        prompt    = DISCOVERY_PROMPT_TEMPLATE.format(
            top_relevant=_format_top_relevant(tr),
            n_top=len(tr),
            n_other=n_other,
        )
        # OpenAI-compatible chat completion con image_url multimodal.
        # System message refuerza el formato JSON — mejora cumplimiento
        # del modelo (Llama Scout ignora el formato si solo está en el
        # user message). No todos los modelos Groq aceptan system+vision
        # pero Llama 4 Scout sí.
        response = client.chat.completions.create(
            model=GROQ_MODEL_ID,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a JSON-only API. Your entire response must be a single "
                        "valid JSON object with a top-level key \"labels\" whose value is "
                        "an array of label objects. Each label object must have exactly "
                        "these 4 string/array fields: id, displayEs, category, prompts. "
                        "The prompts field must be an array of exactly 3 English strings. "
                        "NEVER put plain strings directly inside the labels array — only objects."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{b64}",
                            },
                        },
                    ],
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=800,
        )
        state.calls_made += 1
        text = response.choices[0].message.content or ""
        text = text.strip()
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return []
        # Normalizar: buscamos el array de labels.
        # Orden de prioridad: clave "labels" > primer valor que sea lista
        # > dict que parece un único label > error.
        if isinstance(raw, dict):
            arr = raw.get("labels")
            if not isinstance(arr, list):
                # Fallback: buscar primer valor lista
                arr = next((v for v in raw.values() if isinstance(v, list)), None)
            if arr is None:
                # El dict mismo podría ser UN solo label
                if "id" in raw and "prompts" in raw:
                    arr = [raw]
                else:
                    return []
            raw = arr
        if not isinstance(raw, list):
            return []
        # Groq a veces ignora el system message y pone strings directamente
        # en el array (descripciones visuales, no objetos).
        # Logueamos con motivo específico para poder auditar.
        if raw and all(isinstance(s, str) for s in raw):
            for s in raw:
                REJECTED_SUGGESTIONS.append({
                    "image":      image_path.name,
                    "rejectedAt": datetime.now(timezone.utc).isoformat(),
                    "reason":     "Groq devolvió string en vez de objeto (formato de respuesta incorrecto — debería ser {id,displayEs,category,prompts})",
                    "suggestion": {"raw_string": s[:200]},
                })
            return []
        validated: list[dict] = []
        for s in raw:
            v = _validate_suggestion(s, existing_ids, image_path.name)
            if v is not None:
                validated.append(v)
                existing_ids.add(v["id"])
        return validated
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        is_quota = any(k in msg for k in (
            "quota", "rate limit", "429", "resource_exhausted",
            "exceeded", "too many requests",
        ))
        is_auth  = any(k in msg for k in (
            "api key not valid", "api_key_invalid", "invalid api key",
            "unauthorized", "permission denied", "401", "403",
            "invalid_api_key",
        ))
        is_overload = any(k in msg for k in (
            "503", "service unavailable", "overloaded",
        ))
        if is_quota:
            state.available       = False
            state.disabled_reason = "quota_exhausted"
            print(f"\n⚠  Groq quota agotada — desactivando para resto del run")
            print(f"   Mensaje: {str(e)[:200]}")
        elif is_auth:
            state.available       = False
            state.disabled_reason = "auth_error"
            print(f"\n⚠  Groq API key INVÁLIDA — desactivando")
            print(f"   La GROQ_API_KEY de .env.local no es válida.")
            print(f"   Cópiala de /admin/secrets en tu app.")
            print(f"   Mensaje original: {str(e)[:200]}")
        elif is_overload:
            state.available       = False
            state.disabled_reason = "model_overloaded"
            print(f"\n⚠  Groq sobrecargado — desactivando")
            print(f"   Mensaje: {str(e)[:200]}")
        else:
            print(f"\n⚠  Groq error en {image_path.name[:12]}: {str(e)[:200]}")
        return None


def load_embedding_cache(model_id: str) -> dict[str, torch.Tensor]:
    """Carga el cache de embeddings de imagen del disco. Valida que sea
    del mismo modelo — si no, ignora el cache (los embeddings son
    dependientes del modelo, no son intercambiables)."""
    if not EMBEDDINGS_CACHE_PATH.exists():
        return {}
    try:
        # weights_only=False porque guardamos un dict con str+tensors;
        # weights_only=True bloquea pickle de objetos arbitrarios.
        data = torch.load(EMBEDDINGS_CACHE_PATH, map_location="cpu", weights_only=False)
        if not isinstance(data, dict):
            return {}
        cached_model = data.get("_model", "")
        if cached_model != model_id:
            print(f"⚠  Cache de embeddings es de OTRO modelo ('{cached_model}'), ignorando")
            return {}
        embs = data.get("embeddings", {})
        if not isinstance(embs, dict):
            return {}
        return embs
    except Exception as e:  # noqa: BLE001
        print(f"⚠  Cache de embeddings corrupto ({e}), ignorando")
        return {}


def save_embedding_cache(cache: dict[str, torch.Tensor], model_id: str) -> None:
    """Persiste el cache. Se llama en cada checkpoint + al final del run."""
    EMBEDDINGS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "_model":     model_id,
        "embeddings": cache,
    }, EMBEDDINGS_CACHE_PATH)


def encode_label_embedding(
    processor,
    model,
    prompts:  list[str],
    device:   str,
) -> torch.Tensor:
    """Codifica una LISTA de prompts (ensemble de 1 label), promedia y
    normaliza → devuelve un tensor 1×emb_dim listo para concatenar
    a text_embeds."""
    with torch.no_grad():
        ti = processor(text=prompts, padding="max_length", return_tensors="pt").to(device)
        e  = model.get_text_features(**ti)
        e  = e / e.norm(dim=-1, keepdim=True)
        avg = e.mean(dim=0, keepdim=True)
        avg = avg / avg.norm(dim=-1, keepdim=True)
    return avg


def load_existing_results(path: Path) -> tuple[dict, str | None]:
    """Si existe un classification.json previo, carga las imgs ya hechas
    para no reprocesarlas (idempotencia) + el `generatedAt` previo (que
    sirve de backfill de `taggedAt` para imágenes guardadas antes de
    introducir ese campo). Si está corrupto, ignora.

    Returns:
        (images_dict, generatedAt_iso_or_None)
    """
    if not path.exists():
        return {}, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("images", {}), data.get("generatedAt")
    except (json.JSONDecodeError, OSError):
        return {}, None


def write_output(path: Path, payload: dict) -> None:
    """Vuelca el JSON. Usa indent=2 — el tamaño no preocupa (200-400 KB)
    y queremos que se pueda leer/grep a mano si hace falta debug."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _auto_download_images_from_r2(target_dir: Path) -> int:
    """Sincroniza R2 → target_dir descargando SOLO las imgs que no están
    en local. Idempotente: re-correrlo cuando todo está sincronizado es
    un no-op silencioso. Pensado para que el classifier funcione sin que
    el admin tenga que correr `npm run images:download-r2` manualmente,
    sobre todo cuando se descargan refs nuevas por Lens y el local tiene
    1700 imgs viejas pero le faltan 2 nuevas.

    Returns: número de imgs descargadas en esta llamada (sin contar
    skipped). 0 si no se pudo (sin creds), o si todo ya estaba.
    """
    try:
        import boto3
    except ImportError:
        print(f"❌ boto3 no instalado — no puedo descargar de R2.")
        print(f"   Corre: npm run images:setup-classifier  (instala boto3)")
        print(f"   O: npm run images:download-r2  (descarga manualmente)")
        return 0

    # Cargar .env files PRIMERO — el classifier solo los carga más tarde para
    # Gemini/Groq, pero las R2 creds también pueden estar ahí.
    _load_env_files(ROOT / ".env.local", ROOT / ".env")

    needed = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
    missing = [k for k in needed if not os.environ.get(k)]
    if missing:
        print(f"❌ Faltan credenciales R2 en .env / .env.local: {missing}")
        print(f"   No puedo auto-descargar.")
        print(f"   Soluciones:")
        print(f"     1. Añade las creds R2 a .env.local")
        print(f"     2. O corre manualmente: npm run images:download-r2")
        return 0

    s3 = boto3.client(
        "s3",
        endpoint_url          = f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id     = os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key = os.environ["R2_SECRET_ACCESS_KEY"],
        region_name           = "auto",
    )
    bucket = os.environ["R2_BUCKET_NAME"]

    target_dir.mkdir(parents=True, exist_ok=True)

    # 1. Listar imgs en R2 (excluir prefix meta/)
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.startswith("meta/"):
                continue
            ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
            if ext in ("png", "jpg", "jpeg", "webp"):
                keys.append(key)

    if not keys:
        print(f"⚠  No hay imágenes en R2.")
        return 0

    # 2. Comparar con local — solo nos interesan las que FALTAN. Evita
    #    el listado de "ya estaban" para cuando no hay nada que hacer
    #    (caso típico tras una primera descarga: 0 gap → mensaje breve).
    missing_keys = [
        k for k in keys
        if not (target_dir / k.replace("/", "_")).exists()
    ]
    if not missing_keys:
        # Silencioso: el caller llama al inicio de cada run, no queremos
        # ruido cuando el local ya está al día.
        return 0

    print(f"📥 R2 sync: {len(missing_keys)} imgs faltantes en local — descargando a {target_dir}...")

    from concurrent.futures import ThreadPoolExecutor
    def _download(key: str) -> str:
        local_path = target_dir / key.replace("/", "_")  # flatten any subdirs
        try:
            s3.download_file(bucket, key, str(local_path))
            return "ok"
        except Exception as e:  # noqa: BLE001
            print(f"   ⚠  falló {key}: {e}")
            return "failed"

    pool = ThreadPoolExecutor(max_workers=24)
    results = list(pool.map(_download, missing_keys))
    pool.shutdown()
    downloaded = results.count("ok")
    failed     = results.count("failed")
    print(f"✅ descargadas: {downloaded} · fallos: {failed}")
    return downloaded


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Clasifica imágenes multi-label con SigLIP")
    p.add_argument(
        "--input-dir", type=Path, default=DEFAULT_INPUT_DIR,
        help=f"Carpeta de imágenes a clasificar (default: {DEFAULT_INPUT_DIR})",
    )
    p.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT,
        help=f"Path del JSON de salida (default: {DEFAULT_OUTPUT})",
    )
    p.add_argument(
        "--no-gemini", action="store_true",
        help="Desactiva el auto-discovery con Gemini aunque GEMINI_API_KEY esté seteado",
    )
    p.add_argument(
        "--no-groq", action="store_true",
        help="Desactiva el auto-discovery con Groq aunque GROQ_API_KEY esté seteado",
    )
    p.add_argument(
        "--no-cache", action="store_true",
        help="Desactiva el cache de embeddings de imagen (re-codifica todo cada run). "
             "Útil si el cache se corrompe o quieres validar codificación desde cero.",
    )
    p.add_argument(
        "--no-vocab-check", action="store_true",
        help="Desactiva la detección automática de cambios en el vocabulario. "
             "Por defecto, si LABELS o discovered_labels cambian respecto al "
             "classification.json existente, se re-clasifica todo automáticamente.",
    )
    p.add_argument(
        "--no-r2-sync", action="store_true",
        help="No comparar local con R2 al inicio. Por defecto, antes de "
             "clasificar el script lista las keys del bucket y baja las imgs "
             "que falten en local (típicamente 0-2 → <1s, idempotente). Pasa "
             "este flag si trabajas offline, conexión lenta, o sabes que el "
             "local ya está completo.",
    )
    p.add_argument(
        "--retry-problematic", action="store_true",
        help="Re-procesa también las imágenes ya clasificadas que NO tengan ningún "
             "tag confident (score >= threshold). Útil tras añadir labels nuevos al "
             "vocabulario, refinar prompts o activar Gemini — re-evalúa solo las "
             "que estaban mal sin tocar las que ya estaban bien.",
    )
    p.add_argument(
        "--retry-no-tags", action="store_true",
        help="Más estricto que --retry-problematic: solo re-procesa imágenes con "
             "CERO tags (todos los scores debajo de min_score). Las que tienen tags "
             "low-confidence no se tocan.",
    )
    p.add_argument(
        "--force", "-f", action="store_true",
        help="Ignora el classification.json existente y re-procesa TODAS las imágenes "
             "desde cero. Equivalente a borrar el JSON antes de correr. Útil si dudas "
             "del estado actual o quieres garantizar un resultado fresco.",
    )
    return p.parse_args()


def main() -> None:
    global INPUT_DIR, OUTPUT, GENERATED_AT_BEGIN
    args      = _parse_args()
    INPUT_DIR = args.input_dir
    OUTPUT    = args.output
    # Marca temporal del INICIO del run — la usa el audit log de
    # manual_tags_history.json para correlacionar la migración con el
    # run concreto del classifier que la disparó.
    GENERATED_AT_BEGIN = datetime.now(timezone.utc).isoformat()

    print(f"🔍 SigLIP multi-label classifier")
    print(f"   Input:  {INPUT_DIR}")
    print(f"   Output: {OUTPUT}")
    print(f"   Model:  {MODEL_ID}")
    print(f"   Batch:  {BATCH}")
    print(f"   Threshold: {THRESHOLD} (prob sigmoid mínima para incluir tag)")
    print()

    # Sync de R2 → local en CADA run (idempotente, solo baja lo que falta).
    # Antes solo se ejecutaba si INPUT_DIR no existía → si tenías las 1700
    # imgs viejas y descargabas 2 nuevas por Lens, el classifier no las
    # veía porque iteraba el filesystem y esas 2 nuevas solo estaban en R2.
    # Ahora siempre se lista R2, se compara con local, y se baja el gap
    # (típicamente 0-10 imgs → <1s). Usa `--no-r2-sync` para saltar
    # (offline, conexión lenta, o sabes que el local está completo).
    if not args.no_r2_sync:
        downloaded = _auto_download_images_from_r2(INPUT_DIR)
        if downloaded == 0 and (not INPUT_DIR.exists() or not any(INPUT_DIR.iterdir())):
            print(f"\n❌ No se pudieron descargar imágenes de R2 y el directorio está vacío.")
            print(f"   Pasa --input-dir <ruta> con un directorio que SÍ tenga imágenes.")
            sys.exit(1)
        print()

    paths = collect_image_paths(INPUT_DIR)
    if not paths:
        print(f"❌ Sin imágenes en {INPUT_DIR}.")
        sys.exit(1)
    print(f"📷 {len(paths)} imágenes a clasificar")

    # ── Cargar discovered + refined + build active_labels (early, sin model) ──
    # Necesitamos active_labels (LABELS + discovered) ANTES del check de
    # vocabulario para comparar contra el classification.json existente.
    # No necesita SigLIP cargado, solo leer JSON.
    # discovered y active_labels son MUTABLES durante el run: Gemini/Groq
    # los van extendiendo cuando descubren labels nuevos.
    discovered = load_discovered_labels()
    if discovered:
        print(f"♻  {len(discovered)} labels descubiertos previamente cargados de {DISCOVERED_LABELS_PATH.name}")

    # Refinamientos de prompts (Fase B). Si un label tiene refinement, se
    # REEMPLAZAN sus prompts originales (positivos y/o negativos) por los
    # que produjo Gemini analizando las imágenes confirmadas/excluidas.
    refined_labels = load_refined_labels()
    if refined_labels:
        n_pos_refined = sum(1 for r in refined_labels.values() if r.get("refinedPositives"))
        n_neg_refined = sum(1 for r in refined_labels.values() if r.get("refinedNegatives"))
        print(f"🪄 {len(refined_labels)} labels con refinements aplicados ({n_pos_refined} positivos, {n_neg_refined} negativos)")
        print(f"   ids: {', '.join(sorted(refined_labels.keys())[:10])}{'...' if len(refined_labels) > 10 else ''}")

    # Construir active_labels aplicando refinements en LABELS hardcoded.
    # Los discovered NO se refinan (su vocabulario original viene de Gemini).
    active_labels: list[tuple[str, list[str]]] = []
    for lid, prompts in LABELS:
        ref = refined_labels.get(lid)
        if ref and isinstance(ref.get("refinedPositives"), list) and ref["refinedPositives"]:
            active_labels.append((lid, list(ref["refinedPositives"])))
        else:
            active_labels.append((lid, list(prompts)))
    _seen_ids = {lid for lid, _ in active_labels}
    for d in discovered:
        if d["id"] not in _seen_ids:
            active_labels.append((d["id"], d["prompts"]))
            _seen_ids.add(d["id"])

    # active_negatives = LABEL_NEGATIVES con override de refined si aplica.
    # Se usa más abajo (en el loop de encoding de negativos) en lugar del
    # LABEL_NEGATIVES global directo.
    active_negatives: dict[str, list[str]] = dict(LABEL_NEGATIVES)
    for lid, ref in refined_labels.items():
        rn = ref.get("refinedNegatives")
        if isinstance(rn, list) and rn:
            active_negatives[lid] = list(rn)

    # Prototipos kNN (Fase C). Se construyen como tensores GPU MÁS ABAJO,
    # cuando ya tengamos `device` y `text_embeds.dtype` disponibles. Aquí
    # solo los cargamos como dict (puro JSON).
    prototypes_data = load_prototypes()
    if prototypes_data:
        n_lab = len(prototypes_data)
        n_pos = sum(len(d.get("positive", [])) for d in prototypes_data.values() if isinstance(d, dict))
        n_neg = sum(len(d.get("negative", [])) for d in prototypes_data.values() if isinstance(d, dict))
        print(f"🧬 prototipos kNN cargados de {PROTOTYPES_PATH.name}: {n_lab} labels ({n_pos} positivos + {n_neg} negativos)")

    # ── Detección de vocab change ───────────────────────────────────────
    # Si cambió alguna entrada de LABELS (añadida, eliminada, prompts
    # modificados) o de discovered_labels.json desde el último run, lo
    # detectamos comparando con el campo `labels` del classification.json
    # existente. Si cambió → reseteamos `existing` para forzar re-clasificación.
    # El cache de embeddings hace que el coste sea ~30s, no 8 min.
    existing_full: dict = {}
    if OUTPUT.exists():
        try:
            existing_full = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing_full = {}

    # --force: equivale a borrar el JSON. No miramos vocab ni cargamos
    # existing — reprocesamos TODO desde cero. Más claro que pedir al
    # user que haga rm classification.json manualmente.
    vocab_changed = False
    if args.force:
        print("⚡ --force activado: ignorando classification.json existente, re-clasificando TODO desde cero")
    elif (not args.no_vocab_check
        and isinstance(existing_full, dict)
        and existing_full.get("labels")
        and existing_full.get("images")):
        old_pairs = sorted(
            (str(l.get("id", "")), tuple(l.get("prompts", [])))
            for l in existing_full["labels"]
            if isinstance(l, dict)
        )
        new_pairs = sorted(
            (lid, tuple(prompts)) for lid, prompts in active_labels
        )
        if old_pairs != new_pairs:
            vocab_changed = True
            old_ids   = {lid for lid, _ in old_pairs}
            new_ids   = {lid for lid, _ in new_pairs}
            added     = new_ids - old_ids
            removed   = old_ids - new_ids
            old_dict  = {lid: prompts for lid, prompts in old_pairs}
            new_dict  = {lid: prompts for lid, prompts in new_pairs}
            modified  = {lid for lid in (old_ids & new_ids) if old_dict[lid] != new_dict[lid]}

            print(f"🔄 Vocabulario CAMBIADO desde el último run:")
            if added:
                shown = ", ".join(sorted(added)[:6])
                more  = f" ... (+{len(added) - 6})" if len(added) > 6 else ""
                print(f"   + {len(added)} nuevos: {shown}{more}")
            if removed:
                shown = ", ".join(sorted(removed)[:6])
                more  = f" ... (+{len(removed) - 6})" if len(removed) > 6 else ""
                print(f"   - {len(removed)} eliminados: {shown}{more}")
            if modified:
                shown = ", ".join(sorted(modified)[:6])
                more  = f" ... (+{len(modified) - 6})" if len(modified) > 6 else ""
                print(f"   ~ {len(modified)} con prompts modificados: {shown}{more}")
            print(f"   → Re-clasificando TODAS las imágenes (gracias al cache, ~30s)")
        else:
            # Vocab NO cambió — comunicar explícitamente que se verificó
            print(f"✓ Vocabulario sin cambios desde el último run ({len(new_pairs)} labels)")
            # Mostrar cuándo fue el último run para que el user sepa la frescura
            prev_gen = existing_full.get("generatedAt", "?")
            print(f"   Último run: {prev_gen}")

    # ── Resume: saltar las ya clasificadas en runs anteriores ───────────
    # Default: skip TODO lo que ya esté en classification.json.
    # --force: vacía existing (igual que vocab_changed → re-clasifica todo).
    # --retry-problematic: re-procesa las que no tengan tag confident.
    # --retry-no-tags: solo re-procesa las que tengan CERO tags.
    if vocab_changed or args.force:
        existing, prev_generated_at = {}, None
    else:
        existing, prev_generated_at = load_existing_results(OUTPUT)
    # Backfill de taggedAt para entradas guardadas antes del feature.
    # Las que no lo tengan reciben el generatedAt previo del JSON (mejor
    # aproximación que tenemos) o `now` como último recurso.
    backfill_tagged_at = prev_generated_at or datetime.now(timezone.utc).isoformat()
    for info in existing.values():
        info.setdefault("taggedAt", backfill_tagged_at)

    # Cargar exclusiones manuales gestionadas por el admin desde el
    # banco (swipe Tinder). sha → set de tag_ids a excluir.
    tag_exclusions: dict[str, set[str]] = load_tag_exclusions()
    if tag_exclusions:
        total_excl = sum(len(v) for v in tag_exclusions.values())
        print(f"🚫 Exclusiones manuales cargadas: {len(tag_exclusions)} shas, {total_excl} tags excluidos")
    # Confirmaciones manuales (admin marca "SÍ es"). Si el score real
    # del tag es < CONFIRMED_TAG_MIN_SCORE (0.30), se eleva a ese
    # mínimo para que entre en filtro "Calidad medio". El score real
    # se respeta si ya supera el mínimo.
    tag_confirmations: dict[str, set[str]] = load_tag_confirmations()
    if tag_confirmations:
        total_conf = sum(len(v) for v in tag_confirmations.values())
        print(f"✅ Confirmaciones manuales cargadas: {len(tag_confirmations)} shas, {total_conf} tags confirmados (boost a {CONFIRMED_TAG_MIN_SCORE})")
    # Manual tags asignados directamente por el admin desde /admin/images-bank.
    # Mismos efectos que tag_confirmations + se INYECTAN en classification.json
    # aunque el classifier no los detectara (verdad humana → invariante).
    # Tras un run exitoso se migran a tag_confirmations.json (cleanup).
    from classifier_core import parse_manual_tags, manual_tags_to_id_sets  # noqa: E402
    raw_manual_tags        = load_manual_tags_raw()
    parsed_manual_tags     = parse_manual_tags(raw_manual_tags)
    manual_tags_by_sha     = manual_tags_to_id_sets(parsed_manual_tags)
    if manual_tags_by_sha:
        total_man = sum(len(v) for v in manual_tags_by_sha.values())
        print(f"👤 Manual tags cargados: {len(manual_tags_by_sha)} shas, {total_man} tags asignados (boost a {CONFIRMED_TAG_MIN_SCORE} + inyectados al output, migrarán a confirmations tras este run)")
    retried_shas: set[str] = set()
    if existing:
        if args.retry_no_tags:
            for sha, info in existing.items():
                if not info.get("tags"):
                    retried_shas.add(sha)
            retry_mode_label = "sin ningún tag"
        elif args.retry_problematic:
            for sha, info in existing.items():
                if not any(t.get("confident") for t in info.get("tags", [])):
                    retried_shas.add(sha)
            retry_mode_label = "sin tag confident"
        else:
            retry_mode_label = ""

        # Re-procesar imágenes con exclusiones pendientes de baking:
        # el admin marcó "No es" desde el banco pero classification.json
        # aún tiene ese tag en la lista (solo se filtraba en la UI en
        # runtime). Al re-procesar, el scoring aplica la exclusión y el
        # JSON queda como fuente de verdad definitiva.
        excl_pending = {
            sha for sha, info in existing.items()
            if sha in tag_exclusions
            and any(
                t["tag"] in tag_exclusions[sha]
                for t in info.get("tags", [])
            )
        }
        if excl_pending:
            retried_shas.update(excl_pending)
            print(f"🚫→🔄 {len(excl_pending)} con exclusiones pendientes de baking → se re-procesarán")

        kept = len(existing) - len(retried_shas)
        if retried_shas:
            print(f"♻  {kept} ya clasificadas se mantienen tal cual")
            print(f"🔄 {len(retried_shas)} en total se REPROCESARÁN")
        else:
            print(f"♻  {len(existing)} ya clasificadas en runs previos → se saltan")

    # `pending` = imgs nuevas en disco + imgs a reprocesar
    to_skip = set(existing.keys()) - retried_shas
    pending = [p for p in paths if p.stem not in to_skip]
    print(f"➡  {len(pending)} pendientes (de las cuales {len(retried_shas)} son re-procesos)\n")

    if not pending:
        # No hay nada que procesar. Esto NO es un error — significa que
        # el JSON está al día con el vocabulario actual. Mostramos
        # opciones útiles en vez de pedir housekeeping manual.
        print("✅ Todo al día: no hay imágenes nuevas ni cambios de vocabulario que procesar.")
        print("   El classification.json está sincronizado con el vocabulario actual.")
        print()
        print("   Para reprocesar de todas formas:")
        print("     npm run images:classify -- --force            # re-clasifica TODO desde cero")
        print("     npm run images:classify -- --retry-no-tags    # solo las que quedaron sin tag")
        print("     npm run images:classify -- --retry-problematic # las que tienen tags pero ninguno confident")
        sys.exit(0)

    # ── Cargar modelo ────────────────────────────────────────────────────
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        # Multi-thread CPU sin oversubscription. PyTorch decide tier defaults.
        torch.set_num_threads(max(1, (torch.get_num_threads() or 4)))

    print(f"⚙  Device: {device}")
    print(f"📥 Cargando {MODEL_ID} (~370 MB primera vez)...")
    t0 = time.time()
    # `use_fast=True` para el tokenizer (skip protobuf dep) Y el image
    # processor (suprime el deprecation warning de transformers v4.52).
    # SigLIP tiene SiglipTokenizerFast disponible — funciona idéntico al
    # slow para nuestro caso.
    processor = AutoProcessor.from_pretrained(MODEL_ID, use_fast=True)
    model = AutoModel.from_pretrained(MODEL_ID).to(device).eval()
    print(f"   listo en {time.time() - t0:.1f}s\n")

    # ── Cargar cache de embeddings de imagen (si existe) ───────────────
    emb_cache: dict[str, torch.Tensor] = {}
    if args.no_cache:
        print(f"ℹ  Cache de embeddings desactivado por --no-cache")
    else:
        emb_cache = load_embedding_cache(MODEL_ID)
        if emb_cache:
            print(f"💾 Cache de embeddings: {len(emb_cache)} imgs ya codificadas (reuso)")
        else:
            print(f"💾 Cache de embeddings vacío — se llenará durante este run")

    # ── Setup Gemini auto-discovery (opcional) ──────────────────────────
    # Cargar .env / .env.local del root del proyecto antes de leer la key.
    # Así no hace falta `export GEMINI_API_KEY` a mano — usa la misma key
    # que el resto de la app (Next la consume vía --env-file=.env).

    # Snapshot de qué keys YA estaban en el env antes de cargar archivos.
    # Lo usamos solo para mostrar al user de dónde sale GEMINI_API_KEY
    # (shell env, .env.local, .env, o ningún sitio).
    _gemini_source = "(no encontrada)"
    if "GEMINI_API_KEY" in os.environ:
        _gemini_source = "env del shell (ya estaba seteada antes)"
    else:
        for _src_path in (ROOT / ".env.local", ROOT / ".env"):
            if not _src_path.exists():
                continue
            for _raw in _src_path.read_text(encoding="utf-8").splitlines():
                _line = _raw.strip()
                if not _line or _line.startswith("#") or "=" not in _line:
                    continue
                _k, _, _v = _line.partition("=")
                if _k.strip() == "GEMINI_API_KEY":
                    _gemini_source = _src_path.name
                    break
            if _gemini_source != "(no encontrada)":
                break

    _load_env_files(ROOT / ".env.local", ROOT / ".env")

    gemini_client: Optional[object] = None
    gemini_state = GeminiState()
    if args.no_gemini:
        print(f"ℹ  Gemini desactivado por --no-gemini")
    else:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            print(f"ℹ  GEMINI_API_KEY no encontrado — no se usará auto-discovery")
            print(f"   El script busca primero en .env.local, luego .env del root del proyecto,")
            print(f"   y por último en variables de entorno del shell. Añádela en cualquiera de los 3.")
            print(f"   (fuentes detectadas: {_gemini_source})")
        elif google_genai is None:
            print(f"⚠  google-genai no instalado — corre:  pip install google-genai")
            print(f"   El clasificador sigue sin Gemini")
        else:
            # Validar formato visualmente. Las keys reales de Gemini son
            # 39 chars y empiezan con "AIza".
            prefix = api_key[:4]
            print(f"🤖 Gemini ({GEMINI_MODEL_ID})")
            print(f"   API key source: {_gemini_source}")
            print(f"   API key prefix: '{prefix}' ({len(api_key)} chars)")
            if prefix != "AIza" or len(api_key) < 30:
                print(f"   ⚠  Formato sospechoso — las keys reales de Gemini empiezan con 'AIza' y tienen ~39 chars")
                print(f"   Revisa tu .env / .env.local — la cadena cargada NO parece una API key válida.")
                print(f"   Desactivando Gemini para no spammear errores.")
                gemini_state.available       = False
                gemini_state.disabled_reason = "invalid_key_format"
            else:
                try:
                    gemini_client = google_genai.Client(api_key=api_key)
                    # Pre-flight check: una llamada minimal para validar la
                    # key ANTES de entrar al loop. Coste ~0 (5 tokens out).
                    print(f"   Validando key con request de prueba...")
                    try:
                        gemini_client.models.generate_content(
                            model    = GEMINI_MODEL_ID,
                            contents = "OK",
                            config   = genai_types.GenerateContentConfig(max_output_tokens=5),
                        )
                        print(f"   ✓ key OK — auto-discovery activo")
                    except Exception as e:  # noqa: BLE001
                        msg = str(e).lower()
                        if any(k in msg for k in ("api key", "401", "403", "permission", "unauthorized", "invalid")):
                            print(f"   ✗ key inválida (Gemini la rechaza): {str(e)[:200]}")
                            print(f"   Desactivando Gemini.")
                            gemini_client                = None
                            gemini_state.available       = False
                            gemini_state.disabled_reason = "auth_error"
                        elif any(k in msg for k in ("quota", "rate", "429", "exhausted")):
                            print(f"   ⚠ quota ya agotada — Gemini disponible pero sin llamadas restantes")
                            gemini_client                = None
                            gemini_state.available       = False
                            gemini_state.disabled_reason = "quota_exhausted"
                        else:
                            # Error transitorio (red, etc.) — dejamos activo para reintentar
                            print(f"   ⚠ error en preflight, continuamos y veremos en runtime: {str(e)[:150]}")
                except Exception as e:  # noqa: BLE001
                    print(f"⚠  Error inicializando cliente Gemini: {e}")
                    gemini_client = None

    # ── Setup Groq auto-discovery (proveedor alternativo / fallback) ────
    groq_client: Optional[object] = None
    groq_state = GroqState()
    if args.no_groq:
        print(f"ℹ  Groq desactivado por --no-groq")
    else:
        groq_key = os.environ.get("GROQ_API_KEY", "").strip()
        if not groq_key:
            print(f"ℹ  GROQ_API_KEY no seteado — no se usará Groq como fallback")
        elif GroqClient is None:
            print(f"⚠  groq SDK no instalado — corre:  pip install groq")
        else:
            prefix = groq_key[:4]
            print(f"🦙 Groq ({GROQ_MODEL_ID.split('/')[-1]})")
            print(f"   API key prefix: '{prefix}' ({len(groq_key)} chars)")
            # Groq keys empiezan con "gsk_" típicamente
            if not groq_key.startswith("gsk_") or len(groq_key) < 30:
                print(f"   ⚠  Formato sospechoso — las Groq keys empiezan con 'gsk_' y tienen ~56 chars")
                print(f"   Desactivando Groq para no spammear.")
                groq_state.available       = False
                groq_state.disabled_reason = "invalid_key_format"
            else:
                try:
                    groq_client = GroqClient(api_key=groq_key)
                    # Pre-flight check con request text-only minimal
                    print(f"   Validando key con request de prueba...")
                    try:
                        groq_client.chat.completions.create(
                            model    = GROQ_MODEL_ID,
                            messages = [{"role": "user", "content": "OK"}],
                            max_tokens = 5,
                        )
                        print(f"   ✓ key OK — Groq disponible como fallback")
                    except Exception as e:  # noqa: BLE001
                        msg = str(e).lower()
                        if any(k in msg for k in ("api key", "401", "403", "invalid", "permission")):
                            print(f"   ✗ key inválida (Groq la rechaza): {str(e)[:200]}")
                            groq_client                = None
                            groq_state.available       = False
                            groq_state.disabled_reason = "auth_error"
                        elif any(k in msg for k in ("quota", "rate", "429", "exhausted")):
                            print(f"   ⚠ quota ya agotada")
                            groq_client                = None
                            groq_state.available       = False
                            groq_state.disabled_reason = "quota_exhausted"
                        else:
                            print(f"   ⚠ error en preflight, continuamos: {str(e)[:150]}")
                except Exception as e:  # noqa: BLE001
                    print(f"⚠  Error inicializando cliente Groq: {e}")
                    groq_client = None

    # ── Pre-computar embeddings de los prompts (constante) ──────────────
    # Ensemble: cada label tiene 3 prompts → codificamos los 114 prompts y
    # luego promediamos para obtener UN embedding por label. Esto da mucha
    # más robustez que un solo prompt, especialmente con imágenes que no
    # son "fotos clásicas" (caso DGT).
    # label_ids es MUTABLE durante el run — si Gemini añade labels, se appenden.
    label_ids: list[str] = [lid for lid, _ in active_labels]
    flat_prompts: list[str] = []
    prompt_to_label_idx: list[int] = []
    for li, (_lid, prompts) in enumerate(active_labels):
        for p in prompts:
            flat_prompts.append(p)
            prompt_to_label_idx.append(li)

    print(f"🧠 Codificando {len(flat_prompts)} prompts ({len(active_labels)} labels × ~3 templates)...")

    with torch.no_grad():
        text_inputs = processor(
            text=flat_prompts,
            padding="max_length",
            return_tensors="pt",
        ).to(device)
        raw_embeds = model.get_text_features(**text_inputs)
        # L2 normalize cada prompt antes de promediar — equivalente a hacer
        # mean en el espacio de la esfera unitaria.
        raw_embeds = raw_embeds / raw_embeds.norm(dim=-1, keepdim=True)

    # Promediar embeddings por label
    n_labels  = len(active_labels)
    emb_dim   = raw_embeds.shape[1]
    text_embeds = torch.zeros((n_labels, emb_dim), device=device, dtype=raw_embeds.dtype)
    counts      = torch.zeros(n_labels, device=device, dtype=raw_embeds.dtype)
    for i, li in enumerate(prompt_to_label_idx):
        text_embeds[li] += raw_embeds[i]
        counts[li] += 1
    text_embeds = text_embeds / counts.unsqueeze(-1)
    # Re-normalizar tras el promedio para que sigan en la esfera unitaria
    text_embeds = text_embeds / text_embeds.norm(dim=-1, keepdim=True)
    print(f"   listo — {n_labels} embeddings promediados\n")

    # ── Pre-computar embeddings negativos ────────────────────────────────
    # Para labels con prompts negativos, codificamos esos prompts y los
    # usamos para penalizar similitudes con escenas confundibles.
    # Labels sin negativos → vector cero (penalty ≈ 0 por el bias de SigLIP).
    # Usamos `active_negatives` (definido arriba) en lugar de LABEL_NEGATIVES
    # directo, para que los refinamientos de Fase B sustituyan los negativos
    # originales cuando estén disponibles.
    neg_text_embeds = torch.zeros((n_labels, emb_dim), device=device, dtype=text_embeds.dtype)
    has_neg_mask    = torch.zeros(n_labels, device=device, dtype=text_embeds.dtype)
    for li, lid in enumerate(label_ids):
        neg_prompts = active_negatives.get(lid)
        if not neg_prompts:
            continue
        try:
            neg_emb = encode_label_embedding(processor, model, neg_prompts, device)
            neg_text_embeds[li] = neg_emb.squeeze(0)
            has_neg_mask[li]    = 1.0
        except Exception as e:  # noqa: BLE001
            print(f"   ⚠  No se pudo codificar negativo de '{lid}': {e}")
    n_neg = int(has_neg_mask.sum().item())
    print(f"🔻 {n_neg} labels con prompts negativos (NEG_WEIGHT={NEG_WEIGHT})\n")

    # ── Construir tensores kNN de prototipos (Fase C) ──────────────────
    # Convertimos `prototypes_data` (dict JSON) → tensores GPU listos para
    # matmul en el scoring. Skip labels con < KNN_MIN_PROTOS o con
    # embeddings de dim incorrecta.
    proto_pos: dict[str, torch.Tensor] = {}
    proto_neg: dict[str, torch.Tensor] = {}
    if prototypes_data:
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
                tensor = torch.tensor(vectors, device=device, dtype=text_embeds.dtype)
                # Re-normalizar (defensivo — los embeddings ya vienen así
                # de compute_image_embeddings, pero el cómputo coseno lo
                # requiere)
                tensor = tensor / tensor.norm(dim=-1, keepdim=True)
                target_dict[lid] = tensor
        n_proto_pos = sum(t.shape[0] for t in proto_pos.values())
        n_proto_neg = sum(t.shape[0] for t in proto_neg.values())
        print(
            f"🧬 prototipos aplicados al scoring: "
            f"{len(proto_pos)} labels con +protos ({n_proto_pos} embeds), "
            f"{len(proto_neg)} labels con −protos ({n_proto_neg} embeds)\n"
        )

    # SigLIP usa logit_scale + logit_bias para escalar el dot product antes
    # del sigmoid. Los exponemos como tensores para usar en el loop.
    logit_scale = model.logit_scale.exp().detach()
    logit_bias  = model.logit_bias.detach()

    # ── Loop principal ───────────────────────────────────────────────────
    results: dict[str, dict] = dict(existing)  # arranca con lo ya hecho
    start = time.time()
    since_checkpoint = 0

    pbar = tqdm(range(0, len(pending), BATCH), desc="Clasificando", unit="batch")
    new_cache_entries: int = 0   # contador desde el último save de cache
    for i in pbar:
        batch_paths = pending[i:i + BATCH]

        # ── Split del batch: cached vs need encoding ────────────────────
        # Si la img ya tiene embedding cacheado de runs anteriores, lo
        # reusamos (ahorra ~270ms por img). Si no, va al vision encoder.
        paths_for_scoring:  list[Path]         = []
        embeds_for_scoring: list[torch.Tensor] = []
        to_encode:          list[Path]         = []
        for p in batch_paths:
            cached = emb_cache.get(p.stem) if not args.no_cache else None
            if cached is not None:
                paths_for_scoring.append(p)
                embeds_for_scoring.append(cached.to(device))
            else:
                to_encode.append(p)

        # ── Encoder solo lo que falta (vision encoder es lo caro) ───────
        if to_encode:
            images = []
            kept_paths = []
            for p in to_encode:
                try:
                    images.append(Image.open(p).convert("RGB"))
                    kept_paths.append(p)
                except Exception as e:  # noqa: BLE001
                    print(f"\n⚠  No pude abrir {p.name}: {e}")

            if images:
                with torch.no_grad():
                    img_inputs = processor(images=images, return_tensors="pt").to(device)
                    new_embeds = model.get_image_features(**img_inputs)
                    new_embeds = new_embeds / new_embeds.norm(dim=-1, keepdim=True)

                for p, emb in zip(kept_paths, new_embeds):
                    # Guardar en cache (CPU para storage compacto)
                    if not args.no_cache:
                        emb_cache[p.stem] = emb.detach().cpu()
                        new_cache_entries += 1
                    paths_for_scoring.append(p)
                    embeds_for_scoring.append(emb)

        if not paths_for_scoring:
            continue

        # ── Batch score (rápido, no depende de cuántos vinieron de cache) ─
        with torch.no_grad():
            img_embeds = torch.stack(embeds_for_scoring)
            logits     = img_embeds @ text_embeds.T * logit_scale + logit_bias
            probs      = torch.sigmoid(logits)
            neg_logits = img_embeds @ neg_text_embeds.T * logit_scale + logit_bias
            neg_probs  = torch.sigmoid(neg_logits) * has_neg_mask          # 0 para labels sin negativo
            probs      = (probs - NEG_WEIGHT * neg_probs).clamp(0.0, 1.0)

            # ── Fase C: ajuste kNN sobre prototipos humanos ──────────
            # Boost (zona incierta) y penalty (siempre) basados en sim
            # coseno con prototipos confirmados / excluidos por humanos.
            # Idéntico a la lógica de modal_app.py.
            if proto_pos or proto_neg:
                for li, lid in enumerate(label_ids):
                    if lid in proto_pos:
                        pp = proto_pos[lid]
                        sim_pos     = img_embeds @ pp.T  # (n_imgs, N_pos)
                        max_sim_pos = sim_pos.max(dim=1).values
                        boost       = torch.clamp(max_sim_pos - KNN_SIM_THRESHOLD, min=0) * KNN_BOOST_WEIGHT
                        score_col   = probs[:, li]
                        uncertain   = (score_col > KNN_UNCERTAIN_LO) & (score_col < KNN_UNCERTAIN_HI)
                        probs[:, li] = score_col + boost * uncertain.to(probs.dtype)
                    if lid in proto_neg:
                        pn = proto_neg[lid]
                        sim_neg     = img_embeds @ pn.T  # (n_imgs, N_neg)
                        max_sim_neg = sim_neg.max(dim=1).values
                        penalty     = torch.clamp(max_sim_neg - KNN_SIM_THRESHOLD, min=0) * KNN_PENALTY_WEIGHT
                        probs[:, li] = probs[:, li] - penalty
                probs = probs.clamp(0.0, 1.0)

        # Per-image: check confidence + retry con Gemini si toca
        for path, img_emb, prob_row in zip(paths_for_scoring, img_embeds, probs):
            sha       = path.stem
            max_score = float(prob_row.max().item())

            # ── Auto-discovery con Gemini → Groq fallback ──────────────
            # Si SigLIP no llegó a THRESHOLD, intentamos en orden:
            #   1. Gemini (si disponible y key OK)
            #   2. Groq como fallback (si Gemini falla o quota agotada)
            # Cada provider tiene cuotas independientes → si uno cae, el
            # otro sigue. Las suggestions se acumulan en discovered_labels
            # con `discoveredBy` marcando quién las encontró.
            gemini_usable = gemini_client is not None and gemini_state.available
            groq_usable   = groq_client   is not None and groq_state.available
            if (max_score < THRESHOLD) and (gemini_usable or groq_usable):
                suggestions: Optional[list[dict]] = None
                discovery_source: str = ""

                # Top-N labels más relevantes a ESTA imagen (por score SigLIP).
                # Pasados a Gemini/Groq como contexto en lugar de los ~118
                # existing_ids — reduce ruido del prompt y mejora tasa de
                # aceptación. El validator sigue usando el set completo para
                # rechazar duplicados.
                score_pairs = list(zip(label_ids, prob_row.tolist()))
                score_pairs.sort(key=lambda x: -x[1])
                top_relevant = [
                    (lid, float(sc)) for lid, sc in score_pairs[:TOP_RELEVANT_FOR_DISCOVERY]
                ]

                # Intento 1: Gemini (preferido por calidad típica)
                if gemini_usable:
                    gemini_state.images_with_gemini += 1
                    suggestions = call_gemini(
                        gemini_client, path, set(label_ids), gemini_state,
                        top_relevant=top_relevant,
                    )
                    if suggestions:
                        discovery_source = "gemini"

                # Intento 2: Groq como fallback. Se ejecuta si:
                # - No había Gemini disponible al entrar
                # - O Gemini se ejecutó pero devolvió None/[] (error, vacío)
                # Re-chequeamos groq_usable porque el call de gemini puede
                # haberlo cambiado (poco probable pero defensivo).
                if not suggestions:
                    groq_usable_now = groq_client is not None and groq_state.available
                    if groq_usable_now:
                        groq_state.images_with_groq += 1
                        suggestions = call_groq(
                            groq_client, path, set(label_ids), groq_state,
                            top_relevant=top_relevant,
                        )
                        if suggestions:
                            discovery_source = "groq"

                if suggestions:
                    new_embeds_chunks: list[torch.Tensor] = []
                    new_ids: list[str] = []
                    for sugg in suggestions:
                        # Defensa extra: skip si ya está (race con validación)
                        if sugg["id"] in label_ids:
                            continue
                        try:
                            emb = encode_label_embedding(
                                processor, model, sugg["prompts"], device,
                            )
                        except Exception as e:  # noqa: BLE001
                            print(f"\n⚠  No se pudo codificar label '{sugg['id']}': {e}")
                            continue
                        new_embeds_chunks.append(emb)
                        new_ids.append(sugg["id"])
                        discovered.append({
                            "id":             sugg["id"],
                            "displayEs":      sugg["displayEs"],
                            "category":       sugg["category"],
                            "prompts":        sugg["prompts"],
                            "discoveredFrom": sha,
                            "discoveredAt":   datetime.now(timezone.utc).isoformat(),
                            "discoveredBy":   discovery_source,
                        })
                        active_labels.append((sugg["id"], sugg["prompts"]))

                    if new_embeds_chunks:
                        text_embeds = torch.cat([text_embeds, *new_embeds_chunks], dim=0)
                        # Nuevas labels dinámicas sin negativos predefinidos → vector cero
                        n_new = len(new_embeds_chunks)
                        neg_text_embeds = torch.cat([
                            neg_text_embeds,
                            torch.zeros((n_new, emb_dim), device=device, dtype=neg_text_embeds.dtype),
                        ], dim=0)
                        has_neg_mask = torch.cat([
                            has_neg_mask,
                            torch.zeros(n_new, device=device, dtype=has_neg_mask.dtype),
                        ], dim=0)
                        label_ids.extend(new_ids)
                        if discovery_source == "gemini":
                            gemini_state.suggestions_added += len(new_ids)
                        elif discovery_source == "groq":
                            groq_state.suggestions_added += len(new_ids)
                        # Persistir tras CADA discovery — si el script muere
                        # no perdemos progreso de vocabulario.
                        save_discovered_labels(discovered)
                        # Re-scorear ESTA imagen con vocabulario expandido (incluye negativos)
                        # Aplica también kNN sobre prototipos (Fase C) — mismas reglas
                        # que el scoring principal de batch.
                        with torch.no_grad():
                            logits_re     = img_emb.unsqueeze(0) @ text_embeds.T * logit_scale + logit_bias
                            neg_logits_re = img_emb.unsqueeze(0) @ neg_text_embeds.T * logit_scale + logit_bias
                            neg_probs_re  = torch.sigmoid(neg_logits_re) * has_neg_mask
                            probs_re      = (torch.sigmoid(logits_re) - NEG_WEIGHT * neg_probs_re).clamp(0.0, 1.0)
                            # kNN boost/penalty (Fase C)
                            if proto_pos or proto_neg:
                                img_emb_2d = img_emb.unsqueeze(0)  # (1, D)
                                for li_re, lid_re in enumerate(label_ids):
                                    if lid_re in proto_pos:
                                        pp_re   = proto_pos[lid_re]
                                        sim_p   = (img_emb_2d @ pp_re.T).max(dim=1).values  # (1,)
                                        boost_r = torch.clamp(sim_p - KNN_SIM_THRESHOLD, min=0) * KNN_BOOST_WEIGHT
                                        sc_re   = probs_re[0, li_re]
                                        if KNN_UNCERTAIN_LO < float(sc_re) < KNN_UNCERTAIN_HI:
                                            probs_re[0, li_re] = sc_re + boost_r[0]
                                    if lid_re in proto_neg:
                                        pn_re    = proto_neg[lid_re]
                                        sim_n    = (img_emb_2d @ pn_re.T).max(dim=1).values
                                        pen_r    = torch.clamp(sim_n - KNN_SIM_THRESHOLD, min=0) * KNN_PENALTY_WEIGHT
                                        probs_re[0, li_re] = probs_re[0, li_re] - pen_r[0]
                                probs_re = probs_re.clamp(0.0, 1.0)
                            prob_row = probs_re.squeeze(0)

            # ── Construir tags ─────────────────────────────────────────
            # Regla en dos niveles:
            #   - Rank 1..ALWAYS_KEEP_TOP: incluir si score >= MIN_SCORE
            #     (info mínima garantizada para matching downstream)
            #   - Rank ALWAYS_KEEP_TOP+1..TOP_K: incluir solo si score >= THRESHOLD
            #     (filtra ruido de la cola larga — los tags 4-5 solo si
            #     tienen calidad razonable)
            all_scores = {
                lid: round(float(p), 4)
                for lid, p in zip(label_ids, prob_row.tolist())
            }
            # Aplicar CONFIRMACIONES manuales primero: si el admin marcó
            # "esta sha SÍ es de este tag" y el score real es bajo, lo
            # elevamos al mínimo (0.30 = filtro "medio"). Si ya supera
            # el mínimo, se respeta el valor real.
            sha_confirmations = tag_confirmations.get(sha, set())
            if sha_confirmations:
                for conf_tag in sha_confirmations:
                    if conf_tag in all_scores and all_scores[conf_tag] < CONFIRMED_TAG_MIN_SCORE:
                        all_scores[conf_tag] = CONFIRMED_TAG_MIN_SCORE

            # Manual tags asignados por el admin desde /admin/images-bank.
            # Misma semántica que confirmations + ADEMÁS:
            #   - Inyectan el label en all_scores aunque no estuviera (label nuevo)
            #   - Se preservan SIEMPRE en el output (sin filtros por threshold)
            #   - Marcan flag `humanAssigned` en el output
            sha_manual_tags = manual_tags_by_sha.get(sha, set())
            if sha_manual_tags:
                for man_tag in sha_manual_tags:
                    all_scores[man_tag] = max(all_scores.get(man_tag, 0.0), CONFIRMED_TAG_MIN_SCORE)

            # Aplicar exclusiones manuales: filtrar candidates antes
            # del top-K para que no "ocupen" hueco. Si el admin marcó
            # esta sha-tag como "no corresponde" desde el banco, se
            # excluye aunque tenga score 0.99. EXCEPCIÓN: los manual_tags
            # ganan sobre exclusions (el admin las asignó a propósito).
            sha_exclusions = tag_exclusions.get(sha, set())
            scored_filtered = [
                (lid, sc) for lid, sc in all_scores.items()
                if lid not in sha_exclusions or lid in sha_manual_tags
            ]
            candidates = sorted(scored_filtered, key=lambda x: -x[1])[:TOP_K]
            tags: list[dict] = []
            seen_in_tags: set[str] = set()
            for rank, (lid, score) in enumerate(candidates):
                # Los manuales no se filtran por threshold (verdad humana).
                if score < MIN_SCORE and lid not in sha_manual_tags:
                    # Como están ordenados desc, los siguientes también
                    # serán < MIN_SCORE → cortamos aquí.
                    break
                if rank >= ALWAYS_KEEP_TOP and score < THRESHOLD and lid not in sha_manual_tags:
                    # Tag "extra" (4º, 5º) que no pasa threshold de calidad
                    continue
                tag_entry: dict = {
                    "tag":       lid,
                    "score":     score,
                    "confident": score >= THRESHOLD or lid in sha_manual_tags,
                }
                # `humanAssigned` tiene prioridad visual sobre `humanConfirmed`
                # (asignación directa del admin → señal más fuerte que
                # confirmar un guess del modelo).
                if lid in sha_manual_tags:
                    tag_entry["humanAssigned"] = True
                # `humanConfirmed`: si el admin marcó "SÍ es" para esta
                # (sha, lid) desde el banco, persistimos el flag. Esto hace
                # el classification.json self-contained: la UI puede pintar
                # el check verde sin cruzar con tag_confirmations.json en
                # runtime, y el JSON queda auditable (export, debug, etc.).
                # Lo aplicamos SIEMPRE — independientemente del score real,
                # incluso si ya estaba alto (sirve como "reward signal" del
                # humano que distingue "alta confianza del modelo" de "alta
                # confianza humanamente verificada").
                if lid in sha_confirmations:
                    tag_entry["humanConfirmed"] = True
                tags.append(tag_entry)
                seen_in_tags.add(lid)

            # Garantizar invariante: TODOS los manual_tags están en el
            # output, aunque no entraran al top-K (caso raro porque ya
            # los boost-eamos a CONFIRMED_TAG_MIN_SCORE, pero defensivo).
            for man_tag in sha_manual_tags:
                if man_tag in seen_in_tags:
                    continue
                forced_score = all_scores.get(man_tag, CONFIRMED_TAG_MIN_SCORE)
                tags.append({
                    "tag":           man_tag,
                    "score":         round(float(forced_score), 4),
                    "confident":     True,
                    "humanAssigned": True,
                })
            results[sha] = {
                "filename":  path.name,
                "tags":      tags,
                "allScores": all_scores,
                # Timestamp del momento en que SigLIP procesa esta imagen.
                # Lo usa el banco/picker para el sort "Más recientes
                # tagueadas". Si el script muere y se relanza, las imgs
                # ya guardadas conservan su taggedAt; solo las nuevas
                # reciben uno fresco.
                "taggedAt":  datetime.now(timezone.utc).isoformat(),
            }
            since_checkpoint += 1

        # Checkpoint periódico ───────────────────────────────────────────
        if since_checkpoint >= CHECKPOINT_EVERY:
            write_output(OUTPUT, _build_payload(results, active_labels))
            # Persistir cache de embeddings junto al checkpoint
            if not args.no_cache and new_cache_entries > 0:
                save_embedding_cache(emb_cache, MODEL_ID)
                new_cache_entries = 0
            since_checkpoint = 0
            postfix = {"chk": "✓"}
            if gemini_state.calls_made > 0:
                postfix["gem"] = f"{gemini_state.calls_made}/{gemini_state.suggestions_added}"
            if groq_state.calls_made > 0:
                postfix["groq"] = f"{groq_state.calls_made}/{groq_state.suggestions_added}"
            postfix["cache"] = str(len(emb_cache))
            pbar.set_postfix(postfix)

    elapsed = time.time() - start
    per_img = elapsed / max(1, len(pending))
    print(f"\n✅ {len(pending)} clasificadas en {elapsed:.1f}s ({per_img * 1000:.0f} ms/img)")

    # ── Estadísticas ─────────────────────────────────────────────────────
    tag_counts:           Counter[str] = Counter()
    confident_tag_counts: Counter[str] = Counter()
    no_tags         = 0
    no_confident    = 0
    total_tags      = 0
    total_confident = 0
    for r in results.values():
        if not r["tags"]:
            no_tags += 1
        any_confident = False
        for t in r["tags"]:
            tag_counts[t["tag"]] += 1
            total_tags += 1
            if t.get("confident"):
                confident_tag_counts[t["tag"]] += 1
                total_confident += 1
                any_confident = True
        if not any_confident:
            no_confident += 1

    avg_tags      = total_tags      / max(1, len(results))
    avg_confident = total_confident / max(1, len(results))

    print(f"\n📊 Estadísticas (threshold={THRESHOLD}, top-K={TOP_K}, min_score={MIN_SCORE}):")
    print(f"   Imágenes clasificadas:        {len(results)}")
    print(f"   Sin ningún tag (todo < {MIN_SCORE}):  {no_tags}")
    print(f"   Sin tag confident (top < {THRESHOLD}):  {no_confident}")
    print(f"   Tags totales:                 {total_tags}")
    print(f"   Tags confident totales:       {total_confident}")
    print(f"   Tags por imagen (media):      {avg_tags:.2f}")
    print(f"   Confident por imagen (media): {avg_confident:.2f}")
    print(f"\n📊 Top tags (todos, incluye low-confidence):")
    for tag, count in tag_counts.most_common(15):
        pct = (count / len(results)) * 100
        confident = confident_tag_counts.get(tag, 0)
        print(f"   {count:5d} ({pct:5.1f}%)  {tag:30s}  [{confident} confident]")

    # ── Guardar final ────────────────────────────────────────────────────
    gemini_stats_payload = None
    if gemini_state.calls_made > 0 or gemini_state.suggestions_added > 0:
        gemini_stats_payload = {
            "callsMade":          gemini_state.calls_made,
            "imagesQueried":      gemini_state.images_with_gemini,
            "newLabelsAdded":     gemini_state.suggestions_added,
            "available":          gemini_state.available,
            "disabledReason":     gemini_state.disabled_reason or None,
            "model":              GEMINI_MODEL_ID,
        }

    groq_stats_payload = None
    if groq_state.calls_made > 0 or groq_state.suggestions_added > 0:
        groq_stats_payload = {
            "callsMade":          groq_state.calls_made,
            "imagesQueried":      groq_state.images_with_groq,
            "newLabelsAdded":     groq_state.suggestions_added,
            "available":          groq_state.available,
            "disabledReason":     groq_state.disabled_reason or None,
            "model":              GROQ_MODEL_ID,
        }

    write_output(OUTPUT, _build_payload(
        results,
        active_labels=active_labels,
        tag_counts=tag_counts,
        confident_tag_counts=confident_tag_counts,
        no_tags=no_tags,
        no_confident=no_confident,
        avg_tags=avg_tags,
        avg_confident=avg_confident,
        gemini_stats=gemini_stats_payload,
        groq_stats=groq_stats_payload,
    ))

    # ── Cleanup: promover manual_tags → tag_confirmations ────────────
    # write_output ha completado sin excepción → consideramos el run
    # exitoso. Migramos las entradas de manual_tags.json al
    # tag_confirmations.json local (preservando confirmaciones previas),
    # vaciamos manual_tags.json y dejamos un audit log.
    #
    # Idempotencia: si manual_tags.json estaba vacío, todo es no-op.
    # Atomicidad: cada escritura es independiente; si una falla, la
    # otra puede haber quedado a medias — los JSONs son commit-friendly
    # y el admin verá el estado parcial en local. El próximo run reintenta.
    #
    # NOTA: este cleanup solo afecta los archivos LOCALES. Los R2 se
    # actualizan cuando el admin corra `npm run images:upload-metadata`
    # tras este script. El flujo del workflow ya lo recomienda en help.ts.
    if parsed_manual_tags:
        from classifier_core import (  # noqa: E402
            merge_manual_into_confirmations,
            build_empty_manual_tags_payload,
            build_manual_tags_audit_entry,
        )
        try:
            existing_conf_raw: dict | None = None
            if TAG_CONFIRMATIONS_PATH.exists():
                try:
                    existing_conf_raw = json.loads(TAG_CONFIRMATIONS_PATH.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    existing_conf_raw = None
            merged = merge_manual_into_confirmations(parsed_manual_tags, existing_conf_raw)
            TAG_CONFIRMATIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
            TAG_CONFIRMATIONS_PATH.write_text(
                json.dumps(merged, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            MANUAL_TAGS_PATH.write_text(
                json.dumps(build_empty_manual_tags_payload(), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            # Append-only audit
            history_list: list[dict] = []
            if MANUAL_TAGS_HISTORY_PATH.exists():
                try:
                    prev_hist = json.loads(MANUAL_TAGS_HISTORY_PATH.read_text(encoding="utf-8"))
                    if isinstance(prev_hist, list):
                        history_list = prev_hist
                    elif isinstance(prev_hist, dict) and isinstance(prev_hist.get("entries"), list):
                        history_list = prev_hist["entries"]
                except (json.JSONDecodeError, OSError):
                    history_list = []
            history_list.append(build_manual_tags_audit_entry(
                parsed_manual_tags,
                run_started_at=GENERATED_AT_BEGIN,
                run_succeeded=True,
            ))
            MANUAL_TAGS_HISTORY_PATH.write_text(
                json.dumps({"entries": history_list}, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            total_man = sum(len(v) for v in parsed_manual_tags.values())
            print(f"\n🧹 Cleanup: {len(parsed_manual_tags)} shas / {total_man} manual_tags migrados a tag_confirmations.json")
            print(f"   ↑ Recuerda: `npm run images:upload-metadata` sube los JSONs actualizados a R2")
        except OSError as err:
            # No es fatal — el run principal ya guardó classification.json.
            # El admin puede reintentar el cleanup en el siguiente run.
            print(f"\n⚠️  Cleanup manual_tags FAILED (run de classifier OK): {err}", flush=True)

    # Guardar discovered final (idempotente — ya se guarda tras cada
    # descubrimiento, esto es por si hubo algo en el último batch).
    if discovered:
        save_discovered_labels(discovered)

    # Save final del cache de embeddings (idempotente — ya se guarda en
    # checkpoints, esto es para asegurar el último batch).
    if not args.no_cache and emb_cache:
        save_embedding_cache(emb_cache, MODEL_ID)
        cache_size_mb = EMBEDDINGS_CACHE_PATH.stat().st_size / 1024 / 1024 if EMBEDDINGS_CACHE_PATH.exists() else 0
        print(f"\n💾 Cache de embeddings: {len(emb_cache)} imgs ({cache_size_mb:.1f} MB) en {EMBEDDINGS_CACHE_PATH.name}")

    # Resumen AI providers al final (Gemini + Groq con su breakdown)
    any_ai_called = (
        gemini_state.calls_made > 0
        or groq_state.calls_made > 0
        or gemini_state.suggestions_added > 0
        or groq_state.suggestions_added > 0
    )
    if any_ai_called:
        # Cuenta cuántos discovered vienen de cada provider (acumulado disco)
        gemini_disc = sum(1 for d in discovered if d.get("discoveredBy") == "gemini")
        groq_disc   = sum(1 for d in discovered if d.get("discoveredBy") == "groq")
        legacy_disc = sum(1 for d in discovered if not d.get("discoveredBy"))

        if gemini_state.calls_made > 0 or gemini_state.suggestions_added > 0:
            print(f"\n🤖 Gemini ({GEMINI_MODEL_ID}):")
            print(f"   Llamadas:           {gemini_state.calls_made}")
            print(f"   Imgs consultadas:   {gemini_state.images_with_gemini}")
            print(f"   Labels nuevos:      {gemini_state.suggestions_added} (esta sesión)")
            if not gemini_state.available:
                print(f"   ⚠  Desactivado por: {gemini_state.disabled_reason}")

        if groq_state.calls_made > 0 or groq_state.suggestions_added > 0:
            print(f"\n🦙 Groq ({GROQ_MODEL_ID.split('/')[-1]}):")
            print(f"   Llamadas:           {groq_state.calls_made}")
            print(f"   Imgs consultadas:   {groq_state.images_with_groq}")
            print(f"   Labels nuevos:      {groq_state.suggestions_added} (esta sesión)")
            if not groq_state.available:
                print(f"   ⚠  Desactivado por: {groq_state.disabled_reason}")

        print(f"\n📚 discovered_labels.json:")
        print(f"   Total acumulado:    {len(discovered)}")
        print(f"   ├─ por Gemini:      {gemini_disc}")
        print(f"   ├─ por Groq:        {groq_disc}")
        if legacy_disc:
            print(f"   └─ legacy (pre-tracking): {legacy_disc}")
    # Guardar sugerencias rechazadas (auditoría) — útil cuando Gemini/
    # Groq proponen cosas que el validator descarta (ej. categoría no
    # listada). No-op si no hay rechazos.
    save_rejected_suggestions()

    print(f"\n💾 Output: {OUTPUT}")
    print(f"\n📌 Próximo paso: usar tags para buscar reemplazos.")
    print(f"   sha-audit.json (que preguntas usan cada SHA) + classification.json")
    print(f"   (qué tags tiene cada SHA) = mapa completo para sustituir imágenes")
    print(f"   por las nuevas del banco propio.")


def _build_payload(
    results:              dict[str, dict],
    active_labels:        list[tuple[str, list[str]]] | None = None,
    tag_counts:           Counter[str] | None = None,
    confident_tag_counts: Counter[str] | None = None,
    no_tags:              int | None = None,
    no_confident:         int | None = None,
    avg_tags:             float | None = None,
    avg_confident:        float | None = None,
    gemini_stats:         dict | None = None,
    groq_stats:           dict | None = None,
) -> dict:
    """Encapsula el dict de results en el envelope final con metadata.

    `active_labels` = LABELS hardcoded + discovered Gemini. Si None, cae a
    LABELS hardcoded (útil solo para llamadas intermedias muy tempranas)."""
    labels_to_emit = active_labels if active_labels is not None else list(LABELS)
    payload: dict = {
        "generatedAt":     datetime.now(timezone.utc).isoformat(),
        "model":           MODEL_ID,
        "threshold":       THRESHOLD,
        "topK":            TOP_K,
        "minScore":        MIN_SCORE,
        "imagesProcessed": len(results),
        "labels": [
            {"id": lid, "prompts": prompts}
            for lid, prompts in labels_to_emit
        ],
        "images": results,
    }
    if tag_counts is not None:
        payload["stats"] = {
            "tagCounts":                  dict(tag_counts.most_common()),
            "confidentTagCounts":         dict((confident_tag_counts or Counter()).most_common()),
            "imagesWithoutTags":          no_tags or 0,
            "imagesWithoutConfidentTag":  no_confident or 0,
            "averageTagsPerImage":        round(avg_tags or 0, 2),
            "averageConfidentPerImage":   round(avg_confident or 0, 2),
        }
        if gemini_stats:
            payload["stats"]["gemini"] = gemini_stats
        if groq_stats:
            payload["stats"]["groq"] = groq_stats
    return payload


if __name__ == "__main__":
    main()
