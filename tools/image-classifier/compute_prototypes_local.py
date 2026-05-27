"""
Cómputo LOCAL de prototipos kNN para Fase C — equivalente a `modal_app.py
compute_prototypes` pero corriendo en el venv local (sin Modal).

Pipeline:
  1. Lee tag_confirmations.json + tag_exclusions.json + prototypes.json
     DIRECTAMENTE de R2 (siempre fresh — no del filesystem que puede
     estar desfasado).
  2. Identifica targets nuevos: (sha, label, sign) presentes en feedback
     pero todavía no en prototypes.json.
  3. Carga las imgs de `public/images/{sha}.*` del filesystem local
     (asume que ya hiciste `npm run images:download-r2`). Skip las que
     no existan.
  4. Carga SigLIP local (mismo modelo que classify_siglip.py — comparte
     cache HF en ~/.cache/huggingface).
  5. Computa embeddings en batches, los normaliza L2.
  6. Persiste el resultado:
     - SIEMPRE: copia local en `tools/image-audit/prototypes.json`
     - POR DEFAULT: sube a R2 (`meta/prototypes.json`) — flag --no-upload
       para evitar.

Cuándo usar este vs `modal_app.py compute_prototypes`:
  - Local (este script):  rápido para incrementales pequeños (<100 protos),
    sin necesidad de Modal, usa tu venv ya configurado.
  - Modal:  mejor para batches grandes (1000+) por la GPU; o si no quieres
    descargar imgs en local.

Uso:
  python compute_prototypes_local.py            # incremental por defecto
  python compute_prototypes_local.py --force    # recomputa TODO desde cero
  python compute_prototypes_local.py --no-upload  # solo local, no R2
  python compute_prototypes_local.py --only-label moped
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import torch
from PIL import Image
from tqdm import tqdm
from transformers import AutoModel, AutoProcessor

try:
    import boto3
except ImportError:
    print("❌ boto3 no instalado. Corre: npm run images:setup-classifier")
    sys.exit(1)


# ── Constantes ──────────────────────────────────────────────────────────
ROOT             = Path(__file__).resolve().parents[2]
IMAGES_DIR       = ROOT / "public" / "images"
PROTOTYPES_PATH  = ROOT / "tools" / "image-audit" / "prototypes.json"
MODEL_ID         = "google/siglip-base-patch16-256"
KNN_MIN_PROTOS   = 3  # solo info — no afecta cómputo, sí filtrado en classifier
BATCH            = 16


# ── Env loading ─────────────────────────────────────────────────────────
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
def _r2_client():
    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket     = os.environ.get("R2_BUCKET_NAME")
    if not all([account_id, access_key, secret_key, bucket]):
        print("❌ Faltan credenciales R2 en .env / .env.local")
        sys.exit(1)
    s3 = boto3.client(
        "s3",
        endpoint_url          = f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id     = access_key,
        aws_secret_access_key = secret_key,
        region_name           = "auto",
    )
    return s3, bucket


def _r2_get_meta(s3, bucket: str, key: str) -> Optional[dict]:
    try:
        r = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(r["Body"].read())
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as e:  # noqa: BLE001
        print(f"⚠  failed to read {key}: {e}")
        return None


def _r2_put_meta(s3, bucket: str, key: str, data: dict) -> None:
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    s3.put_object(
        Bucket       = bucket,
        Key          = key,
        Body         = body,
        ContentType  = "application/json; charset=utf-8",
        CacheControl = "no-cache",
    )


# ── Image loading ───────────────────────────────────────────────────────
def _find_local_image(sha: str) -> Optional[Path]:
    """Busca public/images/{sha}.{png,jpg,jpeg,webp}. None si no existe."""
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        p = IMAGES_DIR / f"{sha}{ext}"
        if p.exists() and p.is_file():
            return p
    return None


# ── Main ────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Compute prototype embeddings locally")
    parser.add_argument("--force", action="store_true",
                        help="Recomputa TODOS los prototipos, ignorando el JSON existente.")
    parser.add_argument("--only-label", type=str, default=None,
                        help="Solo computar prototipos para ese label.")
    parser.add_argument("--no-upload", action="store_true",
                        help="No sube el resultado a R2 (solo guarda local).")
    args = parser.parse_args()

    print(f"🧬 Compute prototypes LOCAL (sin Modal)")
    print(f"   model:       {MODEL_ID}")
    print(f"   images dir:  {IMAGES_DIR}")
    print(f"   force:       {args.force}")
    print(f"   only_label:  {args.only_label or 'all'}")
    print(f"   upload R2:   {'no' if args.no_upload else 'yes'}\n")

    s3, bucket = _r2_client()

    # Si IMAGES_DIR no existe o está vacío, auto-descargar de R2 — evita
    # tener que correr manualmente `npm run images:download-r2`.
    if not IMAGES_DIR.exists() or not any(IMAGES_DIR.iterdir()):
        print(f"📂 {IMAGES_DIR} no existe o está vacío — auto-descargando imgs de R2...")
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        all_keys: list[str] = []
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket):
            for obj in page.get("Contents", []):
                k = obj["Key"]
                if k.startswith("meta/"):
                    continue
                ext = k.rsplit(".", 1)[-1].lower() if "." in k else ""
                if ext in ("png", "jpg", "jpeg", "webp"):
                    all_keys.append(k)
        print(f"   {len(all_keys)} imgs en R2 — descargando (paralelo)...")
        from concurrent.futures import ThreadPoolExecutor
        def _dl(k: str) -> str:
            local = IMAGES_DIR / k.replace("/", "_")
            if local.exists() and local.stat().st_size > 0:
                return "skipped"
            try:
                s3.download_file(bucket, k, str(local))
                return "ok"
            except Exception as e:  # noqa: BLE001
                print(f"   ⚠  falló {k}: {e}")
                return "failed"
        pool = ThreadPoolExecutor(max_workers=24)
        results = list(pool.map(_dl, all_keys))
        pool.shutdown()
        print(f"   ✅ {results.count('ok')} descargadas, {results.count('skipped')} ya estaban, {results.count('failed')} fallaron\n")

    # ── 1. Read feedback + existing prototypes from R2 ──────────────────
    confs    = _r2_get_meta(s3, bucket, "meta/tag_confirmations.json")
    excls    = _r2_get_meta(s3, bucket, "meta/tag_exclusions.json")
    existing = _r2_get_meta(s3, bucket, "meta/prototypes.json")

    conf_map: dict[str, list[str]] = (confs or {}).get("confirmations", {})
    excl_map: dict[str, list[str]] = (excls or {}).get("exclusions", {})

    existing_protos: dict[str, dict] = {}
    if not args.force and existing and isinstance(existing.get("prototypes"), dict):
        existing_protos = existing["prototypes"]
        n_old_pos = sum(len(d.get("positive", [])) for d in existing_protos.values() if isinstance(d, dict))
        n_old_neg = sum(len(d.get("negative", [])) for d in existing_protos.values() if isinstance(d, dict))
        print(f"[protos] {n_old_pos} positivos + {n_old_neg} negativos ya en R2 (incremental)\n")

    # ── 2. Identify NEW (sha, lid, sign) targets ────────────────────────
    existing_keys: set[tuple[str, str, str]] = set()
    if not args.force:
        for lid, data in existing_protos.items():
            if not isinstance(data, dict):
                continue
            for sign in ("positive", "negative"):
                for it in data.get(sign, []):
                    if isinstance(it, dict) and "sha" in it:
                        existing_keys.add((it["sha"], lid, sign))

    targets: list[tuple[str, str, str]] = []
    for sha, tags in conf_map.items():
        if not isinstance(tags, list):
            continue
        for lid in tags:
            if args.only_label and lid != args.only_label:
                continue
            if (sha, lid, "positive") in existing_keys:
                continue
            targets.append((sha, lid, "positive"))
    for sha, tags in excl_map.items():
        if not isinstance(tags, list):
            continue
        for lid in tags:
            if args.only_label and lid != args.only_label:
                continue
            if (sha, lid, "negative") in existing_keys:
                continue
            targets.append((sha, lid, "negative"))

    print(f"[protos] {len(targets)} nuevos prototipos a computar"
          f"{' (filter: ' + args.only_label + ')' if args.only_label else ''}")
    if not targets:
        print("[protos] todos los prototipos ya están en R2 — nada que hacer")
        return

    # Group by sha (una imagen puede ser proto para múltiples labels)
    sha_to_tasks: dict[str, list[tuple[str, str]]] = {}
    for sha, lid, sign in targets:
        sha_to_tasks.setdefault(sha, []).append((lid, sign))

    # ── 3. Validate that imgs exist locally ─────────────────────────────
    sha_to_path: dict[str, Path] = {}
    missing: list[str] = []
    for sha in sha_to_tasks:
        p = _find_local_image(sha)
        if p is None:
            missing.append(sha)
        else:
            sha_to_path[sha] = p
    if missing:
        print(f"⚠  {len(missing)} SHAs en feedback pero NO en public/images/ — skip")
        print(f"   (corre `npm run images:download-r2` si faltan binarios)")
    print(f"[protos] {len(sha_to_path)} imgs encontradas localmente, {len(missing)} faltan\n")

    if not sha_to_path:
        print("❌ No hay imágenes locales para procesar — aborto")
        sys.exit(1)

    # ── 4. Load SigLIP + compute embeddings in batches ──────────────────
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"⚙  device: {device}")
    print(f"📥 cargando {MODEL_ID}...")
    processor = AutoProcessor.from_pretrained(MODEL_ID, use_fast=True)
    model     = AutoModel.from_pretrained(MODEL_ID).to(device).eval()
    print(f"   listo\n")

    # Build dict de output (start con existing si no es force)
    if args.force:
        protos_out: dict[str, dict] = {}
    else:
        protos_out = {
            lid: {
                "positive": list(d.get("positive", [])),
                "negative": list(d.get("negative", [])),
            }
            for lid, d in existing_protos.items()
        }

    items = list(sha_to_path.items())
    pbar  = tqdm(range(0, len(items), BATCH), desc="Embedding batches", unit="batch")
    new_count = 0
    for batch_start in pbar:
        batch = items[batch_start : batch_start + BATCH]
        images: list = []
        valid_shas: list[str] = []
        for sha, path in batch:
            try:
                images.append(Image.open(path).convert("RGB"))
                valid_shas.append(sha)
            except Exception as e:  # noqa: BLE001
                print(f"\n⚠  no pude abrir {path.name}: {e}")
        if not images:
            continue

        with torch.no_grad():
            inputs     = processor(images=images, return_tensors="pt").to(device)
            img_embeds = model.get_image_features(**inputs)
            img_embeds = img_embeds / img_embeds.norm(dim=-1, keepdim=True)

        embs = img_embeds.cpu().tolist()
        for sha, emb in zip(valid_shas, embs):
            for lid, sign in sha_to_tasks.get(sha, []):
                bucket_dict = protos_out.setdefault(lid, {"positive": [], "negative": []})
                # Idempotente: skip si ya existe (entre el filtro inicial y aquí)
                if any(it.get("sha") == sha for it in bucket_dict.get(sign, [])):
                    continue
                # Redondeo a 5 decimales — mismo que modal_app para coherencia
                bucket_dict[sign].append({
                    "sha":       sha,
                    "embedding": [round(float(x), 5) for x in emb],
                })
                new_count += 1

    # ── 5. Build payload ────────────────────────────────────────────────
    n_labels = len(protos_out)
    n_pos    = sum(len(d.get("positive", [])) for d in protos_out.values())
    n_neg    = sum(len(d.get("negative", [])) for d in protos_out.values())
    payload = {
        "generatedAt":  datetime.now(timezone.utc).isoformat(),
        "model":        MODEL_ID,
        "embeddingDim": 768,
        "knnConfig": {
            "minProtos": KNN_MIN_PROTOS,
            "note":      "minProtos here is informational only — actual threshold lives in classify_siglip.py and modal_app.py",
        },
        "stats": {
            "totalLabels":         n_labels,
            "totalPositiveProtos": n_pos,
            "totalNegativeProtos": n_neg,
        },
        "prototypes": protos_out,
    }

    # ── 6. Persist locally ──────────────────────────────────────────────
    PROTOTYPES_PATH.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    PROTOTYPES_PATH.write_bytes(body)
    print(f"\n💾 local copy → {PROTOTYPES_PATH} ({len(body) / 1024:.1f} KB)")

    # ── 7. Optionally upload to R2 ──────────────────────────────────────
    if not args.no_upload:
        try:
            _r2_put_meta(s3, bucket, "meta/prototypes.json", payload)
            print(f"💾 meta/prototypes.json subido a R2")
        except Exception as e:  # noqa: BLE001
            print(f"⚠  upload a R2 falló (la copia local SÍ se guardó): {e}")

    print(f"\n✅ done — {n_labels} labels, {n_pos} positivos + {n_neg} negativos ({new_count} nuevos este run)")


if __name__ == "__main__":
    main()
