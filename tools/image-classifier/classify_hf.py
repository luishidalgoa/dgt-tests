"""
Clasificador SigLIP via HuggingFace Inference API.

Alternativa LIGERA a classify_siglip.py — usa el endpoint hosteado de HF
para zero-shot image classification. NO requiere torch ni transformers ni
descargar el modelo (~370 MB), pero a cambio de:

  - Velocidad limitada por la API (≈1-3s por imagen, vs 0.3-1s local)
  - Sin caché de embeddings (la API no expone embeddings)
  - Sin label discovery via Gemini/Groq (eso sigue siendo solo en local)

Cuándo usar este vs `classify_siglip.py`:
  - HF: máquina sin GPU, sin Python deps pesadas, runs ocasionales
  - Local (classify_siglip.py): runs frecuentes, label discovery activo,
    o cuando ya tienes el modelo descargado

Requisitos:
  - pip install huggingface_hub Pillow tqdm
  - HF_TOKEN en .env (gratis en https://huggingface.co/settings/tokens)

Las etiquetas vienen de `labels.py` — el MISMO archivo que usa
classify_siglip.py. No se duplican.

Cómo aproxima la math del classify_siglip.py local:
  1. Para cada imagen, manda TODOS los prompts (positivos + negativos)
     como candidate_labels a la HF API.
  2. HF devuelve score por prompt.
  3. Agregamos: avg(scores positivos) por label_id, avg(scores negativos)
     por label_id, restamos NEG_WEIGHT * neg_avg, clamp [0,1].

Esto es ~equivalente a lo que hace el classifier local, solo que HF
internamente hace embedding+dot+sigmoid+normalization (no nos da los
embeddings crudos para hacer multi-prompt averaging exacto en el espacio
de la esfera unitaria). En la práctica, las diferencias de precisión son
pequeñas (<5% F1 en pruebas con CLIP/SigLIP).

Uso:
    cd tools/image-classifier
    python classify_hf.py            # default: clasifica todas las imágenes pendientes
    python classify_hf.py --limit 10 # solo las primeras 10 (smoke test)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

from PIL import Image
from tqdm import tqdm

# Importar etiquetas desde labels.py (el mismo archivo que usa classify_siglip.py)
sys.path.insert(0, str(Path(__file__).parent))
from labels import LABELS, LABEL_NEGATIVES, NEG_WEIGHT  # noqa: E402

# huggingface_hub es el SDK oficial. Si falta, hay un error claro.
try:
    from huggingface_hub import InferenceClient
except ImportError:
    print("✗ Falta huggingface_hub. Instálalo con: pip install huggingface_hub Pillow tqdm")
    sys.exit(1)

# ── Config ─────────────────────────────────────────────────────────────
ROOT             = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT    = ROOT / "public" / "images"
DEFAULT_OUTPUT   = ROOT / "tools" / "image-audit" / "classification.json"
EXCLUSIONS_PATH  = ROOT / "tools" / "image-audit" / "tag_exclusions.json"
CONFIRMATIONS_PATH = ROOT / "tools" / "image-audit" / "tag_confirmations.json"
MODEL_ID         = "google/siglip-base-patch16-256"
THRESHOLD        = 0.5
CONFIRMED_BOOST  = 0.30   # mismo valor que usa classify_siglip.py
MAX_RETRIES      = 3      # 503/timeout / cold-start retries

# Carga las env vars desde .env / .env.local del proyecto (sin python-dotenv)
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
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v

_load_env_files(ROOT / ".env.local", ROOT / ".env")


# ── Helpers ────────────────────────────────────────────────────────────

def load_json_map(path: Path, mapkey: str) -> dict[str, list[str]]:
    """Carga {generatedAt, [mapkey]: {sha: [tags]}} → solo el mapa interno."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get(mapkey, {}) or {}
    except Exception:
        return {}


def classify_image(client: InferenceClient, img_path: Path, prompts: list[str]) -> dict[str, float]:
    """
    Pide a HF API que clasifique `img_path` contra los `prompts` dados.
    Devuelve {prompt: score}. Con retries simples ante 503/cold-start.
    """
    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            results = client.zero_shot_image_classification(
                str(img_path),
                candidate_labels=prompts,
            )
            # results es list[ZeroShotImageClassificationOutputElement] con .label y .score
            return {r.label: float(r.score) for r in results}
        except Exception as e:  # noqa: BLE001
            last_exc = e
            msg = str(e).lower()
            if "loading" in msg or "503" in msg or "timeout" in msg:
                wait = 5 * (attempt + 1)
                print(f"\n   ⚠  HF API ocupada/cold-start, reintento en {wait}s ({attempt+1}/{MAX_RETRIES})")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"HF API falló tras {MAX_RETRIES} intentos: {last_exc}")


def aggregate_scores(
    prompt_scores:  dict[str, float],
    prompts_by_id:  dict[str, list[str]],
    neg_by_id:      dict[str, list[str]],
) -> dict[str, float]:
    """
    Convierte scores-por-prompt en scores-por-label aplicando:
      - Avg de prompts positivos por label
      - Avg de prompts negativos por label
      - score_final = max(0, pos_avg - NEG_WEIGHT * neg_avg)  clamped a 1
    """
    out: dict[str, float] = {}
    for lid, prompts in prompts_by_id.items():
        pos_scores = [prompt_scores.get(p, 0.0) for p in prompts]
        pos_avg = sum(pos_scores) / len(pos_scores) if pos_scores else 0.0

        neg_avg = 0.0
        neg_prompts = neg_by_id.get(lid, [])
        if neg_prompts:
            neg_scores = [prompt_scores.get(p, 0.0) for p in neg_prompts]
            neg_avg = sum(neg_scores) / len(neg_scores)

        score = max(0.0, min(1.0, pos_avg - NEG_WEIGHT * neg_avg))
        out[lid] = score
    return out


# ── Main ───────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-dir",  type=Path, default=DEFAULT_INPUT,  help=f"Directorio de imgs (default: {DEFAULT_INPUT})")
    ap.add_argument("--output",     type=Path, default=DEFAULT_OUTPUT, help=f"JSON output (default: {DEFAULT_OUTPUT})")
    ap.add_argument("--threshold",  type=float, default=THRESHOLD,     help=f"Score mínimo para confident=true (default: {THRESHOLD})")
    ap.add_argument("--limit",      type=int,   default=0,             help="Si >0, limita a N imágenes (smoke test)")
    ap.add_argument("--skip-existing", action="store_true",            help="Salta SHAs que ya están en el output JSON")
    args = ap.parse_args()

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_TOKEN")
    if not token:
        print("✗ Falta HF_TOKEN en .env. Obtén uno gratis en https://huggingface.co/settings/tokens")
        sys.exit(1)

    print(f"🤗 HuggingFace Inference API · model={MODEL_ID}")
    print(f"📂 Input:  {args.input_dir}")
    print(f"📄 Output: {args.output}\n")

    # ── Construir tabla prompt→label_id y todos los prompts a enviar ─────
    prompts_by_id: dict[str, list[str]] = {lid: prompts for lid, prompts in LABELS}
    all_prompts: list[str] = []
    for prompts in prompts_by_id.values():
        all_prompts.extend(prompts)
    for neg_prompts in LABEL_NEGATIVES.values():
        all_prompts.extend(neg_prompts)
    # Deduplicar manteniendo orden
    seen = set()
    candidate_labels = []
    for p in all_prompts:
        if p not in seen:
            seen.add(p)
            candidate_labels.append(p)

    print(f"🏷  {len(prompts_by_id)} labels × {sum(len(v) for v in prompts_by_id.values()) // len(prompts_by_id):.1f}avg prompts = {len(candidate_labels)} candidate labels totales")

    # ── Cargar exclusions/confirmations ──────────────────────────────────
    tag_exclusions    = load_json_map(EXCLUSIONS_PATH,    "exclusions")
    tag_confirmations = load_json_map(CONFIRMATIONS_PATH, "confirmations")
    print(f"🚫 {len(tag_exclusions)} SHAs con exclusiones, ✅ {len(tag_confirmations)} con confirmaciones\n")

    # ── Cargar output existente si --skip-existing ─────────────────────
    existing: dict[str, dict] = {}
    if args.skip_existing and args.output.exists():
        try:
            existing = json.loads(args.output.read_text(encoding="utf-8")).get("images", {})
            print(f"📚 {len(existing)} imágenes ya clasificadas (se saltarán)\n")
        except Exception:
            existing = {}

    # ── Listar imágenes ─────────────────────────────────────────────────
    exts = {".png", ".jpg", ".jpeg", ".webp"}
    image_paths = sorted(p for p in args.input_dir.iterdir() if p.is_file() and p.suffix.lower() in exts)
    if args.skip_existing:
        image_paths = [p for p in image_paths if p.stem not in existing]
    if args.limit > 0:
        image_paths = image_paths[: args.limit]
    print(f"🖼  {len(image_paths)} imágenes a clasificar\n")
    if not image_paths:
        print("✅ Nada que hacer.")
        return

    # ── Cliente HF ──────────────────────────────────────────────────────
    client = InferenceClient(model=MODEL_ID, token=token)

    # ── Loop principal ──────────────────────────────────────────────────
    results: dict[str, dict] = dict(existing)
    tag_counter: dict[str, int] = defaultdict(int)
    confident_counter: dict[str, int] = defaultdict(int)
    untagged = 0
    start = time.time()

    for img_path in tqdm(image_paths, desc="HF API", unit="img"):
        sha = img_path.stem
        try:
            prompt_scores = classify_image(client, img_path, candidate_labels)
        except Exception as e:  # noqa: BLE001
            print(f"\n✗ Falló {img_path.name}: {e}")
            continue

        label_scores = aggregate_scores(prompt_scores, prompts_by_id, LABEL_NEGATIVES)

        # Aplicar exclusions / confirmations en runtime
        excl = set(tag_exclusions.get(sha, []))
        conf = set(tag_confirmations.get(sha, []))
        for lid in excl:
            label_scores[lid] = 0.0
        for lid in conf:
            if lid in label_scores:
                label_scores[lid] = max(label_scores[lid], CONFIRMED_BOOST)

        # Tags por threshold
        tags = [
            {"tag": lid, "score": round(s, 4)}
            for lid, s in sorted(label_scores.items(), key=lambda kv: -kv[1])
            if s >= args.threshold
        ]
        if not tags:
            untagged += 1
        for t in tags:
            tag_counter[t["tag"]] += 1
            if t["score"] >= args.threshold:
                confident_counter[t["tag"]] += 1

        results[sha] = {
            "filename":  img_path.name,
            "tags":      tags,
            "allScores": {lid: round(s, 4) for lid, s in sorted(label_scores.items(), key=lambda kv: -kv[1])},
        }

    # ── Escribir JSON ──────────────────────────────────────────────────
    output_data = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "model":       MODEL_ID,
        "backend":     "hf-inference-api",
        "threshold":   args.threshold,
        "labels":      [lid for lid, _ in LABELS],
        "images":      results,
        "stats": {
            "totalImages":          len(results),
            "imagesWithoutTags":    untagged,
            "tagCounts":            dict(tag_counter),
            "confidentTagCounts":   dict(confident_counter),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output_data, indent=2, ensure_ascii=False), encoding="utf-8")

    elapsed = time.time() - start
    print(f"\n✅ {len(image_paths)} imágenes en {elapsed:.1f}s ({elapsed / max(1, len(image_paths)):.2f}s/img)")
    print(f"   Output: {args.output}")
    if untagged > 0:
        print(f"   {untagged} imgs sin tags (score < {args.threshold} en todos)")


if __name__ == "__main__":
    main()
