"""
Refinador de prompts del classifier con feedback humano (Fase B).

Lee `meta/tag_confirmations.json` y `meta/tag_exclusions.json` de R2,
agrupa por label, y para los que pasan thresholds:
  - >= 5 confirmaciones → refinar prompts POSITIVOS de ese label
  - >= 10 exclusiones    → refinar prompts NEGATIVOS de ese label

Para cada label candidato:
  1. Sample hasta 8 imgs positivas (humano dijo SÍ) + hasta 8 negativas
     (humano dijo NO) de R2.
  2. Llama a Gemini multimodal con esas imágenes + los prompts actuales,
     pidiendo 3 prompts positivos refinados + 3 negativos refinados.
  3. Valida formato (3 strings de 12-30 palabras cada uno).
  4. Persiste el refinement en `meta/refined_labels.json` en R2.

El classifier (classify_siglip.py + modal_app.py) carga refined_labels.json
y REEMPLAZA los prompts originales por los refinados al cargar el vocab.

Uso:
  python refine_labels.py                # refina todos los candidatos
  python refine_labels.py --dry-run      # muestra qué refinaría, no toca R2
  python refine_labels.py --label X      # solo refina el label X
  python refine_labels.py --min-confirmations 3 --min-exclusions 5
                                          # bajar thresholds
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import boto3

try:
    from google import genai as google_genai
    from google.genai import types as genai_types
except ImportError:
    print("❌ google-genai no instalado. Corre: npm run images:setup-classifier")
    sys.exit(1)

# Groq es OPCIONAL — se usa como fallback si Gemini se queda sin quota.
# Si no está instalado o no hay GROQ_API_KEY, el script funciona igual
# pero abortará si Gemini agota cuota (en vez de continuar con Groq).
try:
    from groq import Groq as GroqClient
    _GROQ_AVAILABLE = True
except ImportError:
    GroqClient = None  # type: ignore
    _GROQ_AVAILABLE = False

sys.path.insert(0, str(Path(__file__).resolve().parent))
from labels import LABELS, LABEL_NEGATIVES
from classifier_core import GROQ_MODEL_ID

ROOT = Path(__file__).resolve().parents[2]
CONFIRMATION_THRESHOLD = 5
EXCLUSION_THRESHOLD    = 10
SAMPLE_SIZE            = 8
GEMINI_MODEL_ID        = "gemini-2.5-flash"
RATE_LIMIT_SLEEP_S     = 1.5  # entre calls a Gemini para no agotar quota

REFINE_PROMPT_TEMPLATE = """You are refining a SigLIP zero-shot image classifier's vocabulary for Spanish driving theory test (DGT) images.

LABEL BEING REFINED: "{lid}"

CURRENT POSITIVE PROMPTS (what we use today — humans gave feedback they need to improve):
{current_positives}

CURRENT NEGATIVE PROMPTS (used to penalize false positives):
{current_negatives}

I'm sending you {n_pos} POSITIVE images (humans confirmed these ARE "{lid}") and {n_neg} NEGATIVE images (humans rejected these — they are NOT "{lid}").

YOUR TASK:
{tasks}

OUTPUT FORMAT — return ONLY a JSON object with this exact shape (no markdown fences, no commentary):
{{
  "refinedPositives": ["sentence 1", "sentence 2", "sentence 3"],
  "refinedNegatives": ["sentence 1", "sentence 2", "sentence 3"],
  "reasoning": "<one short paragraph (max 300 chars) explaining the visual patterns you noticed in positives vs negatives>"
}}

RULES:
- Each refined prompt: English, 12-30 words, describes visual features distinguishing positives from negatives.
- Do NOT include the literal label name "{lid}" inside the prompt sentences.
- If you cannot confidently refine positives (few examples or unclear patterns), keep them similar to current.
- Same for negatives.
- The 3+3 sentences should be DIVERSE — cover different angles, not paraphrases.
"""


# ── env loading ─────────────────────────────────────────────────────────
def _load_env_files(*paths: Path) -> None:
    for path in paths:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip("\"").strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


_load_env_files(ROOT / ".env.local", ROOT / ".env")


# ── R2 helpers ──────────────────────────────────────────────────────────
def _get_meta(s3, bucket: str, key: str) -> Optional[dict]:
    try:
        r = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(r["Body"].read())
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as e:  # noqa: BLE001
        print(f"⚠  failed to read {key}: {e}")
        return None


def _put_meta(s3, bucket: str, key: str, data: dict) -> None:
    body = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    s3.put_object(
        Bucket       = bucket,
        Key          = key,
        Body         = body,
        ContentType  = "application/json; charset=utf-8",
        CacheControl = "no-cache",
    )


def _list_image_keys_for_shas(s3, bucket: str, shas: set[str]) -> dict[str, str]:
    """Lista TODOS los keys del bucket (excepto meta/) y devuelve sha → key
    para las SHAs solicitadas. Una sola pasada por R2 — eficiente para muchas
    SHAs a la vez vs hacer HEAD por cada una."""
    out: dict[str, str] = {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.startswith("meta/"):
                continue
            sha = Path(key).stem
            if sha in shas:
                out[sha] = key
    return out


def _download_imgs(s3, bucket: str, sha_keys: dict[str, str]) -> list[tuple[str, bytes, str]]:
    """Returns list de (sha, bytes, mime)."""
    out: list[tuple[str, bytes, str]] = []
    for sha, key in sha_keys.items():
        try:
            r = s3.get_object(Bucket=bucket, Key=key)
            data = r["Body"].read()
            ext = Path(key).suffix.lower().lstrip(".")
            mime = {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
            out.append((sha, data, mime))
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠  fail to download {key[:16]}…: {e}")
    return out


# ── Gemini refinement call ──────────────────────────────────────────────
def _validate_refinement(parsed: object) -> Optional[dict]:
    """Valida formato del JSON de Gemini. Returns dict normalizado o None."""
    if not isinstance(parsed, dict):
        return None
    refined_pos = parsed.get("refinedPositives")
    refined_neg = parsed.get("refinedNegatives")
    reasoning   = parsed.get("reasoning", "")
    if not (isinstance(refined_pos, list) and len(refined_pos) == 3):
        print(f"  ⚠  refinedPositives debe ser lista de 3, got: {type(refined_pos)} len={len(refined_pos) if isinstance(refined_pos, list) else '?'}")
        return None
    if not (isinstance(refined_neg, list) and len(refined_neg) == 3):
        print(f"  ⚠  refinedNegatives debe ser lista de 3")
        return None
    for arr, name in [(refined_pos, "refinedPositives"), (refined_neg, "refinedNegatives")]:
        for i, p in enumerate(arr):
            if not isinstance(p, str):
                print(f"  ⚠  {name}[{i}] no es string")
                return None
            n_words = len(p.split())
            if not (10 <= n_words <= 35):  # un poco más laxos que el spec
                print(f"  ⚠  {name}[{i}] tiene {n_words} palabras (esperado 10-35): {p[:80]}…")
                return None
    return {
        "refinedPositives": [p.strip() for p in refined_pos],
        "refinedNegatives": [p.strip() for p in refined_neg],
        "reasoning":        str(reasoning)[:500],
    }


def call_gemini_refine(
    client,
    lid:               str,
    current_positives: list[str],
    current_negatives: list[str],
    pos_imgs:          list[tuple[str, bytes, str]],
    neg_imgs:          list[tuple[str, bytes, str]],
    refine_positives:  bool,
    refine_negatives:  bool,
) -> Optional[dict]:
    """Llama a Gemini con las imágenes y devuelve refinement validado, o None."""
    tasks: list[str] = []
    if refine_positives:
        tasks.append(f"Generate 3 NEW positive prompts capturing visual features common to the {len(pos_imgs)} positive images that distinguish them from the negatives.")
    else:
        tasks.append("Keep positive prompts very similar to current (not enough positive examples to refine confidently).")
    if refine_negatives:
        tasks.append(f"Generate 3 NEW negative prompts capturing visual features common to the {len(neg_imgs)} negative images that incorrectly trigger this label today.")
    else:
        tasks.append("Keep negative prompts very similar to current (not enough negative examples to refine confidently).")

    prompt_text = REFINE_PROMPT_TEMPLATE.format(
        lid=lid,
        n_pos=len(pos_imgs),
        n_neg=len(neg_imgs),
        current_positives="\n".join(f"- {p}" for p in current_positives) or "(none)",
        current_negatives="\n".join(f"- {p}" for p in current_negatives) or "(none)",
        tasks="\n".join(f"{i+1}. {t}" for i, t in enumerate(tasks)),
    )

    # Construir la secuencia de contents: cada imagen seguida de su label
    contents: list = []
    for sha, img_bytes, mime in pos_imgs:
        contents.append(genai_types.Part.from_bytes(data=img_bytes, mime_type=mime))
        contents.append(f"^^ POSITIVE (sha:{sha[:8]}…) — this IS {lid}")
    for sha, img_bytes, mime in neg_imgs:
        contents.append(genai_types.Part.from_bytes(data=img_bytes, mime_type=mime))
        contents.append(f"^^ NEGATIVE (sha:{sha[:8]}…) — this is NOT {lid}")
    contents.append(prompt_text)

    try:
        response = client.models.generate_content(
            model    = GEMINI_MODEL_ID,
            contents = contents,
            config   = genai_types.GenerateContentConfig(
                response_mime_type = "application/json",
                temperature        = 0.4,
                # 800 era insuficiente — Gemini truncaba en mitad de string
                # cuando devolvía 3 positivos + 3 negativos + reasoning,
                # especialmente con prompts largos (15-30 palabras × 6) y
                # razonamiento detallado. 3000 da margen sobrado:
                #   3 pos × 30 palabras × 1.5 tok/palabra = ~135 tok
                #   3 neg × 30 palabras × 1.5 tok/palabra = ~135 tok
                #   reasoning ~500 chars                   = ~150 tok
                #   estructura JSON + comas + claves      = ~50 tok
                #   total ~470 tok típico, 3000 sobra.
                max_output_tokens  = 3000,
            ),
        )
        text = (response.text or "").strip()
        # defensive strip de fences
        if text.startswith("```"):
            text = text.split("```", 2)[1] if "```" in text[3:] else text[3:]
            if text.startswith("json"):
                text = text[4:]
            text = text.rsplit("```", 1)[0].strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as e:
            print(f"  ⚠  JSON inválido: {e}; raw: {text[:200]}…")
            return None
        return _validate_refinement(parsed)
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if any(k in msg for k in ("quota", "rate limit", "429", "resource_exhausted")):
            print(f"  ❌  Gemini quota agotada — abortando")
            raise
        if any(k in msg for k in ("api key", "unauthorized", "401", "403")):
            print(f"  ❌  Gemini API key inválida — abortando")
            raise
        print(f"  ⚠  Gemini error: {str(e)[:200]}")
        return None


# ── Groq fallback (mismo prompt, OpenAI-compatible chat) ─────────────────

def call_groq_refine(
    client,                       # groq.Groq
    lid:               str,
    current_positives: list[str],
    current_negatives: list[str],
    pos_imgs:          list[tuple[str, bytes, str]],
    neg_imgs:          list[tuple[str, bytes, str]],
    refine_positives:  bool,
    refine_negatives:  bool,
) -> Optional[dict]:
    """Versión Groq de call_gemini_refine — usa Llama 4 Scout multimodal
    como fallback cuando Gemini agota quota. Mismo prompt, mismo schema
    de respuesta. Las imágenes van como `image_url` en data URIs base64
    (formato OpenAI-compatible que Groq Llama Scout entiende)."""
    import base64 as _b64

    tasks: list[str] = []
    if refine_positives:
        tasks.append(f"Generate 3 NEW positive prompts capturing visual features common to the {len(pos_imgs)} positive images that distinguish them from the negatives.")
    else:
        tasks.append("Keep positive prompts very similar to current (not enough positive examples to refine confidently).")
    if refine_negatives:
        tasks.append(f"Generate 3 NEW negative prompts capturing visual features common to the {len(neg_imgs)} negative images that incorrectly trigger this label today.")
    else:
        tasks.append("Keep negative prompts very similar to current (not enough negative examples to refine confidently).")

    prompt_text = REFINE_PROMPT_TEMPLATE.format(
        lid=lid,
        n_pos=len(pos_imgs),
        n_neg=len(neg_imgs),
        current_positives="\n".join(f"- {p}" for p in current_positives) or "(none)",
        current_negatives="\n".join(f"- {p}" for p in current_negatives) or "(none)",
        tasks="\n".join(f"{i+1}. {t}" for i, t in enumerate(tasks)),
    )

    # Construir el message content multimodal. Groq Llama 4 Scout acepta
    # múltiples image_url + texto en el mismo user message; para cada
    # imagen incluimos una línea de texto inmediatamente después que la
    # etiqueta como POSITIVE o NEGATIVE — mismo patrón que con Gemini.
    content_parts: list[dict] = []
    for sha, img_bytes, mime in pos_imgs:
        b64 = _b64.b64encode(img_bytes).decode("ascii")
        content_parts.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        })
        content_parts.append({"type": "text", "text": f"^^ POSITIVE (sha:{sha[:8]}…) — this IS {lid}"})
    for sha, img_bytes, mime in neg_imgs:
        b64 = _b64.b64encode(img_bytes).decode("ascii")
        content_parts.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        })
        content_parts.append({"type": "text", "text": f"^^ NEGATIVE (sha:{sha[:8]}…) — this is NOT {lid}"})
    content_parts.append({"type": "text", "text": prompt_text})

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL_ID,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a JSON-only API. Your entire response must be a single "
                        "valid JSON object with these fields: refinedPositives (array of "
                        "exactly 3 English strings), refinedNegatives (array of exactly "
                        "3 English strings), and reasoning (one explanation paragraph in "
                        "Spanish). No markdown fences, no prefatory text."
                    ),
                },
                {"role": "user", "content": content_parts},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
            max_tokens=3000,
        )
        text = (response.choices[0].message.content or "").strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1] if "```" in text[3:] else text[3:]
            if text.startswith("json"):
                text = text[4:]
            text = text.rsplit("```", 1)[0].strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as e:
            print(f"  ⚠  Groq JSON inválido: {e}; raw: {text[:200]}…")
            return None
        return _validate_refinement(parsed)
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if any(k in msg for k in ("quota", "rate limit", "429", "resource_exhausted")):
            print(f"  ❌  Groq quota agotada — abortando")
            raise
        if any(k in msg for k in ("api key", "unauthorized", "401", "403")):
            print(f"  ❌  Groq API key inválida — abortando")
            raise
        print(f"  ⚠  Groq error: {str(e)[:200]}")
        return None


# ── Main ────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Refina prompts de LABELS con feedback humano vía Gemini")
    parser.add_argument("--dry-run", action="store_true", help="No escribe en R2; solo muestra qué se refinaría")
    parser.add_argument("--label", type=str, default=None, help="Refinar solo este label (override de thresholds)")
    parser.add_argument("--min-confirmations", type=int, default=CONFIRMATION_THRESHOLD,
                        help=f"Mín. confirmaciones para refinar positivos (default {CONFIRMATION_THRESHOLD})")
    parser.add_argument("--min-exclusions", type=int, default=EXCLUSION_THRESHOLD,
                        help=f"Mín. exclusiones para refinar negativos (default {EXCLUSION_THRESHOLD})")
    parser.add_argument("--limit", type=int, default=0, help="Cap al número de labels a refinar (0=todos)")
    args = parser.parse_args()

    print(f"🤖 Refinador de prompts vía Gemini ({GEMINI_MODEL_ID})")
    print(f"   thresholds: confirmations >= {args.min_confirmations}, exclusions >= {args.min_exclusions}")
    if args.label:
        print(f"   filter: label = '{args.label}'")
    if args.dry_run:
        print(f"   mode: DRY-RUN (no R2 writes)")
    print()

    # R2 client
    s3 = boto3.client(
        "s3",
        endpoint_url          = f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id     = os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key = os.environ["R2_SECRET_ACCESS_KEY"],
        region_name           = "auto",
    )
    bucket = os.environ["R2_BUCKET_NAME"]

    # Leer feedback de R2
    confs = _get_meta(s3, bucket, "meta/tag_confirmations.json")
    excls = _get_meta(s3, bucket, "meta/tag_exclusions.json")
    conf_map: dict[str, list[str]] = (confs or {}).get("confirmations", {})
    excl_map: dict[str, list[str]] = (excls or {}).get("exclusions", {})

    # Agrupar por label
    label_to_pos_shas: dict[str, list[str]] = {}
    label_to_neg_shas: dict[str, list[str]] = {}
    for sha, tags in conf_map.items():
        for tag in tags:
            label_to_pos_shas.setdefault(tag, []).append(sha)
    for sha, tags in excl_map.items():
        for tag in tags:
            label_to_neg_shas.setdefault(tag, []).append(sha)

    # Candidatos
    candidates: list[tuple[str, int, int]] = []
    for lid in set(label_to_pos_shas.keys()) | set(label_to_neg_shas.keys()):
        n_pos = len(label_to_pos_shas.get(lid, []))
        n_neg = len(label_to_neg_shas.get(lid, []))
        if n_pos >= args.min_confirmations or n_neg >= args.min_exclusions:
            if args.label and lid != args.label:
                continue
            candidates.append((lid, n_pos, n_neg))

    if args.label and not any(c[0] == args.label for c in candidates):
        # Forzar inclusión del label aunque no pase thresholds (para forzar refinement)
        n_pos = len(label_to_pos_shas.get(args.label, []))
        n_neg = len(label_to_neg_shas.get(args.label, []))
        if n_pos > 0 or n_neg > 0:
            print(f"⚠  Label '{args.label}' tiene {n_pos}+{n_neg} (debajo de thresholds {args.min_confirmations}/{args.min_exclusions}) pero --label lo fuerza")
            candidates.append((args.label, n_pos, n_neg))
        else:
            print(f"❌ Label '{args.label}' no tiene NINGÚN feedback. Aborto.")
            sys.exit(1)

    candidates.sort(key=lambda x: -(x[1] + x[2]))
    if args.limit > 0:
        candidates = candidates[: args.limit]

    print(f"🎯 {len(candidates)} labels candidatos:")
    for lid, n_pos, n_neg in candidates:
        scope = []
        if n_pos >= args.min_confirmations: scope.append(f"+{n_pos} pos → refine positives")
        if n_neg >= args.min_exclusions:    scope.append(f"−{n_neg} neg → refine negatives")
        if not scope: scope.append(f"({n_pos}+{n_neg} below thresholds — forced)")
        print(f"   {lid:35s}  {' | '.join(scope)}")
    print()

    if args.dry_run:
        print("✅ --dry-run: nada más que hacer.")
        return

    # Setup Gemini (primario)
    gem_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not gem_key:
        print("❌ GEMINI_API_KEY no encontrada en .env / .env.local")
        sys.exit(1)
    print(f"🤖 Gemini ({GEMINI_MODEL_ID}) — key prefix '{gem_key[:4]}' len={len(gem_key)}")
    gem_client = google_genai.Client(api_key=gem_key)

    # Setup Groq (fallback opcional). Si no hay key o `groq` no está
    # instalado, seguimos con Gemini solo. Si Gemini agota cuota mid-run
    # automáticamente pasamos a Groq para procesar el resto de candidatos
    # — sin abortar.
    gem_disabled = False                              # se activa si Gemini cae
    groq_key     = os.environ.get("GROQ_API_KEY", "").strip()
    groq_client  = None
    if _GROQ_AVAILABLE and groq_key:
        try:
            groq_client = GroqClient(api_key=groq_key)
            print(f"🦙 Groq    ({GROQ_MODEL_ID}) — key prefix '{groq_key[:4]}' len={len(groq_key)} (fallback)")
        except Exception as e:  # noqa: BLE001
            print(f"⚠  Groq init failed — disabled: {e}")
            groq_client = None
    elif not _GROQ_AVAILABLE:
        print(f"   (groq package no instalado — sin fallback. `pip install groq` para activarlo)")
    elif not groq_key:
        print(f"   (GROQ_API_KEY no configurada — sin fallback. Añade a .env si quieres uno)")
    print()

    # Listar keys de R2 para todas las SHAs en una pasada
    all_shas: set[str] = set()
    for lid, _, _ in candidates:
        all_shas.update(label_to_pos_shas.get(lid, []))
        all_shas.update(label_to_neg_shas.get(lid, []))
    print(f"📥 listando keys de R2 para {len(all_shas)} SHAs únicas...")
    sha_to_key = _list_image_keys_for_shas(s3, bucket, all_shas)
    missing = all_shas - set(sha_to_key.keys())
    if missing:
        print(f"   {len(sha_to_key)} encontradas, {len(missing)} SHAs no existen en R2 (se saltarán esas imgs)")
    print()

    # Dict de LABELS para lookup rápido
    labels_dict = {lid: prompts for lid, prompts in LABELS}

    refinements: dict[str, dict] = {}
    for i, (lid, n_pos, n_neg) in enumerate(candidates, 1):
        print(f"\n[{i}/{len(candidates)}] 🔄 Refinando '{lid}' (pos={n_pos}, neg={n_neg})")

        refine_pos = n_pos >= args.min_confirmations
        refine_neg = n_neg >= args.min_exclusions

        # Sample (semilla por lid para reproducibilidad)
        rng = random.Random(42 + (hash(lid) & 0xFFFFFFFF))
        pos_shas = list(label_to_pos_shas.get(lid, []))
        neg_shas = list(label_to_neg_shas.get(lid, []))
        rng.shuffle(pos_shas)
        rng.shuffle(neg_shas)
        pos_shas = pos_shas[:SAMPLE_SIZE]
        neg_shas = neg_shas[:SAMPLE_SIZE]

        pos_keys = {sha: sha_to_key[sha] for sha in pos_shas if sha in sha_to_key}
        neg_keys = {sha: sha_to_key[sha] for sha in neg_shas if sha in sha_to_key}
        print(f"   downloading {len(pos_keys)} positives + {len(neg_keys)} negatives de R2...")
        pos_imgs = _download_imgs(s3, bucket, pos_keys)
        neg_imgs = _download_imgs(s3, bucket, neg_keys)

        if len(pos_imgs) == 0 and len(neg_imgs) == 0:
            print(f"   ⚠  sin imágenes downloadeables — skip")
            continue

        current_positives = labels_dict.get(lid, [])
        current_negatives = LABEL_NEGATIVES.get(lid, [])

        # Provider selection: si Gemini no está agotado, va primero. Si
        # cayó por quota antes, saltamos directo a Groq para este label.
        result            = None
        used_provider:    Optional[str] = None
        if not gem_disabled:
            try:
                result = call_gemini_refine(
                    gem_client, lid,
                    current_positives, current_negatives,
                    pos_imgs, neg_imgs,
                    refine_positives=refine_pos,
                    refine_negatives=refine_neg,
                )
                if result is not None:
                    used_provider = GEMINI_MODEL_ID
            except Exception as e:  # noqa: BLE001
                # Quota / auth fatal de Gemini. Si tenemos Groq, lo
                # usamos para este label y los siguientes (gem_disabled).
                msg = str(e).lower()
                gem_disabled = True
                if groq_client is None:
                    print(f"\n❌ Gemini error fatal y SIN fallback Groq — abortando run. Refinements parciales se persisten abajo.")
                    break
                print(f"   ↪  Gemini caído ({msg[:80]}) — reintentando con Groq...")

        if result is None and groq_client is not None and gem_disabled:
            try:
                result = call_groq_refine(
                    groq_client, lid,
                    current_positives, current_negatives,
                    pos_imgs, neg_imgs,
                    refine_positives=refine_pos,
                    refine_negatives=refine_neg,
                )
                if result is not None:
                    used_provider = GROQ_MODEL_ID
            except Exception:
                # Groq también cayó → abortar
                print(f"\n❌ Gemini Y Groq agotados — abortando run. Refinements parciales se persisten abajo.")
                break

        if result is None:
            print(f"   ⚠  no se obtuvo un refinement válido — skip")
            continue

        print(f"   ✅ refinement OK")
        print(f"      reasoning: {result['reasoning'][:160]}…" if len(result["reasoning"]) > 160 else f"      reasoning: {result['reasoning']}")
        print(f"      new positives (first):")
        print(f"        {result['refinedPositives'][0][:120]}…" if len(result["refinedPositives"][0]) > 120 else f"        {result['refinedPositives'][0]}")
        print(f"      new negatives (first):")
        print(f"        {result['refinedNegatives'][0][:120]}…" if len(result["refinedNegatives"][0]) > 120 else f"        {result['refinedNegatives'][0]}")

        refinements[lid] = {
            "originalPrompts":   list(current_positives),
            "originalNegatives": list(current_negatives),
            "refinedPositives":  result["refinedPositives"]  if refine_pos else list(current_positives),
            "refinedNegatives":  result["refinedNegatives"]  if refine_neg else list(current_negatives),
            "reasoning":         result["reasoning"],
            "refinedAt":         datetime.now(timezone.utc).isoformat(),
            # Provider real (Gemini si fue OK, Groq si cayó la quota y se
            # usó fallback). Útil para auditar: si veo "refinedBy: llama-..."
            # sé que Gemini estaba agotado en ese momento.
            "refinedBy":         used_provider or GEMINI_MODEL_ID,
            "nPositiveSamples":  len(pos_imgs),
            "nNegativeSamples":  len(neg_imgs),
            "scope":             "both" if (refine_pos and refine_neg) else ("positives" if refine_pos else "negatives"),
        }

        # Rate limit suave entre calls (Gemini free tier es estricto)
        if i < len(candidates):
            time.sleep(RATE_LIMIT_SLEEP_S)

    # ── Persist ─────────────────────────────────────────────────────────
    if not refinements:
        print("\n✅ No hay refinements para guardar.")
        return

    # Merge con existing
    existing = _get_meta(s3, bucket, "meta/refined_labels.json")
    if existing and isinstance(existing.get("refinements"), dict):
        merged = dict(existing["refinements"])
        n_overwritten = sum(1 for lid in refinements if lid in merged)
    else:
        merged = {}
        n_overwritten = 0
    merged.update(refinements)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count":       len(merged),
        "note":        "Refinements producidos por refine_labels.py. El classifier "
                       "los carga al inicio y REEMPLAZA los prompts originales de "
                       "LABELS/LABEL_NEGATIVES con estos. Para regenerar: borra esta "
                       "entrada y re-corre el script.",
        "refinements": merged,
    }
    _put_meta(s3, bucket, "meta/refined_labels.json", payload)
    print(f"\n💾 meta/refined_labels.json subido a R2")
    print(f"   {len(merged)} refinements totales en R2")
    print(f"   {len(refinements)} nuevos en este run ({n_overwritten} sobreescribieron versiones previas)")

    # Copia local para que classify_siglip.py local pueda usarla sin
    # necesidad de hacer `npm run images:download-metadata` después.
    # modal_app.py NO la usa (lee directo de R2), por lo que es solo para
    # paridad con el local workflow.
    local_path = ROOT / "tools" / "image-audit" / "refined_labels.json"
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"💾 copia local → {local_path}")

    print()
    print(f"📝 Próximo paso: corre el classifier para aplicar los refinements")
    print(f"   npm run images:classify-modal -- --force        # cloud, recomendado")
    print(f"   npm run images:classify -- --force              # local")


if __name__ == "__main__":
    main()
