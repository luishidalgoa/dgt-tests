"""
Reverse Image Search vía Bing Visual Search API.

Para cada imagen en `public/images/sanitize/`, busca N candidatos visualmente
similares con Bing y los descarga a `public/images/candidates/`. Cada
candidato se guarda con SU PROPIO SHA-256 como filename — así dos orígenes
que encuentren el mismo candidato lo dedupean automáticamente.

Es el cuarto paso del pipeline de banco de imágenes propio:

    sanitize    →   classify_siglip   →  find_replacements  →  classify_siglip
    (1748 únicos)   (tags de viejos)     (cada uno → N cands)  (tags de cands)

El mapeo source → candidatos se conserva en `tools/image-audit/candidates.json`.

Por qué Bing y no Google:
  - Google retiró la API pública de reverse image search en 2017. Solo
    queda Google Lens (móvil) o scrapers de terceros (SerpAPI, $$$).
  - Bing Visual Search API sigue activa vía Azure AI Services. Free
    tier 1000/mes, paid tier ~$3 por 1000 → $5-6 para nuestros 1748.
  - Misma calidad: ambos usan embedding visual + nearest-neighbor sobre
    un índice masivo de la web.

Setup (una vez):
  1. portal.azure.com → "Create resource" → busca "Bing Search v7"
  2. Crea recurso (tier F1 free 1000/mes o S1 paid).
  3. En "Keys and Endpoint" del recurso, copia "Key 1".
  4. Exporta como env var:
     - Windows PowerShell:  $env:BING_SEARCH_API_KEY="..."
     - Linux/macOS:         export BING_SEARCH_API_KEY=...

Uso:
  python find_replacements.py
  python find_replacements.py --candidates-per-image 5 --limit 10
  python find_replacements.py --dry-run    # no descarga, solo loguea

Si Bing te da problemas (deprecación, quota, lo que sea), las alternativas
buenas son:
  - SerpAPI Google Reverse Image Search ($50/mes, ~5k queries)
  - Playwright + Bing en headless (gratis pero frágil, riesgo de ban)
  - TinEye API (focused, ~$200/mes para volumen normal)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiohttp

# ── Config ──────────────────────────────────────────────────────────────
ROOT          = Path(__file__).resolve().parent.parent.parent
INPUT_DIR     = ROOT / "public" / "images" / "sanitize"
OUTPUT_DIR    = ROOT / "public" / "images" / "candidates"
METADATA_PATH = ROOT / "tools" / "image-audit" / "candidates.json"

BING_API = "https://api.bing.microsoft.com/v7.0/images/visualsearch"

# Free tier: 3 TPS. Paid S1+: 7 TPS. Dejamos margen para no chocar.
BING_REQUEST_DELAY_SECS = 1.1

# Filtros de los candidatos descargados (descartar basura y thumbs).
MIN_BYTES    = 5 * 1024          # 5 KB
MAX_BYTES    = 8 * 1024 * 1024   # 8 MB
ALLOWED_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp", "image/gif")

# UA que parece browser — algunos hosts rechazan defaults de aiohttp.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# Concurrencia de DESCARGAS (no del API de Bing — ese va en serie con delay).
DOWNLOAD_CONCURRENCY = 8

# Tamaño máximo de imagen para subir a Bing. Su limit oficial es 1 MB; las
# nuestras suelen ser < 100 KB pero por si acaso truncamos.
MAX_UPLOAD_BYTES = 1 * 1024 * 1024


# ── Tipos ───────────────────────────────────────────────────────────────
class CandidateInfo:
    """Info de un candidato descargado para guardar en metadata."""
    def __init__(self, sha: str, url: str, content_type: str, size: int, rank: int):
        self.sha          = sha
        self.url          = url
        self.content_type = content_type
        self.size         = size
        self.rank         = rank

    def to_dict(self) -> dict:
        return {
            "sha":         self.sha,
            "url":         self.url,
            "contentType": self.content_type,
            "size":        self.size,
            "rank":        self.rank,
        }


# ── Helpers ─────────────────────────────────────────────────────────────

def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ext_from_content_type(ct: str) -> str:
    ct = ct.lower().split(";")[0].strip()
    if "png"  in ct: return ".png"
    if "webp" in ct: return ".webp"
    if "gif"  in ct: return ".gif"
    return ".jpg"


def collect_source_images(directory: Path) -> list[Path]:
    extensions = {".png", ".jpg", ".jpeg", ".webp"}
    return sorted(
        p for p in directory.iterdir()
        if p.is_file() and p.suffix.lower() in extensions
    )


def load_metadata() -> dict[str, Any]:
    """Carga `candidates.json` si existe, para resume."""
    if METADATA_PATH.exists():
        try:
            return json.loads(METADATA_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            print(f"⚠  {METADATA_PATH} corrupto, empezando de cero")
    return {
        "generatedAt":    None,
        "candidatesDir":  str(OUTPUT_DIR),
        "sources":        {},   # source_sha → [CandidateInfo dicts]
    }


def save_metadata(metadata: dict[str, Any]) -> None:
    metadata["generatedAt"] = datetime.now(timezone.utc).isoformat()
    METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    METADATA_PATH.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ── Bing API ────────────────────────────────────────────────────────────

async def bing_visual_search(
    session:    aiohttp.ClientSession,
    api_key:    str,
    image_bytes: bytes,
) -> list[dict[str, Any]]:
    """POST imagen a Bing → devuelve lista de visually-similar (dicts crudos).

    Cada dict tiene `contentUrl`, `thumbnailUrl`, `hostPageUrl`, `name`,
    `width`, `height`, `encodingFormat`. Nosotros nos quedaremos con
    `contentUrl` (= URL del archivo original).
    """
    # Truncar si fuese demasiado grande (no debería en nuestro caso).
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        image_bytes = image_bytes[:MAX_UPLOAD_BYTES]

    form = aiohttp.FormData()
    form.add_field("image", image_bytes, filename="image.jpg", content_type="image/jpeg")

    async with session.post(
        BING_API,
        headers={"Ocp-Apim-Subscription-Key": api_key},
        data=form,
        timeout=aiohttp.ClientTimeout(total=30),
    ) as r:
        if r.status == 429:
            raise RuntimeError("Bing rate limit (429). Sube REQUEST_DELAY.")
        if r.status == 401:
            raise RuntimeError("Bing 401 — API key inválida o sin permisos.")
        r.raise_for_status()
        payload = await r.json()

    # Estructura: payload.tags[*].actions[?actionType=='VisualSearch'].data.value
    candidates: list[dict[str, Any]] = []
    for tag in payload.get("tags", []):
        for action in tag.get("actions", []):
            if action.get("actionType") == "VisualSearch":
                values = action.get("data", {}).get("value", [])
                candidates.extend(values)
    return candidates


# ── Download ────────────────────────────────────────────────────────────

async def download_image(
    session: aiohttp.ClientSession,
    url:     str,
) -> Optional[tuple[bytes, str]]:
    """Descarga un candidato. Devuelve (bytes, content_type) o None si falla.

    Aplica filtros: status 200, content-type image/*, tamaño en rango.
    """
    try:
        # HEAD primero para descartar baratos antes de bajar bytes.
        # Algunos hosts no soportan HEAD bien — si falla, intentamos GET
        # directo. La penalización de bajar basura es ~100KB perdidos.
        try:
            async with session.head(
                url,
                headers={"User-Agent": USER_AGENT},
                timeout=aiohttp.ClientTimeout(total=10),
                allow_redirects=True,
            ) as head:
                if head.status != 200:
                    return None
                ct = (head.headers.get("Content-Type") or "").lower()
                cl_raw = head.headers.get("Content-Length")
                cl = int(cl_raw) if cl_raw and cl_raw.isdigit() else None
                if ct and not any(allowed in ct for allowed in ALLOWED_CONTENT_TYPES):
                    return None
                if cl is not None and (cl < MIN_BYTES or cl > MAX_BYTES):
                    return None
        except (aiohttp.ClientError, asyncio.TimeoutError):
            pass  # HEAD failed — intentaremos GET de todas formas

        async with session.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=aiohttp.ClientTimeout(total=25),
            allow_redirects=True,
        ) as r:
            if r.status != 200:
                return None
            ct = (r.headers.get("Content-Type") or "").lower().split(";")[0].strip()
            if not any(ct == allowed for allowed in ALLOWED_CONTENT_TYPES):
                return None
            data = await r.read()
            if len(data) < MIN_BYTES or len(data) > MAX_BYTES:
                return None
            return data, ct
    except (aiohttp.ClientError, asyncio.TimeoutError, UnicodeError):
        return None


# ── Lógica principal ────────────────────────────────────────────────────

async def process_source(
    session:               aiohttp.ClientSession,
    api_key:               str,
    source_path:           Path,
    source_sha:            str,
    candidates_per_image:  int,
    download_sem:          asyncio.Semaphore,
    output_dir:            Path,
    dry_run:               bool,
) -> list[CandidateInfo]:
    """Procesa UNA imagen origen: búsqueda Bing + descarga de candidatos."""
    image_bytes = source_path.read_bytes()

    try:
        results = await bing_visual_search(session, api_key, image_bytes)
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠  Bing falló para {source_sha[:8]}: {e}")
        return []

    if not results:
        print(f"  ⚠  Bing no devolvió candidatos para {source_sha[:8]}")
        return []

    # Limitamos a los top-K antes de bajar (no malgastar requests).
    top = results[:candidates_per_image * 2]  # margin para fallos de descarga

    if dry_run:
        print(f"  [dry-run] {source_sha[:8]}: Bing → {len(results)} sims, " +
              f"top {len(top)} URLs:")
        for i, c in enumerate(top[:candidates_per_image]):
            print(f"    {i + 1}. {c.get('contentUrl', '?')}")
        return []

    # Descargas en paralelo (con límite global de concurrencia).
    async def _do_download(rank: int, item: dict) -> Optional[CandidateInfo]:
        url = item.get("contentUrl")
        if not url:
            return None
        async with download_sem:
            result = await download_image(session, url)
            if not result:
                return None
            data, content_type = result
            sha = sha256_hex(data)
            ext = ext_from_content_type(content_type)
            target_path = output_dir / f"{sha}{ext}"
            if not target_path.exists():
                target_path.write_bytes(data)
            return CandidateInfo(
                sha=sha,
                url=url,
                content_type=content_type,
                size=len(data),
                rank=rank,
            )

    download_tasks = [_do_download(i + 1, item) for i, item in enumerate(top)]
    downloaded = await asyncio.gather(*download_tasks)
    kept = [c for c in downloaded if c is not None][:candidates_per_image]
    return kept


async def main_async(args: argparse.Namespace) -> None:
    api_key = os.environ.get("BING_SEARCH_API_KEY", "").strip()
    if not api_key and not args.dry_run:
        print("❌ Falta BING_SEARCH_API_KEY")
        print("   Setup:")
        print("     Windows PowerShell:  $env:BING_SEARCH_API_KEY=\"...\"")
        print("     Linux/macOS:         export BING_SEARCH_API_KEY=...")
        print("   Obtener key:")
        print("     portal.azure.com → Create resource → 'Bing Search v7' → Keys")
        sys.exit(1)

    if not INPUT_DIR.exists():
        print(f"❌ {INPUT_DIR} no existe. Corre primero: npm run images:sanitize")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)

    sources = collect_source_images(INPUT_DIR)
    if args.limit:
        sources = sources[:args.limit]

    metadata = load_metadata()
    already_done = set(metadata["sources"].keys())
    pending = [p for p in sources if p.stem not in already_done]

    print(f"🔍 Bing Visual Search reverse image lookup")
    print(f"   Input:           {INPUT_DIR}")
    print(f"   Output:          {OUTPUT_DIR}")
    print(f"   Metadata:        {METADATA_PATH}")
    print(f"   Candidatos/img:  {args.candidates_per_image}")
    print(f"   Dry-run:         {args.dry_run}")
    print()
    print(f"📷 Total: {len(sources)} imágenes ({len(already_done)} ya hechas, {len(pending)} pendientes)")

    if not pending:
        print("✅ Todas las imágenes ya tienen candidatos. Borra candidates.json si quieres re-correr.")
        return

    # Bing TPS limit → llamadas secuenciales con delay.
    # Las descargas dentro de cada origen sí van en paralelo (DOWNLOAD_CONCURRENCY).
    download_sem = asyncio.Semaphore(DOWNLOAD_CONCURRENCY)
    timeout_session = aiohttp.ClientTimeout(total=60)

    total_candidates = 0
    failed_sources   = 0
    start_time       = time.time()

    async with aiohttp.ClientSession(timeout=timeout_session) as session:
        for i, source_path in enumerate(pending, start=1):
            source_sha = source_path.stem
            t0 = time.time()

            candidates = await process_source(
                session=              session,
                api_key=              api_key,
                source_path=          source_path,
                source_sha=           source_sha,
                candidates_per_image= args.candidates_per_image,
                download_sem=         download_sem,
                output_dir=           OUTPUT_DIR,
                dry_run=              args.dry_run,
            )

            elapsed = time.time() - t0
            total_candidates += len(candidates)
            if not candidates and not args.dry_run:
                failed_sources += 1

            print(f"  [{i:>4}/{len(pending)}] {source_sha[:8]}... → {len(candidates)} candidatos ({elapsed:.1f}s)")

            if not args.dry_run:
                metadata["sources"][source_sha] = [c.to_dict() for c in candidates]

            # Checkpoint cada 20 sources para no perder progreso si interrumpes.
            if i % 20 == 0 and not args.dry_run:
                save_metadata(metadata)

            # Respeta TPS de Bing entre llamadas
            await asyncio.sleep(BING_REQUEST_DELAY_SECS)

    elapsed_total = time.time() - start_time

    # Save final
    if not args.dry_run:
        save_metadata(metadata)

    print(f"\n✅ Completado en {elapsed_total / 60:.1f} min")
    print(f"   Sources procesados:  {len(pending)}")
    print(f"   Sin candidatos:      {failed_sources}")
    print(f"   Candidatos totales:  {total_candidates}")
    if not args.dry_run:
        print(f"   Carpeta:             {OUTPUT_DIR}")
        print(f"   Metadata:            {METADATA_PATH}")
        print(f"\n📌 Próximo paso: clasificar los candidatos con SigLIP:")
        print(f"   python classify_siglip.py --input-dir {OUTPUT_DIR} \\")
        print(f"     --output {METADATA_PATH.parent}/classification-candidates.json")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Reverse image search vía Bing Visual Search API")
    p.add_argument(
        "--candidates-per-image", type=int, default=5,
        help="Cuántos candidatos descargar por imagen origen (default 5)",
    )
    p.add_argument(
        "--limit", type=int, default=None,
        help="Procesar solo las primeras N (útil para tests). Default: todas",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Hace búsquedas Bing pero NO descarga; solo imprime URLs",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\n⚠  Cancelado. Lo guardado hasta el último checkpoint sigue ahí.")
        sys.exit(130)
