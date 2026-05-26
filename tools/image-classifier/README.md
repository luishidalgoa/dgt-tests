# Image classifier — SigLIP multi-label

Tercer paso del pipeline de banco de imágenes propio. Toma las imágenes
sanitizadas en `public/images/sanitize/` (una por SHA-256 único) y les
asigna **múltiples etiquetas** vía SigLIP (modelo zero-shot de Google,
abierto, evolución de CLIP).

Vive aquí en `tools/image-classifier/` para mantener el ecosistema Python
fuera del codebase Next.js. El output se escribe en
`tools/image-audit/classification.json`, donde también vive `sha-audit.json`.

## Por qué SigLIP y no TensorFlow puro

- **TF puro (MobileNet/EfficientNet sobre ImageNet)**: clases fijas y
  poco relevantes para nuestro dominio ("perro labrador", "señal de stop
  genérica"). No entiende "señal vertical de obligación" o "intersección
  urbana con paso de peatones".
- **SigLIP**: zero-shot multi-label. Le pasas las etiquetas que tú
  decidas como texto en lenguaje natural y devuelve un score sigmoid
  independiente por cada una. Umbralas y tienes tu multi-label. Sin
  fine-tuning, sin dataset, sin GPU.

Si en el futuro queremos algo TF-puro entrenado a medida sobre nuestro
dominio, se podrá hacer. Por ahora SigLIP es el atajo correcto.

## Setup (una sola vez)

Necesitas Python 3.10+ instalado. Comprueba con:

```bash
python --version
```

Crea un entorno virtual aislado y entra:

```bash
# Desde la raíz del repo
cd tools/image-classifier

python -m venv .venv

# Windows (PowerShell):
.venv\Scripts\activate

# Windows (cmd.exe):
.venv\Scripts\activate.bat

# macOS / Linux:
source .venv/bin/activate
```

Verás `(.venv)` al principio del prompt cuando esté activo.

### Instalar dependencias

**Windows o cualquier máquina SIN GPU NVIDIA** (= prácticamente todos los
portátiles, incluido tu Surface con Iris Xe):

```bash
# 1. PyTorch CPU + torchvision (mismo index para que las versiones
#    binarias coincidan; SigLIP necesita torchvision para el image
#    processor rápido)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# 2. Resto de dependencias
pip install -r requirements.txt
```

**Con GPU NVIDIA + CUDA** (no es tu caso):

```bash
pip install -r requirements.txt
```

La primera vez también descargará el modelo (~370 MB) desde Hugging Face
al ejecutar. Eso ya es one-shot — luego va de cache local.

## Uso

Con el venv activo:

```bash
python classify_siglip.py
```

Verás algo como:

```
🔍 SigLIP multi-label classifier
   Input:  C:\...\public\images\sanitize
   Output: C:\...\tools\image-audit\classification.json
   Model:  google/siglip-base-patch16-256
   Batch:  16
   Threshold: 0.5

📷 1748 imágenes a clasificar
➡  1748 pendientes

⚙  Device: cpu
📥 Cargando google/siglip-base-patch16-256 (~370 MB primera vez)...
   listo en 8.4s

Clasificando: 100%|█████████████████████████████████| 110/110 [32:14<00:00]
✅ 1748 clasificadas en 1934.5s (1107 ms/img)

📊 Estadísticas:
   Imágenes clasificadas:   1748
   Sin tags (umbral no superado): 47
   Tags totales:            5293
   Tags por imagen (media): 3.03

📊 Top tags:
    892 ( 51.0%)  car
    643 ( 36.8%)  urban_street
    412 ( 23.6%)  intersection
    ...

💾 Output: C:\...\tools\image-audit\classification.json
```

Tiempo aproximado en CPU (Surface Laptop con Iris Xe): **30-45 minutos**
para las 1748 imágenes. El script guarda checkpoint cada 200 imágenes
así que si lo cancelas y vuelves a correrlo continúa donde lo dejó.

## Personalizar las etiquetas

Edita `LABELS` en `classify_siglip.py`. Es una lista de tuplas
`(id, prompt)`:

```python
LABELS = [
    ("car",                 "a car or passenger automobile"),
    ("urban_street",        "an urban street with buildings nearby"),
    # Añade lo que necesites:
    ("school_zone",         "a school zone with children or school crossing signs"),
    ("toll_booth",          "a highway toll booth"),
    ...
]
```

Después borra `tools/image-audit/classification.json` y vuelve a correr —
el script no puede saber si re-clasificar lo viejo o no, así que mejor
empezar de cero cuando cambies el vocabulario.

## Ajustar umbral

`THRESHOLD = 0.5` por defecto. Sube a 0.6/0.7 para tags más estrictos
(menos falsos positivos pero más imágenes sin tags). Baja a 0.3/0.4 para
tags más permisivos (más cobertura pero más ruido).

Como el script guarda `allScores` (todos los scores por imagen, incluso
los que no superaron umbral), puedes re-umbralar sin volver a correr
SigLIP — simplemente filtra desde el JSON con un script auxiliar.

## Output: estructura

```json
{
  "generatedAt": "2026-05-25T...",
  "model": "google/siglip-base-patch16-256",
  "threshold": 0.5,
  "imagesProcessed": 1748,
  "labels": [
    {"id": "car", "prompt": "a car or passenger automobile"},
    ...
  ],
  "images": {
    "abc123...64hexchars": {
      "filename": "abc123....png",
      "tags": [
        {"tag": "car", "score": 0.91},
        {"tag": "intersection", "score": 0.72},
        {"tag": "urban_street", "score": 0.65}
      ],
      "allScores": {
        "car": 0.91,
        "truck": 0.18,
        "intersection": 0.72,
        ...
      }
    }
  },
  "stats": {
    "tagCounts": {"car": 892, "urban_street": 643, ...},
    "imagesWithoutTags": 47,
    "averageTagsPerImage": 3.03
  }
}
```

La key de `images` es el SHA-256 — coincide con `sha-audit.json`. Para
recomponer todo:

```js
const audit  = require("./tools/image-audit/sha-audit.json")
const tags   = require("./tools/image-audit/classification.json")

for (const group of audit.groups) {
  const info = tags.images[group.sha256]
  console.log(`SHA ${group.sha256.slice(0, 8)}`)
  console.log(`  Filenames: ${group.filenames.join(", ")}`)
  console.log(`  Preguntas: ${group.questionCount}`)
  console.log(`  Tags:      ${info?.tags.map(t => t.tag).join(", ") ?? "—"}`)
}
```

Eso es la "referencia de metadatos suficiente para buscar reemplazo" que
querías: dado un SHA → sabes qué preguntas se ven afectadas y qué tipo de
imagen buscar/generar para sustituirla.

## Solución de problemas

**"Cannot import name X from transformers"** — Versión de transformers
demasiado vieja. Asegúrate de tener `>=4.40`: `pip install -U transformers`.

**"OSError: [WinError 1455] El archivo de paginación es demasiado pequeño"** —
Windows, sin RAM suficiente. Reduce `BATCH = 8` en el script.

**"No module named sentencepiece"** — Falta el tokenizer. `pip install sentencepiece`.

**Tarda muchísimo** — Confirma que tienes la versión CPU de torch
(`python -c "import torch; print(torch.__version__)"` no debe mencionar
CUDA si no tienes GPU). Si aun así es lento, baja a `google/siglip-base-patch16-224`
(menos resolución, ~30% más rápido).

**El modelo no descarga** — Cortafuegos o sin red. Hugging Face Hub debe
ser accesible: https://huggingface.co. También puedes pre-descargar el
modelo con `huggingface-cli download google/siglip-base-patch16-256`.

## Hacia delante

Este JSON es el último paso del **diagnóstico**. A partir de aquí entra
la fase de **construcción del banco propio**, que tiene dos sub-pasos:

### 1. `find_replacements.py` — Reverse Image Search vía Bing

Para cada SHA en `sanitize/`, busca imágenes visualmente similares en la
web vía Bing Visual Search API. Descarga N candidatos por origen a
`public/images/candidates/`, naming = SHA-256 del candidato (dedup natural
entre orígenes).

```bash
# 1. Conseguir API key en portal.azure.com (Bing Search v7 resource).
#    Tier F1 = 1000 búsquedas/mes gratis. S1 = ~$3 por 1000.

# 2. Setear env var:
$env:BING_SEARCH_API_KEY = "..."     # Windows PowerShell
# export BING_SEARCH_API_KEY=...     # macOS/Linux

# 3. Probar con 5 imágenes antes de tirar 1748:
python find_replacements.py --limit 5

# 4. Si pinta bien, todo (tarda ~45 min en serie por TPS de Bing):
python find_replacements.py
```

Output:
- `public/images/candidates/<sha>.{jpg,png,webp}` — los binarios.
- `tools/image-audit/candidates.json` — mapeo source_sha → [candidates].

Resume: si interrumpes con Ctrl+C, los sources ya hechos se saltan al
relanzar. Checkpoint cada 20 imgs.

### 2. Re-correr SigLIP sobre los candidatos

Mismo script de antes pero apuntando a la carpeta nueva:

```bash
python classify_siglip.py \
  --input-dir ../../public/images/candidates \
  --output ../../tools/image-audit/classification-candidates.json
```

Tarda más (5×N imágenes), pero te deja la **tabla cruzada** definitiva:

```
source_sha     → tags (clasificación original)        ← classification.json
              → questions afectadas                   ← sha-audit.json
              → candidatos (5 SHAs nuevos)            ← candidates.json
                  ↓ cada uno con sus
                  → tags (clasificación candidato)    ← classification-candidates.json
```

Con eso para cada original puedes elegir el candidato cuyos tags mejor
matchean los tags del original (o cumplen los criterios que decidas) y
hacer el swap en BBDD usando el array `questions` de `sha-audit.json`.

### Alternativas si Bing no funciona

Microsoft está moviendo Bing Search APIs hacia "Grounding with Bing
Search" en Azure AI Foundry. Si el endpoint clásico te da problemas:

- **SerpAPI** (https://serpapi.com/google-reverse-image): wrapper de
  Google reverse image search. $50/mes para ~5000 queries. Sustituye la
  función `bing_visual_search()` con una llamada a su API.
- **Playwright headless**: scrapea Bing directo desde Chromium controlado.
  Gratis pero frágil, riesgo de bloqueo si abusas. Útil para volumen
  bajo.
- **TinEye** (https://services.tineye.com): especialista en reverse
  image. Mejor encontrando versiones de la MISMA imagen (cambios de
  resolución, recortes) que de imágenes similares. Plan paid desde
  ~$200/mes.

El SHA-256 sigue siendo el pivote estable entre todas las fases.
