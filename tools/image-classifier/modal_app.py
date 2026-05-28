"""
Modal cloud orchestrator for SigLIP image classification.

Por qué Modal y no la API de HF / local:
  - Local (classify_siglip.py): necesita torch + ~2 GB de deps + el portátil
    encendido las 30-45 min que dura el run en CPU. Útil cuando ya tienes el
    setup hecho y quieres iterar rápido sobre prompts/labels.
  - HF Inference API (classify_hf.py): cero deps locales pero serial y lento
    (~1-3 s/img · 30-60 min para 1.7k imgs) y depende de cold-starts del modelo.
  - **Modal (este archivo)**: cero deps locales relevantes (solo `modal`),
    GPU T4 en cloud → ~80-120 s para todo el banco. Ideal para "no quiero
    que mi PC haga el trabajo". Free tier de Modal cubre ~1200 runs/mes.

Lo que hace el script (paridad funcional con classify_siglip.py):
  1. List R2 keys (todo el bucket excepto prefix `meta/`).
  2. Carga admin overrides desde R2: tag_exclusions, tag_confirmations, prev
     classification.json y discovered_labels.json (de runs anteriores).
  3. Por batches: descarga bytes de R2 → GPU container clasifica via SigLIP →
     scores por label (positivos – NEG_WEIGHT × negativos, clamp 0..1).
  4. **Auto-discovery con Gemini/Groq**: si una imagen no tiene tag confident
     (max_score < THRESHOLD), invoca Gemini → fallback Groq con la imagen
     para sugerir labels nuevos. Las sugerencias válidas se añaden al
     vocabulario en caliente y el batch entero se re-clasifica con el
     vocab expandido.
  5. Aplica admin overrides y construye `classification.json` con la misma
     shape que `classify_siglip.py`.
  6. Sube a R2: meta/classification.json, meta/discovered_labels.json
     (acumulado), meta/rejected_suggestions.json (si hubo).

Diferencias con classify_siglip.py local:
  - SIN cache de embeddings persistente — cada cold-start re-codifica los
    prompts (~1 s, no merece la pena cachear).
  - Re-scoring por batch, no por imagen: si un batch descubre N labels
    nuevos, re-clasifica TODO el batch con vocab expandido en una sola RPC
    (vs N llamadas individuales en local). Resultado equivalente, ~10×
    menos overhead Modal.
  - Persistencia en R2 (no filesystem) — todo lo demás (validación,
    fallback Gemini→Groq, rejected_suggestions audit, etc.) es idéntico.
  - --force preserva el resto del prev: si pasas `--force --limit 10`,
    reprocesa solo esas 10 imgs y MANTIENE las demás clasificaciones del
    JSON anterior intactas (útil para smoke tests sin destruir el banco).

Setup (una sola vez por máquina):
  npm run images:setup-classifier   # crea/actualiza el venv (instala modal)
  # Crear cuenta gratis en https://modal.com/signup (free tier $30/mes, sin tarjeta)
  npm run images:setup-modal        # abre browser y autentica el SDK

Las credenciales R2 + GEMINI_API_KEY + GROQ_API_KEY vienen del `.env.local`
/ `.env` del root del proyecto (las mismas que usa el resto de la app).
Modal las inyecta como secret efímero, no se persisten en su servidor.

Uso:
  npm run images:classify-modal                       # todo (incremental)
  npm run images:classify-modal -- --limit 10         # smoke test
  npm run images:classify-modal -- --force            # reprocesa todo
  npm run images:classify-modal -- --no-gemini        # solo SigLIP base
"""

from __future__ import annotations

import json
import os
import sys
from io import BytesIO
from pathlib import Path
from typing import Optional

import modal

# ── Path setup: importar labels.py tanto en local como en contenedor ────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from labels import LABELS, LABEL_NEGATIVES, NEG_WEIGHT  # noqa: E402

# `ROOT` = raíz del repo. Solo válido localmente; en el container de Modal el
# archivo vive en `/root/modal_app.py` (path plano) → parents[2] lanzaría
# IndexError. ROOT solo se usa en el local_entrypoint, gateamos con try/except.
try:
    ROOT: Optional[Path] = Path(__file__).resolve().parents[2]
except IndexError:
    ROOT = None  # estamos en el container Modal — ROOT no aplica

# ── Constantes importadas de classifier_core (single source of truth) ──
# Antes del refactor (#37) estaban duplicadas aquí + en classify_siglip.py.
# Ahora viven en classifier_core.py para garantizar que ambos clasifica-
# dores (local y cloud) usen exactamente los mismos valores.
from classifier_core import (  # noqa: E402
    MODEL_ID, THRESHOLD, TOP_K, ALWAYS_KEEP_TOP, MIN_SCORE, CONFIRMED_BOOST,
    KNN_MIN_PROTOS, KNN_SIM_THRESHOLD, KNN_BOOST_WEIGHT, KNN_PENALTY_WEIGHT,
    KNN_UNCERTAIN_LO, KNN_UNCERTAIN_HI,
)

# ── Constantes específicas de modal_app (no aplican al local) ──────────
BATCH_SIZE       = 32     # imágenes por batch en GPU (T4 tiene 16 GB, holgura)

# Checkpoint cada N batches subimos el JSON parcial a R2. Evita perder
# trabajo si el run se cae (timeout, Ctrl+C, network, quota Gemini agotada,
# OOM, etc.). 5 batches × 32 imgs = 160 imgs entre checkpoints — sube
# ~3 PUTs a R2 (~500ms total) cada vez. Para 1748 imgs son ~10-15s extras
# en el run completo, despreciable. Si crashea, el próximo run sin --force
# detecta los SHAs ya en R2 y los salta automáticamente (idempotencia).
CHECKPOINT_EVERY_N_BATCHES = 5

# ── Constantes auto-discovery — importadas de classifier_core ──────────
# Eliminadas las duplicaciones de GEMINI_MODEL_ID, GROQ_MODEL_ID,
# VALID_CATEGORIES_LIST, VALID_CATEGORIES, DISCOVERY_PROMPT_TEMPLATE y
# TOP_RELEVANT_FOR_DISCOVERY. Single source of truth en classifier_core.
from classifier_core import (  # noqa: E402
    GEMINI_MODEL_ID, GROQ_MODEL_ID,
    VALID_CATEGORIES_LIST, VALID_CATEGORIES,
    DISCOVERY_PROMPT_TEMPLATE,
    TOP_RELEVANT_FOR_DISCOVERY,
)

# ── Modal app + image ───────────────────────────────────────────────────
app = modal.App("dgt-siglip-classifier")

# Container con torch CUDA + transformers + boto3 + Gemini/Groq SDKs.
# google-genai y groq son ligeros (~5 MB cada) y dejan al orchestrate hacer
# auto-discovery con las mismas APIs que classify_siglip.py local.
#
# sentencepiece + protobuf: el SiglipTokenizer los requiere (aunque uses
# use_fast=True). En versiones antiguas de transformers venían como dep
# transitiva, pero en 4.46+ ya NO — hay que pedirlos explícitamente o
# `AutoProcessor.from_pretrained(...)` lanza ImportError al cargar el
# modelo.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.4.1",
        "transformers==4.46.0",
        "Pillow==11.0.0",
        "boto3==1.35.0",
        "accelerate==0.34.2",
        "sentencepiece>=0.2",
        "protobuf>=4.0",
        "google-genai>=1.0",
        "groq>=0.11",
    )
    .add_local_python_source("labels")
    .add_local_python_source("classifier_core")
)

# Volume persistente para cachear los pesos del modelo entre cold-starts.
model_cache = modal.Volume.from_name("dgt-siglip-cache", create_if_missing=True)


# ── Carga de credenciales desde .env / .env.local ───────────────────────
def _load_env_for_modal() -> dict[str, str]:
    """Lee R2_* + GEMINI_API_KEY + GROQ_API_KEY del .env.local primero,
    .env después. Mismo orden de prioridad que el resto del proyecto.
    Devuelve {} si estamos en el contenedor (ROOT=None) — las creds llegan
    vía `secrets=[...]`, no via filesystem.
    """
    if ROOT is None:
        return {}
    keys = {
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME",
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
    }
    out: dict[str, str] = {}
    for env_file in [ROOT / ".env.local", ROOT / ".env"]:
        if not env_file.exists():
            continue
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
                v = v[1:-1]
            if k in keys and k not in out:
                out[k] = v
    return out


# Construye el secret en build-time. Necesitamos al menos R2_*; Gemini/Groq
# son opcionales — si no están, el discovery se desactiva (warning en log).
_env_loaded = _load_env_for_modal()
_r2_keys = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME")
if all(k in _env_loaded for k in _r2_keys):
    # Pasamos TODAS las keys (R2 + Gemini/Groq si las tenemos) al container
    _secret_payload = {k: v for k, v in _env_loaded.items() if v}
    classifier_secret = modal.Secret.from_dict(_secret_payload)
else:
    # Fallback: secret pre-creado en Modal
    classifier_secret = modal.Secret.from_name("r2-credentials")


# ── Auto-discovery: helpers a nivel de módulo (clonados de classify_siglip.py) ──

# Imports opcionales — falla suave si no están instalados (local entrypoint
# no los necesita; el container sí los tiene vía la image de Modal).
try:
    from google import genai as google_genai
    from google.genai import types as genai_types
except ImportError:
    google_genai = None  # type: ignore
    genai_types  = None  # type: ignore

try:
    from groq import Groq as GroqClient
except ImportError:
    GroqClient = None  # type: ignore


class GeminiState:
    """Estado compartido del flujo Gemini durante un run."""
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


# Buffer global de sugerencias RECHAZADAS por _validate_suggestion. Se
# vuelca a R2 (meta/rejected_suggestions.json) al final del run para que el
# humano pueda auditar por qué la IA propuso cosas que el validator descartó.
REJECTED_SUGGESTIONS: list[dict] = []


def _mime_of_filename(name: str) -> str:
    """Mime type a partir del filename (no del path completo)."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext == "png":  return "image/png"
    if ext == "webp": return "image/webp"
    return "image/jpeg"


def _validate_suggestion(s: object, existing_ids: set[str], image_name: str = "?") -> Optional[dict]:
    """Valida una sugerencia de label de Gemini/Groq. Devuelve dict
    normalizado o None si es inválida/duplicada. Si rechaza, registra el
    motivo en REJECTED_SUGGESTIONS para audit.
    """
    from datetime import datetime, timezone

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


def _format_top_relevant(top_relevant: list[tuple[str, float]]) -> str:
    """Renderiza top-N labels como lista markdown para el prompt:
        - urban_street          (score 0.42)
        - intersection          (score 0.31)
        ...
    """
    if not top_relevant:
        return "(no labels with significant score for this image)"
    lines = []
    for lid, sc in top_relevant:
        lines.append(f"- {lid:<30s} (score {sc:.3f})")
    return "\n".join(lines)


def call_gemini_bytes(
    client,
    image_bytes:   bytes,
    mime:          str,
    image_name:    str,
    existing_ids:  set[str],
    top_relevant:  list[tuple[str, float]],
    state:         GeminiState,
) -> Optional[list[dict]]:
    """Variante de classify_siglip.call_gemini que toma BYTES directamente
    (no path) — porque en Modal las imgs vienen de R2 en memoria, no
    están en filesystem.

    `existing_ids`: set COMPLETO de labels existentes (para validation).
    `top_relevant`: lista [(label_id, score), ...] del TOP-N más relevante
                    a la imagen (para el prompt — la IA solo ve estos).

    Devuelve list[dict] validada, [] si no hay propuestas, None si error
    (incluido quota agotada → state.available=False).
    """
    if not state.available or client is None or genai_types is None:
        return None
    try:
        n_other = max(0, len(existing_ids) - len(top_relevant))
        prompt = DISCOVERY_PROMPT_TEMPLATE.format(
            top_relevant=_format_top_relevant(top_relevant),
            n_top=len(top_relevant),
            n_other=n_other,
        )
        response = client.models.generate_content(
            model    = GEMINI_MODEL_ID,
            contents = [
                genai_types.Part.from_bytes(data=image_bytes, mime_type=mime),
                prompt,
            ],
            config   = genai_types.GenerateContentConfig(
                response_mime_type = "application/json",
                temperature        = 0.3,
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
            return []
        # Normalizar: el prompt pide {"labels": [...]} pero a veces devuelve
        # solo el array. Aceptamos ambos.
        if isinstance(raw, dict):
            arr = raw.get("labels")
            if isinstance(arr, list):
                raw = arr
            else:
                # primer valor lista del dict
                arr = next((v for v in raw.values() if isinstance(v, list)), None)
                if arr is None:
                    return []
                raw = arr
        if not isinstance(raw, list):
            return []
        validated: list[dict] = []
        for s in raw:
            v = _validate_suggestion(s, existing_ids, image_name)
            if v is not None:
                validated.append(v)
                existing_ids.add(v["id"])
        return validated
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        is_quota = any(k in msg for k in (
            "quota", "rate limit", "429", "resource_exhausted",
            "resource exhausted", "exceeded", "too many requests",
        ))
        is_auth = any(k in msg for k in (
            "api key not valid", "api_key_invalid", "api key invalid",
            "unauthorized", "permission denied", "permission_denied",
            "401", "403", "invalid api key",
        ))
        is_overload = any(k in msg for k in (
            "503", "unavailable", "high demand", "model is currently",
        ))
        if is_quota:
            state.available = False
            state.disabled_reason = "quota_exhausted"
            print(f"\n⚠  Gemini quota agotada — desactivando para resto del run", flush=True)
            print(f"   Mensaje: {str(e)[:200]}", flush=True)
        elif is_auth:
            state.available = False
            state.disabled_reason = "auth_error"
            print(f"\n⚠  Gemini API key INVÁLIDA — desactivando", flush=True)
            print(f"   La key en .env.local probablemente está expirada.", flush=True)
            print(f"   Mensaje: {str(e)[:200]}", flush=True)
        elif is_overload:
            state.available = False
            state.disabled_reason = "model_overloaded"
            print(f"\n⚠  Gemini sobrecargado (503) — desactivando para resto del run", flush=True)
            print(f"   Mensaje: {str(e)[:200]}", flush=True)
        else:
            print(f"\n⚠  Gemini error en {image_name[:12]}: {str(e)[:200]}", flush=True)
        return None


def call_groq_bytes(
    client,
    image_bytes:   bytes,
    mime:          str,
    image_name:    str,
    existing_ids:  set[str],
    top_relevant:  list[tuple[str, float]],
    state:         GroqState,
) -> Optional[list[dict]]:
    """Variante bytes de classify_siglip.call_groq. Devuelve igual que
    call_gemini_bytes. Ver call_gemini_bytes para semántica de
    `existing_ids` vs `top_relevant`.
    """
    if not state.available or client is None:
        return None
    try:
        import base64
        from datetime import datetime, timezone
        b64 = base64.b64encode(image_bytes).decode("ascii")
        n_other = max(0, len(existing_ids) - len(top_relevant))
        prompt = DISCOVERY_PROMPT_TEMPLATE.format(
            top_relevant=_format_top_relevant(top_relevant),
            n_top=len(top_relevant),
            n_other=n_other,
        )
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
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    ],
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=800,
        )
        state.calls_made += 1
        text = (response.choices[0].message.content or "").strip()
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return []
        if isinstance(raw, dict):
            arr = raw.get("labels")
            if not isinstance(arr, list):
                arr = next((v for v in raw.values() if isinstance(v, list)), None)
            if arr is None:
                if "id" in raw and "prompts" in raw:
                    arr = [raw]
                else:
                    return []
            raw = arr
        if not isinstance(raw, list):
            return []
        # Groq a veces devuelve strings planos en vez de objetos
        if raw and all(isinstance(s, str) for s in raw):
            for s in raw:
                REJECTED_SUGGESTIONS.append({
                    "image":      image_name,
                    "rejectedAt": datetime.now(timezone.utc).isoformat(),
                    "reason":     "Groq devolvió string en vez de objeto (formato incorrecto)",
                    "suggestion": {"raw_string": s[:200]},
                })
            return []
        validated: list[dict] = []
        for s in raw:
            v = _validate_suggestion(s, existing_ids, image_name)
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
        is_auth = any(k in msg for k in (
            "api key not valid", "api_key_invalid", "invalid api key",
            "unauthorized", "permission denied", "401", "403",
            "invalid_api_key",
        ))
        is_overload = any(k in msg for k in (
            "503", "service unavailable", "overloaded",
        ))
        if is_quota:
            state.available = False
            state.disabled_reason = "quota_exhausted"
            print(f"\n⚠  Groq quota agotada — desactivando", flush=True)
            print(f"   Mensaje: {str(e)[:200]}", flush=True)
        elif is_auth:
            state.available = False
            state.disabled_reason = "auth_error"
            print(f"\n⚠  Groq API key INVÁLIDA — desactivando", flush=True)
            print(f"   Mensaje: {str(e)[:200]}", flush=True)
        elif is_overload:
            state.available = False
            state.disabled_reason = "model_overloaded"
            print(f"\n⚠  Groq sobrecargado — desactivando", flush=True)
            print(f"   Mensaje: {str(e)[:200]}", flush=True)
        else:
            print(f"\n⚠  Groq error en {image_name[:12]}: {str(e)[:200]}", flush=True)
        return None


# ── Classifier (vive en un contenedor con GPU) ──────────────────────────
@app.cls(
    image=image,
    gpu="T4",                # T4 ≈ $0.59/hr; sobra para SigLIP base (~2 GB VRAM)
    timeout=3600,
    volumes={"/cache": model_cache},
    scaledown_window=300,
)
class SiglipClassifier:
    @modal.enter()
    def setup(self) -> None:
        """Carga el modelo y pre-computa text_embeds + neg_text_embeds
        para LABELS (NO incluye discovered — esos se añaden vía add_labels()).
        """
        import torch
        from transformers import AutoModel, AutoProcessor

        os.environ["HF_HOME"] = "/cache/hf"
        os.environ["TRANSFORMERS_CACHE"] = "/cache/hf"

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[setup] device={self.device}", flush=True)
        print(f"[setup] loading {MODEL_ID}...", flush=True)
        self.processor = AutoProcessor.from_pretrained(MODEL_ID, use_fast=True)
        self.model = AutoModel.from_pretrained(MODEL_ID).to(self.device).eval()

        self.logit_scale = self.model.logit_scale.exp().detach()
        self.logit_bias  = self.model.logit_bias.detach()

        # Ensemble de prompts → text_embeds (NxD)
        self.label_ids: list[str] = []
        flat_prompts: list[str] = []
        prompt_to_label: list[int] = []
        for li, (lid, prompts) in enumerate(LABELS):
            self.label_ids.append(lid)
            for p in prompts:
                flat_prompts.append(p)
                prompt_to_label.append(li)

        print(f"[setup] encoding {len(flat_prompts)} prompts across {len(LABELS)} labels...", flush=True)
        with torch.no_grad():
            ti = self.processor(text=flat_prompts, padding="max_length", return_tensors="pt").to(self.device)
            raw = self.model.get_text_features(**ti)
            raw = raw / raw.norm(dim=-1, keepdim=True)
        n_labels = len(self.label_ids)
        D = raw.shape[1]
        self.D = D  # guardamos para extender dinámicamente luego
        text_embeds = torch.zeros((n_labels, D), device=self.device, dtype=raw.dtype)
        counts      = torch.zeros(n_labels, device=self.device, dtype=raw.dtype)
        for i, li in enumerate(prompt_to_label):
            text_embeds[li] += raw[i]
            counts[li]      += 1
        text_embeds = text_embeds / counts.unsqueeze(-1)
        text_embeds = text_embeds / text_embeds.norm(dim=-1, keepdim=True)
        self.text_embeds = text_embeds

        # Negativos
        neg_text_embeds = torch.zeros((n_labels, D), device=self.device, dtype=text_embeds.dtype)
        has_neg_mask    = torch.zeros(n_labels, device=self.device, dtype=text_embeds.dtype)
        for li, lid in enumerate(self.label_ids):
            neg_prompts = LABEL_NEGATIVES.get(lid)
            if not neg_prompts:
                continue
            with torch.no_grad():
                ti  = self.processor(text=neg_prompts, padding="max_length", return_tensors="pt").to(self.device)
                e   = self.model.get_text_features(**ti)
                e   = e / e.norm(dim=-1, keepdim=True)
                avg = e.mean(dim=0, keepdim=True)
                avg = avg / avg.norm(dim=-1, keepdim=True)
            neg_text_embeds[li] = avg.squeeze(0)
            has_neg_mask[li]    = 1.0
        self.neg_text_embeds = neg_text_embeds
        self.has_neg_mask    = has_neg_mask
        n_neg = int(has_neg_mask.sum().item())
        print(f"[setup] {n_neg} labels with negative prompts (NEG_WEIGHT={NEG_WEIGHT})", flush=True)
        print(f"[setup] ready ({n_labels} labels × {D}-dim embeddings)", flush=True)

    @modal.method()
    def get_label_ids(self) -> list[str]:
        """Devuelve el orden actual de labels (LABELS + discovered añadidos)."""
        return self.label_ids

    @modal.method()
    def apply_refinements(self, refinements: dict[str, dict]) -> dict[str, int]:
        """Aplica refinements (Fase B) REEMPLAZANDO los prompts originales
        de labels ya en el vocabulario.

        `refinements` shape: {lid: {refinedPositives: [...], refinedNegatives: [...]}}.

        Para cada lid:
          - Si tiene refinedPositives → re-encode y reemplaza self.text_embeds[idx]
          - Si tiene refinedNegatives → re-encode y reemplaza self.neg_text_embeds[idx]
            + activa has_neg_mask[idx]

        Returns: dict con conteo de positivos y negativos efectivamente
        reemplazados.
        """
        torch = self.torch
        n_pos_applied = 0
        n_neg_applied = 0
        if not refinements:
            return {"positives": 0, "negatives": 0}

        # Index para lookup rápido de label_id → posición en text_embeds
        lid_to_idx = {lid: i for i, lid in enumerate(self.label_ids)}

        for lid, ref in refinements.items():
            idx = lid_to_idx.get(lid)
            if idx is None:
                # Label no está en el vocab (puede ser un discovered no cargado aún)
                continue

            # Refinar positivos
            rp = ref.get("refinedPositives")
            if isinstance(rp, list) and rp:
                try:
                    with torch.no_grad():
                        ti  = self.processor(text=rp, padding="max_length", return_tensors="pt").to(self.device)
                        e   = self.model.get_text_features(**ti)
                        e   = e / e.norm(dim=-1, keepdim=True)
                        avg = e.mean(dim=0, keepdim=True)
                        avg = avg / avg.norm(dim=-1, keepdim=True)
                    self.text_embeds[idx] = avg.squeeze(0)
                    n_pos_applied += 1
                except Exception as e:  # noqa: BLE001
                    print(f"[refinement] failed positives for '{lid}': {e}", flush=True)

            # Refinar negativos
            rn = ref.get("refinedNegatives")
            if isinstance(rn, list) and rn:
                try:
                    with torch.no_grad():
                        ti  = self.processor(text=rn, padding="max_length", return_tensors="pt").to(self.device)
                        e   = self.model.get_text_features(**ti)
                        e   = e / e.norm(dim=-1, keepdim=True)
                        avg = e.mean(dim=0, keepdim=True)
                        avg = avg / avg.norm(dim=-1, keepdim=True)
                    self.neg_text_embeds[idx] = avg.squeeze(0)
                    self.has_neg_mask[idx]    = 1.0
                    n_neg_applied += 1
                except Exception as e:  # noqa: BLE001
                    print(f"[refinement] failed negatives for '{lid}': {e}", flush=True)

        print(
            f"[refinement] aplicados {n_pos_applied} positivos y "
            f"{n_neg_applied} negativos refinados",
            flush=True,
        )
        return {"positives": n_pos_applied, "negatives": n_neg_applied}

    @modal.method()
    def add_labels(self, labels: list[dict]) -> int:
        """Añade labels al vocabulario en caliente. Cada label es un dict
        {id, prompts: [str], ...}. Skip duplicados.

        Usado para:
          - Cargar discovered_labels.json al inicio del run
          - Añadir nuevas sugerencias de Gemini/Groq durante el run

        Returns:
          Número de labels efectivamente añadidos.
        """
        torch = self.torch
        if not labels:
            return 0
        added = 0
        for label in labels:
            lid = label.get("id")
            prompts = label.get("prompts")
            if not lid or not isinstance(prompts, list) or len(prompts) == 0:
                continue
            if lid in self.label_ids:
                continue  # idempotente

            with torch.no_grad():
                ti  = self.processor(text=prompts, padding="max_length", return_tensors="pt").to(self.device)
                e   = self.model.get_text_features(**ti)
                e   = e / e.norm(dim=-1, keepdim=True)
                avg = e.mean(dim=0, keepdim=True)
                avg = avg / avg.norm(dim=-1, keepdim=True)

            self.text_embeds = torch.cat([self.text_embeds, avg], dim=0)
            self.neg_text_embeds = torch.cat([
                self.neg_text_embeds,
                torch.zeros((1, self.D), device=self.device, dtype=self.neg_text_embeds.dtype),
            ], dim=0)
            self.has_neg_mask = torch.cat([
                self.has_neg_mask,
                torch.zeros(1, device=self.device, dtype=self.has_neg_mask.dtype),
            ], dim=0)
            self.label_ids.append(lid)
            added += 1
        if added > 0:
            print(f"[classifier] +{added} labels añadidos → {len(self.label_ids)} totales", flush=True)
        return added

    @modal.method()
    def compute_image_embeddings(self, image_bytes_list: list[bytes]) -> list[list[float]]:
        """Devuelve los embeddings SigLIP normalizados (L2) de cada imagen,
        sin clasificar contra el vocabulario. Usado por compute_prototypes
        para generar el banco de prototipos kNN (Fase C).

        Returns: list de embeddings (list[float]) en mismo orden que el input.
        Imágenes que no decodifican → embedding vacío [].
        """
        from PIL import Image
        torch = self.torch

        images: list = []
        valid_indices: list[int] = []
        for idx, raw_bytes in enumerate(image_bytes_list):
            try:
                im = Image.open(BytesIO(raw_bytes)).convert("RGB")
                images.append(im)
                valid_indices.append(idx)
            except Exception as e:  # noqa: BLE001
                print(f"[embed] decode failed idx={idx}: {e}", flush=True)

        results: list[list[float]] = [[] for _ in image_bytes_list]
        if not images:
            return results

        with torch.no_grad():
            inputs     = self.processor(images=images, return_tensors="pt").to(self.device)
            img_embeds = self.model.get_image_features(**inputs)
            img_embeds = img_embeds / img_embeds.norm(dim=-1, keepdim=True)
        embs = img_embeds.cpu().tolist()
        for vidx, emb in zip(valid_indices, embs):
            results[vidx] = emb
        return results

    @modal.method()
    def set_prototypes(self, prototypes_data: dict) -> dict:
        """Carga los prototipos kNN al classifier (Fase C).

        `prototypes_data` shape:
          {
            lid: {
              "positive": [{"sha": "...", "embedding": [768 floats]}, ...],
              "negative": [{"sha": "...", "embedding": [768 floats]}, ...]
            }
          }

        Construye tensores en GPU para hacer matmul rápido en classify_batch.

        Returns: dict con conteos efectivamente cargados.
        """
        torch = self.torch
        self.proto_pos = {}  # type: dict[str, "torch.Tensor"]
        self.proto_neg = {}
        n_pos_total = 0
        n_neg_total = 0
        for lid, data in (prototypes_data or {}).items():
            for sign_key, target_dict, counter in [
                ("positive", self.proto_pos, "n_pos_total"),
                ("negative", self.proto_neg, "n_neg_total"),
            ]:
                items = data.get(sign_key)
                if not isinstance(items, list) or len(items) < KNN_MIN_PROTOS:
                    continue
                # Filter valid embeddings (correct dim)
                vectors: list[list[float]] = []
                for it in items:
                    emb = it.get("embedding") if isinstance(it, dict) else None
                    if isinstance(emb, list) and len(emb) == self.D:
                        vectors.append(emb)
                if len(vectors) < KNN_MIN_PROTOS:
                    continue
                tensor = torch.tensor(vectors, device=self.device, dtype=self.text_embeds.dtype)
                # Re-normalizar por si acaso (los embeddings deberían venir
                # ya normalizados desde compute_image_embeddings, pero
                # defensivo — el cómputo coseno requiere unit vectors)
                tensor = tensor / tensor.norm(dim=-1, keepdim=True)
                target_dict[lid] = tensor
                if sign_key == "positive":
                    n_pos_total += len(vectors)
                else:
                    n_neg_total += len(vectors)
        n_labels_pos = len(self.proto_pos)
        n_labels_neg = len(self.proto_neg)
        print(
            f"[prototypes] {n_labels_pos} labels con protos positivos ({n_pos_total} total), "
            f"{n_labels_neg} labels con protos negativos ({n_neg_total} total)",
            flush=True,
        )
        return {
            "labelsPositive":     n_labels_pos,
            "labelsNegative":     n_labels_neg,
            "totalPositive":      n_pos_total,
            "totalNegative":      n_neg_total,
        }

    @modal.method()
    def classify_batch(self, image_bytes_list: list[bytes]) -> list[list[float]]:
        """Clasifica N imgs y devuelve N×L (L = len(self.label_ids) actual).
        Imgs que no decodifican → slot vacío [].
        """
        from PIL import Image
        torch = self.torch

        images: list = []
        valid_indices: list[int] = []
        for idx, raw_bytes in enumerate(image_bytes_list):
            try:
                im = Image.open(BytesIO(raw_bytes)).convert("RGB")
                images.append(im)
                valid_indices.append(idx)
            except Exception as e:  # noqa: BLE001
                print(f"[classify] decode failed for idx={idx}: {e}", flush=True)

        results: list[list[float]] = [[] for _ in image_bytes_list]
        if not images:
            return results

        with torch.no_grad():
            inputs     = self.processor(images=images, return_tensors="pt").to(self.device)
            img_embeds = self.model.get_image_features(**inputs)
            img_embeds = img_embeds / img_embeds.norm(dim=-1, keepdim=True)

            logits     = img_embeds @ self.text_embeds.T * self.logit_scale + self.logit_bias
            probs      = torch.sigmoid(logits)
            neg_logits = img_embeds @ self.neg_text_embeds.T * self.logit_scale + self.logit_bias
            neg_probs  = torch.sigmoid(neg_logits) * self.has_neg_mask
            probs      = (probs - NEG_WEIGHT * neg_probs).clamp(0.0, 1.0)

            # ── Fase C: ajuste kNN sobre prototipos humanos ──────────────
            # Si hay prototipos cargados (vía set_prototypes), por cada label
            # con suficientes protos del signo correspondiente computamos la
            # similitud coseno de cada img-embed con esos protos y ajustamos:
            #   - Boost si la img es similar a protos POSITIVOS (humano dijo
            #     SÍ a una img parecida) — pero solo en zona "incierta" para
            #     no crear falsos positivos cuando el modelo ya descartó.
            #   - Penalty si la img es similar a protos NEGATIVOS (humano
            #     dijo NO a una img parecida) — aplicado SIEMPRE, también si
            #     el modelo está confiado: corrige falsos positivos.
            # Costo: matmul img_embeds @ protos.T por label — ~1ms total con
            # n_imgs=32 y ~10 labels con protos. Despreciable.
            has_proto_pos = hasattr(self, "proto_pos") and bool(self.proto_pos)
            has_proto_neg = hasattr(self, "proto_neg") and bool(self.proto_neg)
            if has_proto_pos or has_proto_neg:
                for li, lid in enumerate(self.label_ids):
                    if has_proto_pos:
                        pos_protos = self.proto_pos.get(lid)
                        if pos_protos is not None:
                            sim_pos     = img_embeds @ pos_protos.T  # (n_imgs, N_pos)
                            max_sim_pos = sim_pos.max(dim=1).values   # (n_imgs,)
                            boost       = torch.clamp(max_sim_pos - KNN_SIM_THRESHOLD, min=0) * KNN_BOOST_WEIGHT
                            score_col   = probs[:, li]
                            uncertain   = (score_col > KNN_UNCERTAIN_LO) & (score_col < KNN_UNCERTAIN_HI)
                            probs[:, li] = score_col + boost * uncertain.to(probs.dtype)
                    if has_proto_neg:
                        neg_protos = self.proto_neg.get(lid)
                        if neg_protos is not None:
                            sim_neg     = img_embeds @ neg_protos.T  # (n_imgs, N_neg)
                            max_sim_neg = sim_neg.max(dim=1).values
                            penalty     = torch.clamp(max_sim_neg - KNN_SIM_THRESHOLD, min=0) * KNN_PENALTY_WEIGHT
                            probs[:, li] = probs[:, li] - penalty
                probs = probs.clamp(0.0, 1.0)

        scores = probs.cpu().tolist()
        for vidx, score_row in zip(valid_indices, scores):
            results[vidx] = score_row
        return results


# ── Orchestrator (CPU container — coordina R2 IO + GPU + Gemini/Groq) ──
@app.function(
    image=image,
    secrets=[classifier_secret],
    timeout=3600,
)
def orchestrate(
    force:             bool = False,
    limit:             int  = 0,
    no_gemini:         bool = False,
    no_groq:           bool = False,
    retry_problematic: bool = False,
) -> dict:
    """Pipeline completo de extremo a extremo. Ver docstring del módulo
    para detalles.
    """
    import boto3
    from collections import Counter
    from concurrent.futures import ThreadPoolExecutor
    from datetime import datetime, timezone

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket     = os.environ["R2_BUCKET_NAME"]
    s3 = boto3.client(
        "s3",
        endpoint_url          = f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id     = os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key = os.environ["R2_SECRET_ACCESS_KEY"],
        region_name           = "auto",
    )

    def _get_meta_json(key: str) -> Optional[dict]:
        try:
            r = s3.get_object(Bucket=bucket, Key=key)
            return json.loads(r["Body"].read())
        except s3.exceptions.NoSuchKey:
            return None
        except Exception as e:  # noqa: BLE001
            print(f"[orch] warning: failed to read {key}: {e}", flush=True)
            return None

    def _sha_of(key: str) -> str:
        basename = key.rsplit("/", 1)[-1]
        return basename.rsplit(".", 1)[0]

    # ── 1. List R2 image keys (excluir prefix meta/) ────────────────────
    print("[orch] listing R2 keys...", flush=True)
    image_keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.startswith("meta/"):
                continue
            ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
            if ext not in ("png", "jpg", "jpeg", "webp"):
                continue
            image_keys.append(key)
    image_keys.sort()
    if limit > 0:
        image_keys = image_keys[:limit]
    print(f"[orch] {len(image_keys)} images to classify", flush=True)

    if not image_keys:
        print("[orch] nothing to classify", flush=True)
        return {}

    # ── 2. Load admin overrides + prev + discovered ─────────────────────
    excl_raw       = _get_meta_json("meta/tag_exclusions.json")
    conf_raw       = _get_meta_json("meta/tag_confirmations.json")
    manual_raw     = _get_meta_json("meta/manual_tags.json")
    prev           = _get_meta_json("meta/classification.json")
    discovered_raw = _get_meta_json("meta/discovered_labels.json")
    refined_raw    = _get_meta_json("meta/refined_labels.json")
    protos_raw     = _get_meta_json("meta/prototypes.json")

    tag_exclusions:    dict[str, set[str]] = {}
    tag_confirmations: dict[str, set[str]] = {}
    if excl_raw and isinstance(excl_raw.get("exclusions"), dict):
        for sha, tags in excl_raw["exclusions"].items():
            if isinstance(sha, str) and isinstance(tags, list):
                tag_exclusions[sha] = {t for t in tags if isinstance(t, str)}
    if conf_raw and isinstance(conf_raw.get("confirmations"), dict):
        for sha, tags in conf_raw["confirmations"].items():
            if isinstance(sha, str) and isinstance(tags, list):
                tag_confirmations[sha] = {t for t in tags if isinstance(t, str)}

    # Manual tags asignados por admin desde /admin/images-bank — misma
    # semántica que confirmations + inyección forzada + flag humanAssigned
    # + cleanup tras este run (migran a tag_confirmations).
    from classifier_core import parse_manual_tags, manual_tags_to_id_sets  # noqa: E402
    parsed_manual_tags = parse_manual_tags(manual_raw)
    manual_tags_by_sha = manual_tags_to_id_sets(parsed_manual_tags)

    if tag_exclusions:
        total_excl = sum(len(v) for v in tag_exclusions.values())
        print(f"🚫 Exclusiones manuales: {len(tag_exclusions)} shas, {total_excl} tags excluidos", flush=True)
    if tag_confirmations:
        total_conf = sum(len(v) for v in tag_confirmations.values())
        print(f"✅ Confirmaciones manuales: {len(tag_confirmations)} shas, {total_conf} tags confirmados (boost a {CONFIRMED_BOOST})", flush=True)
    if manual_tags_by_sha:
        total_man = sum(len(v) for v in manual_tags_by_sha.values())
        print(f"👤 Manual tags: {len(manual_tags_by_sha)} shas, {total_man} tags asignados (boost a {CONFIRMED_BOOST} + inyectados al output, migrarán a confirmations tras este run)", flush=True)

    discovered: list[dict] = []
    if discovered_raw and isinstance(discovered_raw.get("labels"), list):
        discovered = [
            l for l in discovered_raw["labels"]
            if isinstance(l, dict) and "id" in l and isinstance(l.get("prompts"), list)
        ]
    if discovered:
        print(f"♻  {len(discovered)} labels descubiertos previamente cargados de meta/discovered_labels.json", flush=True)

    # Refinamientos de prompts (Fase B) producidos por refine_labels.py.
    # Validamos suavemente — el classifier hace fallback al original si falta.
    refined_labels: dict[str, dict] = {}
    if refined_raw and isinstance(refined_raw.get("refinements"), dict):
        for lid, ref in refined_raw["refinements"].items():
            if not isinstance(ref, dict):
                continue
            rp = ref.get("refinedPositives")
            rn = ref.get("refinedNegatives")
            if (isinstance(rp, list) and rp) or (isinstance(rn, list) and rn):
                refined_labels[lid] = ref
    if refined_labels:
        n_pos = sum(1 for r in refined_labels.values() if r.get("refinedPositives"))
        n_neg = sum(1 for r in refined_labels.values() if r.get("refinedNegatives"))
        print(
            f"🪄 {len(refined_labels)} labels con refinements aplicarán "
            f"({n_pos} positivos, {n_neg} negativos)",
            flush=True,
        )

    # Prototipos kNN (Fase C). Embeddings SigLIP de imágenes confirmadas /
    # excluidas por humanos. Los carga el classifier vía set_prototypes
    # después del setup y antes de classify_batch.
    prototypes_data: dict = {}
    if protos_raw and isinstance(protos_raw.get("prototypes"), dict):
        prototypes_data = protos_raw["prototypes"]
    if prototypes_data:
        n_lab = len(prototypes_data)
        n_pos = sum(len(d.get("positive", [])) for d in prototypes_data.values() if isinstance(d, dict))
        n_neg = sum(len(d.get("negative", [])) for d in prototypes_data.values() if isinstance(d, dict))
        print(
            f"🧬 prototipos kNN cargados: {n_lab} labels ({n_pos} positivos + {n_neg} negativos)",
            flush=True,
        )

    prev_images: dict[str, dict] = (
        prev["images"] if (prev and isinstance(prev.get("images"), dict)) else {}
    )
    if prev_images:
        print(f"[orch] prev classification.json: {len(prev_images)} imgs ya clasificadas", flush=True)
    if force:
        print("[orch] --force: re-clasificando todas las imgs listadas (el resto del prev se mantiene intacto)", flush=True)

    # `to_skip`: SHAs del prev que NO vamos a tocar.
    #   - default (sin flags): skip todas las que ya están en prev → solo
    #     procesa imgs nuevas (modo incremental).
    #   - --force: no skip ninguna → reprocesa TODAS las listadas.
    #   - --retry-problematic (sin --force): skip solo las que tienen al
    #     menos un tag confident en prev. Las problemáticas (sin tag
    #     confident, max_score < THRESHOLD) se reprocesan. Útil cuando se
    #     agotó Gemini/Groq en un run anterior y quieres reintentar SOLO
    #     las que se quedaron sin discovery, sin tocar las que sí.
    if force:
        to_skip: set[str] = set()
    elif retry_problematic:
        to_skip = {
            sha for sha, info in prev_images.items()
            if any(t.get("confident") for t in info.get("tags", []))
        }
        n_problematic_in_prev = len(prev_images) - len(to_skip)
        print(
            f"[orch] --retry-problematic: {len(to_skip)} imgs con tag confident se preservan, "
            f"{n_problematic_in_prev} problemáticas se reprocesan",
            flush=True,
        )
    else:
        to_skip = set(prev_images.keys())

    pending = [k for k in image_keys if _sha_of(k) not in to_skip]
    print(f"[orch] {len(pending)} pending after resume filter", flush=True)

    if not pending:
        print("[orch] all images already classified — nothing to do", flush=True)
        if prev:
            return {"__skipped__": True, "existing": prev}
        return {}

    # ── 3. Classifier setup ─────────────────────────────────────────────
    # ORDEN IMPORTANTE:
    #   1. setup() carga LABELS originales (tras @modal.enter automático)
    #   2. apply_refinements() REEMPLAZA prompts de labels base con los refinados
    #   3. add_labels() AÑADE los discovered al final del vocabulario
    # Si invirtes 2 y 3, los discovered no se ven afectados pero las posiciones
    # de los índices podrían descalibrarse — apply_refinements asume que los
    # label_ids están en su orden original de LABELS.
    classifier = SiglipClassifier()
    if refined_labels:
        applied = classifier.apply_refinements.remote(refined_labels)
        print(
            f"🪄 Refinements aplicados: {applied.get('positives', 0)} positivos, "
            f"{applied.get('negatives', 0)} negativos reemplazados",
            flush=True,
        )
    if discovered:
        added = classifier.add_labels.remote(discovered)
        print(f"📥 {added} discovered labels añadidos al classifier", flush=True)
    if prototypes_data:
        proto_stats = classifier.set_prototypes.remote(prototypes_data)
        print(
            f"🧬 prototipos aplicados al classifier: "
            f"{proto_stats.get('labelsPositive', 0)} labels con +protos ({proto_stats.get('totalPositive', 0)} embeds), "
            f"{proto_stats.get('labelsNegative', 0)} labels con −protos ({proto_stats.get('totalNegative', 0)} embeds)",
            flush=True,
        )
    label_ids: list[str] = classifier.get_label_ids.remote()
    print(f"🏷  Vocabulario activo: {len(label_ids)} labels (LABELS + discovered de R2)", flush=True)

    # ── 4. Init Gemini/Groq clients ─────────────────────────────────────
    gemini_state  = GeminiState()
    groq_state    = GroqState()
    gemini_client = None
    groq_client   = None

    if no_gemini:
        print("ℹ  Gemini desactivado por --no-gemini", flush=True)
        gemini_state.available = False
    else:
        gem_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not gem_key:
            print("ℹ  GEMINI_API_KEY no encontrado — sin auto-discovery con Gemini", flush=True)
            gemini_state.available = False
        elif google_genai is None:
            print("⚠  google-genai no instalado en el image — sin Gemini", flush=True)
            gemini_state.available = False
        else:
            prefix = gem_key[:4]
            print(f"🤖 Gemini ({GEMINI_MODEL_ID})", flush=True)
            print(f"   API key: prefix='{prefix}' len={len(gem_key)}", flush=True)
            if prefix != "AIza" or len(gem_key) < 30:
                print(f"   ⚠  Formato sospechoso — las keys de Gemini suelen empezar con 'AIza' (~39 chars). Desactivando.", flush=True)
                gemini_state.available = False
                gemini_state.disabled_reason = "invalid_key_format"
            else:
                try:
                    gemini_client = google_genai.Client(api_key=gem_key)
                except Exception as e:  # noqa: BLE001
                    print(f"⚠  Gemini init falló: {e}", flush=True)
                    gemini_client = None
                    gemini_state.available = False

    if no_groq:
        print("ℹ  Groq desactivado por --no-groq", flush=True)
        groq_state.available = False
    else:
        groq_key = os.environ.get("GROQ_API_KEY", "").strip()
        if not groq_key:
            print("ℹ  GROQ_API_KEY no encontrado — sin fallback Groq", flush=True)
            groq_state.available = False
        elif GroqClient is None:
            print("⚠  groq SDK no instalado en el image — sin Groq", flush=True)
            groq_state.available = False
        else:
            prefix = groq_key[:4]
            print(f"🤖 Groq ({GROQ_MODEL_ID})", flush=True)
            print(f"   API key: prefix='{prefix}' len={len(groq_key)}", flush=True)
            try:
                groq_client = GroqClient(api_key=groq_key)
            except Exception as e:  # noqa: BLE001
                print(f"⚠  Groq init falló: {e}", flush=True)
                groq_client = None
                groq_state.available = False

    # ── 5. Loop principal: download → GPU classify → discovery → re-classify ──
    def _download(key: str) -> tuple[str, bytes]:
        r = s3.get_object(Bucket=bucket, Key=key)
        return key, r["Body"].read()

    pool = ThreadPoolExecutor(max_workers=16)
    results: dict[str, dict] = dict(prev_images)
    new_count = 0
    iso_now   = datetime.now(timezone.utc).isoformat()
    new_discoveries_total: list[dict] = []

    for batch_start in range(0, len(pending), BATCH_SIZE):
        batch_keys = pending[batch_start : batch_start + BATCH_SIZE]

        # Descarga paralela del batch
        downloaded = list(pool.map(_download, batch_keys))
        keys       = [k for k, _ in downloaded]
        bytes_lst  = [b for _, b in downloaded]

        # Primera clasificación
        scores_batch: list[list[float]] = classifier.classify_batch.remote(bytes_lst)

        # Identificar problemáticas (max_score < THRESHOLD)
        problematic_indices: list[int] = []
        for i, scores in enumerate(scores_batch):
            if not scores:
                continue
            if max(scores) < THRESHOLD:
                problematic_indices.append(i)

        # Auto-discovery sobre problemáticas (sequential — CPU calls a APIs)
        new_labels_this_batch: list[dict] = []
        existing_ids_set = set(label_ids)
        any_provider_available = (
            (gemini_state.available and gemini_client is not None)
            or (groq_state.available and groq_client is not None)
        )

        if problematic_indices and any_provider_available:
            print(
                f"   🔍 {len(problematic_indices)}/{len(keys)} imgs problemáticas — invocando Gemini/Groq...",
                flush=True,
            )
            for pidx in problematic_indices:
                img_bytes = bytes_lst[pidx]
                img_name  = keys[pidx].rsplit("/", 1)[-1]
                mime      = _mime_of_filename(img_name)
                sha       = _sha_of(keys[pidx])

                # Top-N labels más relevantes a ESTA imagen específica (por
                # score SigLIP). Se pasan a Gemini/Groq como contexto en
                # vez de los ~118 existing_ids completos — reduce ruido y
                # ayuda al modelo a proponer cosas COMPLEMENTARIAS.
                img_scores = scores_batch[pidx]
                if img_scores:
                    score_pairs = list(zip(label_ids, img_scores))
                    score_pairs.sort(key=lambda x: -x[1])
                    top_relevant = [
                        (lid, float(sc)) for lid, sc in score_pairs[:TOP_RELEVANT_FOR_DISCOVERY]
                    ]
                else:
                    top_relevant = []

                suggestions: Optional[list[dict]] = None
                discovery_source = ""

                # Intento 1: Gemini
                if gemini_state.available and gemini_client is not None:
                    gemini_state.images_with_gemini += 1
                    suggestions = call_gemini_bytes(
                        gemini_client, img_bytes, mime, img_name,
                        existing_ids_set, top_relevant, gemini_state,
                    )
                    if suggestions:
                        discovery_source = "gemini"

                # Intento 2: Groq fallback
                if not suggestions and groq_state.available and groq_client is not None:
                    groq_state.images_with_groq += 1
                    suggestions = call_groq_bytes(
                        groq_client, img_bytes, mime, img_name,
                        existing_ids_set, top_relevant, groq_state,
                    )
                    if suggestions:
                        discovery_source = "groq"

                if suggestions:
                    for sugg in suggestions:
                        if sugg["id"] in existing_ids_set:
                            continue
                        new_labels_this_batch.append({
                            "id":             sugg["id"],
                            "displayEs":      sugg["displayEs"],
                            "category":       sugg["category"],
                            "prompts":        sugg["prompts"],
                            "discoveredFrom": sha,
                            "discoveredAt":   datetime.now(timezone.utc).isoformat(),
                            "discoveredBy":   discovery_source,
                        })
                        existing_ids_set.add(sugg["id"])
                        if discovery_source == "gemini":
                            gemini_state.suggestions_added += 1
                        elif discovery_source == "groq":
                            groq_state.suggestions_added += 1

        # Si hubo descubrimientos: extender vocab classifier + re-clasificar TODO el batch
        # con el vocabulario expandido. Esto garantiza que TODAS las imgs del batch
        # (no solo las problemáticas) se benefician de los labels nuevos.
        if new_labels_this_batch:
            added = classifier.add_labels.remote(new_labels_this_batch)
            new_discoveries_total.extend(new_labels_this_batch)
            print(
                f"   ✨ {added} labels nuevos descubiertos en este batch → re-clasificando con vocab expandido",
                flush=True,
            )
            scores_batch = classifier.classify_batch.remote(bytes_lst)
            label_ids = classifier.get_label_ids.remote()  # actualizado

        # Post-process por imagen
        for key, scores in zip(keys, scores_batch):
            sha      = _sha_of(key)
            filename = key.rsplit("/", 1)[-1]

            if not scores:
                results[sha] = {
                    "filename":  filename,
                    "tags":      [],
                    "allScores": {},
                    "taggedAt":  iso_now,
                    "error":     "decode_failed",
                }
                continue

            all_scores = {lid: round(float(s), 4) for lid, s in zip(label_ids, scores)}

            # Boost de confirmaciones
            for ct in tag_confirmations.get(sha, set()):
                if ct in all_scores and all_scores[ct] < CONFIRMED_BOOST:
                    all_scores[ct] = CONFIRMED_BOOST

            # Manual tags (admin asigna directamente desde /admin/images-bank).
            # Misma semántica que confirmations + ADEMÁS:
            #   - Inyecta el label en all_scores aunque no estuviera
            #   - Se preserva SIEMPRE en el output (sin filtros por threshold)
            #   - Marca flag `humanAssigned` en el output
            #   - Gana sobre exclusiones (admin las re-asignó a propósito)
            sha_manual = manual_tags_by_sha.get(sha, set())
            if sha_manual:
                for mt in sha_manual:
                    all_scores[mt] = max(all_scores.get(mt, 0.0), CONFIRMED_BOOST)

            # Exclusiones admin (filtra antes del top-K, salvo verdad humana)
            excluded     = tag_exclusions.get(sha, set())
            confirmed    = tag_confirmations.get(sha, set())
            # "Verdad humana" — manual + confirmed se inyectan SIEMPRE.
            human_forced = sha_manual | confirmed
            filtered     = [
                (lid, sc) for lid, sc in all_scores.items()
                if lid not in excluded or lid in human_forced
            ]
            candidates   = sorted(filtered, key=lambda x: -x[1])[:TOP_K]

            tags: list[dict] = []
            seen_in_tags: set[str] = set()
            for rank, (lid, score) in enumerate(candidates):
                if score < MIN_SCORE and lid not in human_forced:
                    break
                if rank >= ALWAYS_KEEP_TOP and score < THRESHOLD and lid not in human_forced:
                    continue
                tag_entry: dict = {
                    "tag":       lid,
                    "score":     score,
                    "confident": score >= THRESHOLD or lid in human_forced,
                }
                # humanAssigned (manual) > humanConfirmed (confirmación).
                # Ambas flags pueden coexistir si el admin además confirmó.
                if lid in sha_manual:
                    tag_entry["humanAssigned"] = True
                # Persiste el flag de "revisado por admin" en el JSON. Misma
                # semántica que classify_siglip.py: independientemente del
                # score real (incluso si ya estaba alto), si el admin marcó
                # SÍ para esta (sha, lid), el JSON lo recuerda. La UI usa
                # esto para pintar el badge verde en /admin/images-bank.
                if lid in confirmed:
                    tag_entry["humanConfirmed"] = True
                tags.append(tag_entry)
                seen_in_tags.add(lid)

            # Garantizar invariante: TODOS los manuales + confirmations
            # están en el output, aunque no entraran al top-K. Caso real
            # (visto en diff-classification): imágenes con 5+ tags por
            # encima de CONFIRMED_BOOST hacen que un confirmed con score
            # moderado caiga del top-K.
            for forced_tag in human_forced:
                if forced_tag in seen_in_tags:
                    continue
                forced_score = all_scores.get(forced_tag, CONFIRMED_BOOST)
                entry: dict = {
                    "tag":       forced_tag,
                    "score":     round(float(forced_score), 4),
                    "confident": True,
                }
                if forced_tag in sha_manual:
                    entry["humanAssigned"] = True
                if forced_tag in confirmed:
                    entry["humanConfirmed"] = True
                tags.append(entry)

            results[sha] = {
                "filename":  filename,
                "tags":      tags,
                "allScores": all_scores,
                "taggedAt":  iso_now,
            }
            new_count += 1

        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (len(pending) + BATCH_SIZE - 1) // BATCH_SIZE
        print(
            f"[orch] batch {batch_num}/{total_batches} done — "
            f"{min(batch_start + BATCH_SIZE, len(pending))}/{len(pending)} imgs procesadas "
            f"({new_count} new total, {len(new_discoveries_total)} discovered)",
            flush=True,
        )

        # ── Checkpoint cada N batches: sube progreso parcial a R2 ──────
        # Esto protege contra crashes (Modal timeout, network glitch, OOM,
        # quota Gemini agotada con backoff que rompe el container, Ctrl+C).
        # Subimos:
        #   - classification.json parcial: con TODAS las imgs procesadas
        #     hasta ahora + las del prev no tocadas (results es un superset
        #     que arranca de dict(prev_images))
        #   - discovered_labels.json: si hay descubrimientos nuevos
        # Stats agregados (tagCounts, etc.) los recalculamos al final
        # cuando se sube el JSON definitivo. Aquí solo dejamos un sentinel
        # `checkpoint: true` para distinguir un parcial de un final.
        if batch_num % CHECKPOINT_EVERY_N_BATCHES == 0 and batch_num < total_batches:
            try:
                no_tags_so_far    = sum(1 for r in results.values() if not r.get("tags"))
                no_conf_so_far    = sum(
                    1 for r in results.values()
                    if not any(t.get("confident") for t in r.get("tags", []))
                )
                all_discovered_so_far = discovered + new_discoveries_total
                ckpt_labels = [{"id": lid, "prompts": list(prompts)} for lid, prompts in LABELS]
                for d in all_discovered_so_far:
                    ckpt_labels.append({"id": d["id"], "prompts": d["prompts"]})

                partial = {
                    "generatedAt":     datetime.now(timezone.utc).isoformat(),
                    "model":           MODEL_ID,
                    "backend":         "modal-siglip-gpu",
                    "threshold":       THRESHOLD,
                    "topK":            TOP_K,
                    "minScore":        MIN_SCORE,
                    "imagesProcessed": len(results),
                    "labels":          ckpt_labels,
                    "images":          results,
                    "stats": {
                        "totalImages":            len(results),
                        "imagesWithoutTags":      no_tags_so_far,
                        "imagesWithoutConfident": no_conf_so_far,
                        # Tag counts agregados se computan solo al final
                        # (son caros de recalcular en cada checkpoint).
                        "tagCounts":              {},
                        "confidentTagCounts":     {},
                    },
                    "checkpoint":      True,
                    "checkpointBatch": f"{batch_num}/{total_batches}",
                }
                body = json.dumps(partial, indent=2, ensure_ascii=False).encode("utf-8")
                s3.put_object(
                    Bucket=bucket, Key="meta/classification.json",
                    Body=body,
                    ContentType="application/json; charset=utf-8",
                    CacheControl="no-cache",
                )
                # Discovered labels — solo si hay nuevos en este run
                if new_discoveries_total:
                    disc_payload = {
                        "generatedAt": iso_now,
                        "count":       len(all_discovered_so_far),
                        "labels":      all_discovered_so_far,
                    }
                    s3.put_object(
                        Bucket=bucket, Key="meta/discovered_labels.json",
                        Body=json.dumps(disc_payload, indent=2, ensure_ascii=False).encode("utf-8"),
                        ContentType="application/json; charset=utf-8",
                        CacheControl="no-cache",
                    )
                print(
                    f"   💾 checkpoint subido a R2 — {len(results)} imgs en JSON, "
                    f"{len(all_discovered_so_far)} discovered ({len(new_discoveries_total)} nuevos este run)",
                    flush=True,
                )
            except Exception as e:  # noqa: BLE001
                # No abortar el run por un fallo de checkpoint — seguimos
                # clasificando. Si todos los checkpoints fallan, al menos
                # el upload final intentará subir todo.
                print(f"   ⚠  checkpoint upload falló: {e} — sigo con el run", flush=True)

    pool.shutdown(wait=False)

    # ── 6. Stats finales de discovery ───────────────────────────────────
    if gemini_state.calls_made > 0:
        print(
            f"🤖 Gemini: {gemini_state.calls_made} calls, "
            f"{gemini_state.suggestions_added} sugerencias añadidas, "
            f"{gemini_state.images_with_gemini} imgs procesadas "
            f"({'disabled: ' + gemini_state.disabled_reason if not gemini_state.available else 'OK'})",
            flush=True,
        )
    if groq_state.calls_made > 0:
        print(
            f"🤖 Groq: {groq_state.calls_made} calls, "
            f"{groq_state.suggestions_added} sugerencias añadidas, "
            f"{groq_state.images_with_groq} imgs procesadas "
            f"({'disabled: ' + groq_state.disabled_reason if not groq_state.available else 'OK'})",
            flush=True,
        )

    # ── 7. Stats de tags ────────────────────────────────────────────────
    print(f"[orch] aggregating stats over {len(results)} images...", flush=True)
    tag_counts:           Counter = Counter()
    confident_tag_counts: Counter = Counter()
    no_tags               = 0
    no_confident          = 0
    for r in results.values():
        if not r.get("tags"):
            no_tags += 1
        any_conf = False
        for t in r.get("tags", []):
            tag_counts[t["tag"]] += 1
            if t.get("confident"):
                confident_tag_counts[t["tag"]] += 1
                any_conf = True
        if not any_conf:
            no_confident += 1

    # ── 8. Build payload (con discovery + sus stats) ────────────────────
    all_discovered = discovered + new_discoveries_total
    # Labels = LABELS + discovered. Mismo formato que classify_siglip.py.
    labels_payload = [{"id": lid, "prompts": list(prompts)} for lid, prompts in LABELS]
    for d in all_discovered:
        labels_payload.append({
            "id":      d["id"],
            "prompts": d["prompts"],
        })

    payload = {
        "generatedAt":     datetime.now(timezone.utc).isoformat(),
        "model":           MODEL_ID,
        "backend":         "modal-siglip-gpu",
        "threshold":       THRESHOLD,
        "topK":            TOP_K,
        "minScore":        MIN_SCORE,
        "imagesProcessed": len(results),
        "labels":          labels_payload,
        "images":          results,
        "stats": {
            "totalImages":            len(results),
            "imagesWithoutTags":      no_tags,
            "imagesWithoutConfident": no_confident,
            "tagCounts":              dict(tag_counts),
            "confidentTagCounts":     dict(confident_tag_counts),
        },
        "discoveryStats": {
            "gemini": {
                "callsMade":          gemini_state.calls_made,
                "suggestionsAdded":   gemini_state.suggestions_added,
                "imagesQueried":      gemini_state.images_with_gemini,
                "available":          gemini_state.available,
                "disabledReason":     gemini_state.disabled_reason,
            },
            "groq": {
                "callsMade":          groq_state.calls_made,
                "suggestionsAdded":   groq_state.suggestions_added,
                "imagesQueried":      groq_state.images_with_groq,
                "available":          groq_state.available,
                "disabledReason":     groq_state.disabled_reason,
            },
            "totalDiscoveredLabels":   len(all_discovered),
            "newDiscoveredThisRun":    len(new_discoveries_total),
            "rejectedSuggestionCount": len(REJECTED_SUGGESTIONS),
        },
    }

    # ── 9. Upload classification.json a R2 ──────────────────────────────
    body = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    print(f"[orch] uploading classification.json ({len(body) / 1024:.1f} KB) to R2...", flush=True)
    s3.put_object(
        Bucket       = bucket,
        Key          = "meta/classification.json",
        Body         = body,
        ContentType  = "application/json; charset=utf-8",
        CacheControl = "no-cache",
    )

    # ── 10. Persist discovered_labels.json (existing + nuevos) ──────────
    if all_discovered:
        disc_payload = {
            "generatedAt": iso_now,
            "count":       len(all_discovered),
            "labels":      all_discovered,
        }
        disc_body = json.dumps(disc_payload, indent=2, ensure_ascii=False).encode("utf-8")
        s3.put_object(
            Bucket       = bucket,
            Key          = "meta/discovered_labels.json",
            Body         = disc_body,
            ContentType  = "application/json; charset=utf-8",
            CacheControl = "no-cache",
        )
        print(
            f"💾 discovered_labels.json subido a R2 "
            f"({len(all_discovered)} totales, {len(new_discoveries_total)} nuevos este run)",
            flush=True,
        )

    # ── 11. Persist rejected_suggestions.json (audit) ───────────────────
    if REJECTED_SUGGESTIONS:
        rej_payload = {
            "generatedAt": iso_now,
            "count":       len(REJECTED_SUGGESTIONS),
            "note":        "Sugerencias de Gemini/Groq descartadas por el validator. "
                           "Revisa los `reason` para entender qué fallaba.",
            "rejected":    REJECTED_SUGGESTIONS,
        }
        rej_body = json.dumps(rej_payload, indent=2, ensure_ascii=False).encode("utf-8")
        s3.put_object(
            Bucket       = bucket,
            Key          = "meta/rejected_suggestions.json",
            Body         = rej_body,
            ContentType  = "application/json; charset=utf-8",
            CacheControl = "no-cache",
        )
        # Resumen por motivo
        reasons = Counter()
        for r in REJECTED_SUGGESTIONS:
            reason_key = r["reason"].split("(")[0].split(";")[0].strip()
            reasons[reason_key] += 1
        print(f"📝 rejected_suggestions.json subido a R2 ({len(REJECTED_SUGGESTIONS)} rechazadas)", flush=True)
        print(f"   Motivos más comunes:", flush=True)
        for reason, cnt in reasons.most_common(5):
            print(f"     {cnt:>4}× {reason}", flush=True)

    # ── 12. Cleanup: promover manual_tags → tag_confirmations en R2 ─────
    # write_object de classification.json fue exitoso → consideramos el
    # run completo. Migramos las entradas de meta/manual_tags.json al
    # meta/tag_confirmations.json (preservando confirmaciones previas),
    # vaciamos manual_tags.json y appendeamos un audit entry. Todo en R2.
    if parsed_manual_tags:
        from classifier_core import (  # noqa: E402
            merge_manual_into_confirmations,
            build_empty_manual_tags_payload,
            build_manual_tags_audit_entry,
        )
        try:
            existing_conf = _get_meta_json("meta/tag_confirmations.json") or {}
            merged_conf   = merge_manual_into_confirmations(parsed_manual_tags, existing_conf)
            s3.put_object(
                Bucket       = bucket,
                Key          = "meta/tag_confirmations.json",
                Body         = json.dumps(merged_conf, indent=2, ensure_ascii=False).encode("utf-8"),
                ContentType  = "application/json; charset=utf-8",
                CacheControl = "no-cache",
            )
            s3.put_object(
                Bucket       = bucket,
                Key          = "meta/manual_tags.json",
                Body         = json.dumps(build_empty_manual_tags_payload(), indent=2, ensure_ascii=False).encode("utf-8"),
                ContentType  = "application/json; charset=utf-8",
                CacheControl = "no-cache",
            )
            # Append audit
            history_raw = _get_meta_json("meta/manual_tags_history.json") or {}
            history_list = history_raw.get("entries", []) if isinstance(history_raw, dict) else []
            if not isinstance(history_list, list):
                history_list = []
            history_list.append(build_manual_tags_audit_entry(
                parsed_manual_tags,
                run_started_at=iso_now,    # mejor aprox temporal disponible en este scope
                run_succeeded=True,
            ))
            s3.put_object(
                Bucket       = bucket,
                Key          = "meta/manual_tags_history.json",
                Body         = json.dumps({"entries": history_list}, indent=2, ensure_ascii=False).encode("utf-8"),
                ContentType  = "application/json; charset=utf-8",
                CacheControl = "no-cache",
            )
            total_man = sum(len(v) for v in parsed_manual_tags.values())
            print(f"🧹 Cleanup: {len(parsed_manual_tags)} shas / {total_man} manual_tags migrados a tag_confirmations.json en R2", flush=True)
        except Exception as err:  # noqa: BLE001
            print(f"⚠️  Cleanup manual_tags FAILED (classification.json OK): {err}", flush=True)

    print(
        f"[orch] done — {new_count} newly classified, "
        f"{len(results)} total in classification.json, "
        f"{len(new_discoveries_total)} new labels discovered",
        flush=True,
    )
    return payload


# ── Fase C: cómputo de prototipos kNN ──────────────────────────────────
@app.function(
    image=image,
    secrets=[classifier_secret],
    timeout=3600,
)
def compute_prototypes_fn(force: bool = False, only_label: Optional[str] = None) -> dict:
    """Computa embeddings SigLIP de las imágenes confirmadas/excluidas por
    el admin y los persiste en `meta/prototypes.json` (R2). El classifier
    los consume al cargar via set_prototypes() y aplica boost/penalty kNN
    en classify_batch.

    Args:
      force: si True, re-computa TODOS los prototipos desde cero (ignora
        existing). Útil si cambiaste el MODEL_ID o tras model upgrade.
        Si False, solo añade los nuevos (incremental).
      only_label: si != None, computa SOLO prototipos para ese label.

    Returns: el payload final subido a R2 (también devuelto al local
    entrypoint para guardar copia local).
    """
    import boto3
    from concurrent.futures import ThreadPoolExecutor
    from datetime import datetime, timezone

    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket     = os.environ["R2_BUCKET_NAME"]
    s3 = boto3.client(
        "s3",
        endpoint_url          = f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id     = os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key = os.environ["R2_SECRET_ACCESS_KEY"],
        region_name           = "auto",
    )

    def _get(key: str) -> Optional[dict]:
        try:
            r = s3.get_object(Bucket=bucket, Key=key)
            return json.loads(r["Body"].read())
        except s3.exceptions.NoSuchKey:
            return None

    # ── 1. Load feedback + existing prototypes ──────────────────────────
    confs    = _get("meta/tag_confirmations.json")
    excls    = _get("meta/tag_exclusions.json")
    manual   = _get("meta/manual_tags.json")
    existing = _get("meta/prototypes.json")

    conf_map: dict[str, list[str]] = dict((confs or {}).get("confirmations", {}))
    excl_map: dict[str, list[str]] = (excls or {}).get("exclusions", {})

    # Inyectar manual_tags como confirmaciones positivas IN-MEMORY para
    # esta build de prototipos. NO escribimos a R2 desde aquí (eso lo
    # hace el classifier en su cleanup post-run). Aquí solo queremos
    # que las imgs manual-tagueadas se conviertan en prototipos kNN
    # positivos del label correspondiente.
    if isinstance(manual, dict):
        from classifier_core import parse_manual_tags  # noqa: E402
        parsed_man = parse_manual_tags(manual)
        for sha, items in parsed_man.items():
            tags = [it["tag"] for it in items if it.get("tag")]
            if not tags:
                continue
            existing_tags = set(conf_map.get(sha, []))
            conf_map[sha] = sorted(existing_tags | set(tags))
        if parsed_man:
            total = sum(len(t) for t in parsed_man.values())
            print(f"[protos] 👤 manual_tags inyectados como positivos: {len(parsed_man)} shas / {total} tags", flush=True)

    existing_protos: dict[str, dict] = {}
    if not force and existing and isinstance(existing.get("prototypes"), dict):
        existing_protos = existing["prototypes"]
        print(f"[protos] {sum(len(d.get('positive', [])) for d in existing_protos.values())} positivos + "
              f"{sum(len(d.get('negative', [])) for d in existing_protos.values())} negativos ya en R2", flush=True)

    # ── 2. Build target list of (sha, lid, sign) ────────────────────────
    # Target = (sha, lid, sign) que el feedback humano tiene pero el
    # prototypes.json todavía NO tiene cacheado.
    targets: list[tuple[str, str, str]] = []
    existing_keys: set[tuple[str, str, str]] = set()
    if not force:
        for lid, data in existing_protos.items():
            for sign in ("positive", "negative"):
                for it in data.get(sign, []):
                    if isinstance(it, dict) and "sha" in it:
                        existing_keys.add((it["sha"], lid, sign))

    for sha, tags in conf_map.items():
        if not isinstance(tags, list): continue
        for lid in tags:
            if only_label and lid != only_label:
                continue
            if (sha, lid, "positive") in existing_keys:
                continue
            targets.append((sha, lid, "positive"))
    for sha, tags in excl_map.items():
        if not isinstance(tags, list): continue
        for lid in tags:
            if only_label and lid != only_label:
                continue
            if (sha, lid, "negative") in existing_keys:
                continue
            targets.append((sha, lid, "negative"))

    print(f"[protos] {len(targets)} nuevos prototipos a computar"
          f"{' (filter: ' + only_label + ')' if only_label else ''}", flush=True)
    if not targets:
        print("[protos] nothing to compute — todos los prototipos ya en R2", flush=True)
        return existing or {}

    # Agrupar por sha (una imagen puede ser proto para múltiples labels)
    sha_to_tasks: dict[str, list[tuple[str, str]]] = {}
    for sha, lid, sign in targets:
        sha_to_tasks.setdefault(sha, []).append((lid, sign))

    # ── 3. List R2 keys for needed SHAs ─────────────────────────────────
    print(f"[protos] listando keys de R2 para {len(sha_to_tasks)} SHAs únicas...", flush=True)
    needed_shas = set(sha_to_tasks.keys())
    sha_to_key: dict[str, str] = {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.startswith("meta/"):
                continue
            sha = key.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            if sha in needed_shas:
                sha_to_key[sha] = key
    missing = needed_shas - set(sha_to_key.keys())
    if missing:
        print(f"[protos] {len(missing)} SHAs en feedback no existen en R2 — skip", flush=True)

    # ── 4. Download + compute embeddings in batches ─────────────────────
    classifier = SiglipClassifier()
    # warm up the container (calling any method triggers @modal.enter)
    _ = classifier.get_label_ids.remote()

    pool = ThreadPoolExecutor(max_workers=16)

    def _download(sha_key_pair: tuple[str, str]) -> tuple[str, bytes]:
        sha, key = sha_key_pair
        r = s3.get_object(Bucket=bucket, Key=key)
        return sha, r["Body"].read()

    # Start con existing (si no es force) y vamos añadiendo
    if force:
        prototypes_out: dict[str, dict] = {}
    else:
        prototypes_out = {
            lid: {"positive": list(d.get("positive", [])), "negative": list(d.get("negative", []))}
            for lid, d in existing_protos.items()
        }

    sha_key_pairs = [(sha, sha_to_key[sha]) for sha in sha_to_tasks if sha in sha_to_key]
    BATCH = 32

    for batch_start in range(0, len(sha_key_pairs), BATCH):
        batch = sha_key_pairs[batch_start : batch_start + BATCH]
        downloaded = list(pool.map(_download, batch))
        shas       = [s for s, _ in downloaded]
        byts       = [b for _, b in downloaded]
        embeds     = classifier.compute_image_embeddings.remote(byts)

        for sha, emb in zip(shas, embeds):
            if not emb:
                continue
            # Para cada (lid, sign) que esta sha tiene asociado
            for lid, sign in sha_to_tasks.get(sha, []):
                bucket_dict = prototypes_out.setdefault(lid, {"positive": [], "negative": []})
                # Idempotente: skip si ya existe (puede haber pasado entre
                # el filtro inicial y aquí si la lista existing se duplicó)
                if any(it.get("sha") == sha for it in bucket_dict.get(sign, [])):
                    continue
                # Redondeo a 5 decimales para reducir tamaño JSON sin
                # perder precisión perceptible (similitud coseno entre
                # vectores normalizados queda al 0.00001 = 5e-5)
                bucket_dict[sign].append({
                    "sha":       sha,
                    "embedding": [round(float(x), 5) for x in emb],
                })

        batch_num = batch_start // BATCH + 1
        total_batches = (len(sha_key_pairs) + BATCH - 1) // BATCH
        print(f"[protos] batch {batch_num}/{total_batches} done", flush=True)

    pool.shutdown(wait=False)

    # ── 5. Build payload + stats + persist ──────────────────────────────
    n_labels = len(prototypes_out)
    n_pos    = sum(len(d.get("positive", [])) for d in prototypes_out.values())
    n_neg    = sum(len(d.get("negative", [])) for d in prototypes_out.values())
    payload = {
        "generatedAt":  datetime.now(timezone.utc).isoformat(),
        "model":        MODEL_ID,
        "embeddingDim": 768,
        "knnConfig": {
            "minProtos":         KNN_MIN_PROTOS,
            "simThreshold":      KNN_SIM_THRESHOLD,
            "boostWeight":       KNN_BOOST_WEIGHT,
            "penaltyWeight":     KNN_PENALTY_WEIGHT,
            "uncertainRange":    [KNN_UNCERTAIN_LO, KNN_UNCERTAIN_HI],
        },
        "stats": {
            "totalLabels":         n_labels,
            "totalPositiveProtos": n_pos,
            "totalNegativeProtos": n_neg,
        },
        "prototypes": prototypes_out,
    }

    # Compact JSON (sin indent) — el archivo puede ser grande (4-5 MB con
    # 400+ prototipos) y la legibilidad humana no importa aquí. Para debug
    # puntual se puede pretty-print con `jq` post-download.
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    print(f"[protos] uploading prototypes.json ({len(body) / 1024:.1f} KB) to R2...", flush=True)
    s3.put_object(
        Bucket       = bucket,
        Key          = "meta/prototypes.json",
        Body         = body,
        ContentType  = "application/json; charset=utf-8",
        CacheControl = "no-cache",
    )
    print(
        f"[protos] done — {n_labels} labels, {n_pos} positivos + {n_neg} negativos en prototypes.json",
        flush=True,
    )
    return payload


@app.local_entrypoint()
def compute_prototypes(force: bool = False, only_label: str = "", save_local: bool = True) -> None:
    """Computa embeddings de imágenes confirmadas/excluidas por el admin y
    los persiste como prototipos kNN en meta/prototypes.json (R2). El
    classifier los usa en `classify_batch` para boost/penalty (Fase C).

    Args (pasan tras `--` en `modal run`):
      --force          Re-computa TODOS los prototipos desde cero (ignora R2)
      --only-label X   Solo computa prototipos para el label X
      --no-save-local  No guardar copia local en tools/image-audit/prototypes.json

    Uso típico (tras swipear bastante en /admin/images-bank):
      npm run images:compute-prototypes
    """
    print(f"🧬 Modal compute_prototypes — force={force}, only_label='{only_label or 'all'}'")
    print(f"   credentials source: {'.env(.local)' if _env_loaded else 'modal secret'}")

    only = only_label.strip() or None
    payload = compute_prototypes_fn.remote(force=force, only_label=only)

    if not payload or not payload.get("prototypes"):
        print("✅ nothing to do (no new prototypes to compute)")
        return

    if save_local and ROOT is not None:
        out = ROOT / "tools" / "image-audit" / "prototypes.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        # Compact local también — el JSON pretty-printed sería enorme con
        # arrays de 768 floats. Para inspeccionar: `jq . prototypes.json`
        out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        print(f"💾 local copy → {out}")

    stats = payload.get("stats", {})
    print(f"✅ prototypes.json updated in R2 (meta/prototypes.json)")
    print(f"   total labels:       {stats.get('totalLabels', 0)}")
    print(f"   positive prototypes: {stats.get('totalPositiveProtos', 0)}")
    print(f"   negative prototypes: {stats.get('totalNegativeProtos', 0)}")
    print()
    print(f"📝 Próximo paso: corre el classifier para que use los prototipos")
    print(f"   npm run images:classify-modal -- --force")


# ── Local entrypoint ───────────────────────────────────────────────────
@app.local_entrypoint()
def main(
    force:             bool = False,
    limit:             int  = 0,
    save_local:        bool = True,
    no_gemini:         bool = False,
    no_groq:           bool = False,
    retry_problematic: bool = False,
) -> None:
    """
    Args (pasan tras `--` en `modal run`):
      --force              Reprocesa TODAS las imágenes aunque ya estén en R2.
                           Preserva el resto del prev (importante con --limit).
      --limit N            Cap a las primeras N imágenes (smoke test)
      --no-save-local      NO guardar copia local del classification.json
      --no-gemini          Desactiva Gemini aunque GEMINI_API_KEY esté seteado
      --no-groq            Desactiva Groq aunque GROQ_API_KEY esté seteado
      --retry-problematic  Reprocesa SOLO las imgs sin tag confident (las
                           que se quedaron sin discovery por quota agotada
                           en un run previo). Las imgs con tag confident
                           del prev se preservan intactas.
    """
    print(f"🚀 Modal SigLIP classifier + auto-discovery")
    print(f"   force={force}  limit={limit or 'all'}  save_local={save_local}")
    print(f"   gemini={'OFF' if no_gemini else 'ON'}  groq={'OFF' if no_groq else 'ON'}")
    print(f"   retry_problematic={retry_problematic}")
    has_gemini = "GEMINI_API_KEY" in _env_loaded
    has_groq   = "GROQ_API_KEY"   in _env_loaded
    print(f"   credentials source: {'.env(.local)' if _env_loaded else 'modal secret'}")
    print(f"   keys disponibles: R2={'YES' if _r2_keys[0] in _env_loaded else 'NO'}  GEMINI={'YES' if has_gemini else 'NO'}  GROQ={'YES' if has_groq else 'NO'}")

    payload = orchestrate.remote(
        force=force, limit=limit, no_gemini=no_gemini, no_groq=no_groq,
        retry_problematic=retry_problematic,
    )

    if not payload:
        print("✅ nothing to do (no images in R2)")
        return

    # Caso "ya estaba todo clasificado"
    if payload.get("__skipped__"):
        existing  = payload.get("existing", {})
        n_imgs    = len(existing.get("images", {}))
        n_labels  = len(existing.get("labels", []))
        prev_gen  = existing.get("generatedAt", "?")
        prev_back = existing.get("backend", "classify_siglip.py (local)")
        print(f"✅ Todo al día — R2 NO se ha tocado (idempotente)")
        print(f"   ya clasificadas: {n_imgs} imgs con {n_labels} labels")
        print(f"   meta/classification.json generado: {prev_gen} ({prev_back})")
        print()
        print(f"   Para reprocesar todo con Modal (sobreescribe el JSON anterior):")
        print(f"     npm run images:classify-modal -- --force")
        return

    # Caso real
    if save_local and ROOT is not None:
        out = ROOT / "tools" / "image-audit" / "classification.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"💾 local copy → {out}")
    elif save_local and ROOT is None:
        print("⚠ ROOT no resuelto — skipping local copy")

    stats     = payload.get("stats", {})
    disc_stat = payload.get("discoveryStats", {})
    total     = len(payload.get("images", {}))
    print(f"✅ classification.json updated in R2 (meta/classification.json)")
    print(f"   total images:          {total}")
    print(f"   without any tag:       {stats.get('imagesWithoutTags', 0)}")
    print(f"   without confident tag: {stats.get('imagesWithoutConfident', 0)}")
    if disc_stat:
        print(f"   labels descubiertos:    {disc_stat.get('totalDiscoveredLabels', 0)} totales ({disc_stat.get('newDiscoveredThisRun', 0)} nuevos)")
        gem = disc_stat.get("gemini", {})
        groq = disc_stat.get("groq", {})
        if gem.get("callsMade", 0) > 0:
            print(f"   gemini calls:           {gem['callsMade']} → {gem.get('suggestionsAdded', 0)} sugerencias añadidas")
        if groq.get("callsMade", 0) > 0:
            print(f"   groq calls:             {groq['callsMade']} → {groq.get('suggestionsAdded', 0)} sugerencias añadidas")
        if disc_stat.get("rejectedSuggestionCount", 0) > 0:
            print(f"   sugerencias rechazadas: {disc_stat['rejectedSuggestionCount']} (ver meta/rejected_suggestions.json)")
    top_tags = sorted(stats.get("tagCounts", {}).items(), key=lambda kv: -kv[1])[:10]
    if top_tags:
        print(f"   top tags:")
        for tag, count in top_tags:
            confident = stats.get("confidentTagCounts", {}).get(tag, 0)
            print(f"     {count:5d}  {tag:30s}  [{confident} confident]")
