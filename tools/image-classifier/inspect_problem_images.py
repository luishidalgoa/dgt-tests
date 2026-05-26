"""
Genera una galería HTML con las imágenes que el clasificador NO ha sabido
etiquetar bien, para iterar el vocabulario de LABELS.

Loop típico de iteración:
  1. python classify_siglip.py
  2. python inspect_problem_images.py
  3. Abrir tools/image-audit/problem-images.html en navegador
  4. Identificar patrones visuales que LABELS no cubre
  5. Editar LABELS en classify_siglip.py (añadir prompts nuevos)
  6. Borrar classification.json
  7. Volver a 1

Filtros (CLI flags):
  --no-tags        Solo imágenes sin NINGÚN tag (todos los scores < min_score)
  --no-confident   Imágenes sin tag confident (default — el caso más útil)
  --all-problems   Sin tags + sin confident, juntas
  --max N          Mostrar máximo N (default 500, ordenadas por peor score)

Por qué HTML local en vez de Streamlit / web app:
  - Sin servidor, sin dependencias extra.
  - Las imágenes se sirven directo del filesystem vía `file://` o relative.
  - Cualquier navegador moderno lo abre instantáneo.
  - Ctrl+F funciona para buscar SHAs en el doc.

Output: tools/image-audit/problem-images.html
"""

import argparse
import html
import json
import sys
from pathlib import Path

ROOT           = Path(__file__).resolve().parent.parent.parent
CLASSIFICATION = ROOT / "tools" / "image-audit" / "classification.json"
# Las imágenes únicas viven directamente en public/images/ (sin sub-carpeta
# sanitize/).
IMAGES_DIR     = ROOT / "public" / "images"
OUTPUT         = ROOT / "tools" / "image-audit" / "problem-images.html"


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Galería HTML de imágenes mal clasificadas")
    p.add_argument("--no-tags", action="store_true",
        help="Solo imágenes sin ningún tag (todos los scores < min_score)")
    p.add_argument("--no-confident", action="store_true",
        help="Imágenes sin tag confident (default)")
    p.add_argument("--all-problems", action="store_true",
        help="Cualquier imagen problemática (sin tags O sin confident)")
    p.add_argument("--max", type=int, default=500,
        help="Mostrar máximo N (default 500)")
    return p.parse_args()


def _filter_problems(images: dict, mode: str) -> list[tuple[str, dict]]:
    """mode in {'no_tags', 'no_confident', 'all_problems'}"""
    problems = []
    for sha, info in images.items():
        tags = info.get("tags", [])
        no_tags  = len(tags) == 0
        no_conf  = not any(t.get("confident") for t in tags)

        keep = False
        if   mode == "no_tags":      keep = no_tags
        elif mode == "no_confident": keep = no_conf
        elif mode == "all_problems": keep = no_tags or no_conf

        if keep:
            problems.append((sha, info))
    return problems


HTML_HEAD = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Problem Images — DGT Classifier</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a1a; color: #ddd; padding: 24px; margin: 0; }
  h1 { color: #fff; margin: 0 0 8px; font-size: 22px; }
  .header { background: #242424; padding: 16px 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #333; }
  .header p { margin: 4px 0; font-size: 13px; }
  .header code { background: #1a1a1a; padding: 2px 6px; border-radius: 3px; font-size: 12px; color: #fca5a5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
  .tile { background: #242424; border-radius: 8px; padding: 12px; border: 1px solid #333; transition: border-color 0.15s; }
  .tile:hover { border-color: #555; }
  .img-wrap { aspect-ratio: 1; background: #fff; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .img-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .img-wrap.missing { background: #3a1a1a; color: #fca5a5; font-size: 11px; }
  .sha { font-family: ui-monospace, monospace; font-size: 10.5px; color: #888; margin: 10px 0 6px; word-break: break-all; }
  .tags { font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
  .tag { display: flex; justify-content: space-between; padding: 3px 8px; border-radius: 3px; align-items: center; }
  .tag.confident      { background: rgba(34, 197, 94, 0.18); color: #4ade80; }
  .tag.notconfident   { background: rgba(150, 150, 150, 0.10); color: #999; }
  .tag.belowmin       { background: rgba(150, 150, 150, 0.05); color: #666; font-style: italic; }
  .score { font-family: ui-monospace, monospace; font-size: 11px; }
  .other-scores { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #444; }
  .other-scores .label { font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .filename { font-size: 10px; color: #666; margin-top: 6px; }
</style>
</head>
<body>
"""


def main() -> None:
    args = _parse_args()

    if not CLASSIFICATION.exists():
        print(f"❌ {CLASSIFICATION} no existe — corre primero `python classify_siglip.py`")
        sys.exit(1)

    data      = json.loads(CLASSIFICATION.read_text(encoding="utf-8"))
    threshold = data.get("threshold", 0.15)
    min_score = data.get("minScore", 0.05)

    # Decidir modo
    if args.no_tags:
        mode = "no_tags"
        label = "imágenes sin NINGÚN tag (todos los scores < min_score)"
    elif args.all_problems:
        mode = "all_problems"
        label = "imágenes sin tags O sin tag confident"
    else:
        # default
        mode  = "no_confident"
        label = "imágenes sin tag confident"

    problems = _filter_problems(data["images"], mode)

    # Ordenar por max score ascendiente (peores arriba — más informativas
    # para entender qué tipo de imagen el modelo no entiende)
    problems.sort(key=lambda x: max(
        (t["score"] for t in x[1].get("tags", [])),
        default=0.0,
    ))

    total_problem  = len(problems)
    showing        = problems[:args.max]

    print(f"🔍 Filtro: {label}")
    print(f"   Total problemáticas: {total_problem}")
    print(f"   Mostrando:           {len(showing)} (max={args.max})")

    # ── Construir HTML ──────────────────────────────────────────────────
    parts: list[str] = [HTML_HEAD]

    parts.append('<div class="header">')
    parts.append(f'<h1>🔍 Problem Images — {html.escape(label)}</h1>')
    parts.append(f'<p>Mostrando <code>{len(showing)}</code> de <code>{total_problem}</code> problemáticas '
                 f'(de <code>{data.get("imagesProcessed", "?")}</code> totales clasificadas).</p>')
    parts.append(f'<p>Threshold confident: <code>{threshold}</code> · '
                 f'Min score: <code>{min_score}</code> · '
                 f'Modelo: <code>{html.escape(data.get("model", "?"))}</code></p>')
    parts.append(f'<p style="font-size:12px; color:#888;">Ordenadas por score top ASCENDIENTE — las peores arriba. '
                 f'Verde = tag confident · Gris = tag low-confidence · Discontinuo = top-3 de allScores debajo de min_score.</p>')
    parts.append('</div>')

    parts.append('<div class="grid">')

    # Set de labels emitidos en `tags` para no duplicar en "other-scores"
    for sha, info in showing:
        filename = info["filename"]
        # path relativo desde tools/image-audit/problem-images.html
        img_src  = f"../../public/images/{filename}"
        img_disk = IMAGES_DIR / filename
        exists   = img_disk.exists()

        parts.append('<div class="tile">')

        if exists:
            parts.append(f'<div class="img-wrap"><img src="{html.escape(img_src)}" loading="lazy" alt="{sha[:8]}"></div>')
        else:
            parts.append('<div class="img-wrap missing">archivo no encontrado en public/images/</div>')

        parts.append(f'<div class="sha">{html.escape(sha[:16])}…</div>')

        parts.append('<div class="tags">')
        tags = info.get("tags", [])
        if not tags:
            parts.append('<div class="tag belowmin"><em>(sin tags — todos los scores debajo de min_score)</em></div>')
        else:
            for t in tags:
                cls = "confident" if t.get("confident") else "notconfident"
                parts.append(
                    f'<div class="tag {cls}">'
                    f'<span>{html.escape(t["tag"])}</span>'
                    f'<span class="score">{t["score"]:.3f}</span>'
                    f'</div>'
                )

        # Top-3 de allScores que no estén ya en tags (incluso si <min_score).
        # Útil para entender qué labels SÍ son "casi-detectados" — pista para
        # iterar prompts.
        all_scores = info.get("allScores", {})
        shown_tags = {t["tag"] for t in tags}
        extras = sorted(
            ((lid, s) for lid, s in all_scores.items() if lid not in shown_tags),
            key=lambda x: -x[1],
        )[:3]

        if extras:
            parts.append('<div class="other-scores">')
            parts.append('<div class="label">top-3 otros scores:</div>')
            for lid, s in extras:
                parts.append(
                    f'<div class="tag belowmin">'
                    f'<span>{html.escape(lid)}</span>'
                    f'<span class="score">{s:.3f}</span>'
                    f'</div>'
                )
            parts.append('</div>')

        parts.append(f'<div class="filename">{html.escape(filename)}</div>')
        parts.append('</div>')

    parts.append('</div>')
    parts.append('</body></html>')

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("".join(parts), encoding="utf-8")

    print(f"\n✅ Galería: {OUTPUT}")
    print(f"   Abrir en navegador: file:///{OUTPUT.as_posix()}")
    print(f"\n💡 Cómo iterar:")
    print(f"   1. Abre el HTML, fíjate en patrones de imágenes mal clasificadas")
    print(f"   2. Mira los 'top-3 otros scores' — pistas de qué labels CASI-detectó")
    print(f"   3. Edita LABELS en classify_siglip.py (refina prompts o añade categorías)")
    print(f"   4. Borra classification.json y vuelve a correr classify_siglip.py")


if __name__ == "__main__":
    main()
