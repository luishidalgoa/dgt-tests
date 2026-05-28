/**
 * Lista descriptiva de todos los `npm run *` del proyecto, agrupados
 * por categoría, con args y ejemplos de uso.
 *
 * Se invoca con `npm run help` (o `npm run ?`).
 *
 * Por qué no usar `npm run` directo: npm no permite descripciones por
 * script en package.json. Este help las define en código TypeScript,
 * lo cual además permite verificar contra el package.json real que no
 * se nos cuela ninguno sin documentar (assertCoverage al final).
 *
 * Cómo documentar args:
 *   args: [
 *     { name: "<username>",      type: "string", required: true,  description: "..." },
 *     { name: "[action]",        type: "on | off", default: "on", description: "..." },
 *     { name: "--apply",         type: "bool",   default: "off",  description: "..." },
 *     { name: "--provider <id>", type: "groq | gemini", default: "groq", description: "..." },
 *     { name: "--limit <N>",     type: "number", description: "..." },
 *   ]
 *
 * Si un script no acepta args, omite el campo o pon `args: []`. El
 * render mostrará "Sin args."
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// ── Colores ANSI (solo si stdout es TTY) ─────────────────────────────

const useColor = Boolean(process.stdout.isTTY)
const c = {
  reset:   useColor ? "\x1b[0m"  : "",
  bold:    useColor ? "\x1b[1m"  : "",
  dim:     useColor ? "\x1b[2m"  : "",
  cyan:    useColor ? "\x1b[36m" : "",
  green:   useColor ? "\x1b[32m" : "",
  yellow:  useColor ? "\x1b[33m" : "",
  magenta: useColor ? "\x1b[35m" : "",
  gray:    useColor ? "\x1b[90m" : "",
  red:     useColor ? "\x1b[31m" : "",
}

// ── Tipos ───────────────────────────────────────────────────────────

interface Arg {
  /**
   * Nombre tal y como aparece en CLI.
   *   - Flag boolean:           "--apply"
   *   - Flag con valor:         "--limit <N>"   "--provider <id>"
   *   - Posicional requerido:   "<username>"
   *   - Posicional opcional:    "[action]"
   */
  name:         string
  /**
   * Etiqueta de tipo. Para flags choice, lista los valores separados
   * con " | " (ej. "groq | gemini").
   *   bool · string · number · "a | b | c"
   */
  type:         string
  /** Default value como string (ej. "off", "60", "groq"). Omite si no hay. */
  default?:     string
  /** True para posicionales requeridos. */
  required?:    boolean
  /** Descripción corta (< 70 chars idealmente). */
  description:  string
}

interface ScriptDef {
  /** Nombre del script en package.json. Debe existir. */
  name:        string
  /** Una línea descriptiva (ideal < 80 chars). */
  description: string
  /** Args del script. Vacío/omitido → "Sin args." */
  args?:       Arg[]
  /** Ejemplos completos de invocación. */
  examples?:   string[]
}

interface Category {
  title:   string
  emoji:   string
  scripts: ScriptDef[]
}

// ── Flujos compuestos ──────────────────────────────────────────────
// Secuencias de comandos que se usan juntos (no son un solo npm script).
// Se renderizan al final del help como bloques de receta listos para
// copiar-pegar.
interface Workflow {
  title:       string
  emoji:       string
  description: string
  steps:       { cmd: string; comment?: string }[]
}

const WORKFLOWS: Workflow[] = [
  {
    title:       "Primera vez tras clonar el repo",
    emoji:       "🆕",
    description: "Setup completo de un PC nuevo: deps Node + venv del clasificador + bajada de imgs + metadata + (opcional) Modal cloud. Idempotente — re-correrlo no hace daño. Después de esto saltas directo a los workflows ☁️ o 🏠 según prefieras cloud o local.",
    steps: [
      { cmd: "npm install",                          comment: "deps de Node.js (Next, Prisma, tsx, etc.)" },
      { cmd: "npm run images:setup-classifier",      comment: "crea venv en tools/image-classifier + instala torch CPU + transformers + modal + boto3" },
      { cmd: "npm run images:download-r2",           comment: "baja TODAS las imágenes del bucket R2 → /public/images/ (solo si vas a clasificar en local)" },
      { cmd: "npm run images:download-metadata",     comment: "baja los JSONs del banco desde R2 → tools/image-audit/ (classifications, swipes, manual_tags, refs, etc.)" },
      { cmd: "# (opcional, solo para cloud)",        comment: "── si vas a usar Modal cloud:" },
      { cmd: "# (browser) https://modal.com/signup", comment: "  crea cuenta gratis: free tier $30/mes (~1200 runs), sin tarjeta" },
      { cmd: "npm run images:setup-modal",           comment: "  abre browser, te logueas, guarda token en ~/.modal.toml" },
    ],
  },
  {
    title:       "Reanálisis del banco de imágenes (local — SigLIP en tu máquina)",
    emoji:       "🔁",
    description: "Ciclo completo cuando reentrenes/clasifiques con nuevo vocabulario o cambios en LABELS. Necesita setup local del classifier. Incluye paso de VALIDACIÓN antes de subir a prod.",
    steps: [
      { cmd: "npm run images:download-metadata",   comment: "baja swipes admin + refinements + prototipos desde R2 (no perder trabajo de prod)" },
      { cmd: "npm run images:classify",            comment: "corre el classifier SigLIP local con A + B + C aplicados (refinements, kNN sobre prototipos, exclusiones/confirmaciones)" },
      { cmd: "npm run images:diff-classification", comment: "🔍 VALIDA el JSON nuevo vs el de R2 — detecta regresiones de feedback humano antes de subir" },
      { cmd: "npm run images:upload-metadata",     comment: "si el diff sale OK, publica el nuevo JSON a R2 → prod lo lee al instante (sin redeploy)" },
    ],
  },
  {
    title:       "Reanálisis vía HuggingFace API (sin modelo local)",
    emoji:       "🤗",
    description: "Mismo ciclo pero usando la API de HF — sin torch/transformers en local. Más lento pero cero dependencias pesadas. Requiere HF_TOKEN en .env.",
    steps: [
      { cmd: "npm run images:download-metadata", comment: "baja swipes admin desde prod" },
      { cmd: "npm run images:classify-hf",       comment: "clasifica via HF Inference API (≈1-3s/img). Etiquetas de labels.py, igual que el local." },
      { cmd: "npm run images:upload-metadata",   comment: "publica nuevos JSONs a R2" },
    ],
  },
  {
    title:       "Aplicar TODO el feedback acumulado (A + B + C) — CLOUD",
    emoji:       "🚀",
    description: "Pipeline completo de feedback humano → mejor classifier, usando MODAL. Lo corres cuando hayas swipeado / tagueado / descargado refs en /admin/images-bank y quieras volcar TODO el feedback al modelo. A aplica boost a confirmaciones + manual_tags, B refina prompts globalmente, C añade prototipos per-imagen (incl. los SHAs manual-tagueados), el classifier aplica TODO en cascada y al final hace cleanup atómico de manual_tags → tag_confirmations. Tiempo total ~10 min en cloud GPU.",
    steps: [
      { cmd: "npm run images:audit-feedback",            comment: "(opcional) ver qué hay acumulado (confirmaciones, exclusiones, manual_tags, refs) — guía las thresholds de B/C" },
      { cmd: "npm run images:refine-labels",             comment: "Fase B — Gemini analiza las imgs confirmadas/excluidas por label y reescribe prompts. ~30-90s. Persiste en meta/refined_labels.json (R2 + local)" },
      { cmd: "npm run images:compute-prototypes",        comment: "Fase C — Modal GPU computa embeddings SigLIP de confirmadas + excluidas + manual_tags como prototipos kNN. ~2-3 min. Persiste en meta/prototypes.json" },
      { cmd: "npm run images:classify-modal -- --force", comment: "Re-clasifica todo: refined prompts + kNN boost/penalty + flags humanConfirmed/humanAssigned. Al finalizar: manual_tags.json → tag_confirmations.json en R2 (cleanup automático). ~3-5 min" },
    ],
  },
  {
    title:       "Aplicar TODO el feedback acumulado (A + B + C) — LOCAL",
    emoji:       "🏠",
    description: "Pipeline equivalente al 🚀 pero corriendo TODO en tu venv local SIN Modal. Más lento (CPU vs GPU) pero sin dependencia cloud. Útil si Modal está agotado, quieres iterar sin gastar cuota Modal, o trabajas offline. Las imgs deben estar en public/images/ (`images:download-r2` si no).",
    steps: [
      { cmd: "npm run images:download-metadata",             comment: "sincroniza tag_confirmations + tag_exclusions + manual_tags + refined_labels + prototypes + alternative_references desde R2 → local" },
      { cmd: "npm run images:refine-labels",                 comment: "Fase B — Gemini analiza imgs y reescribe prompts. ~30-90s (Gemini API local). Sube a R2 + guarda copia local" },
      { cmd: "npm run images:compute-prototypes-local",      comment: "Fase C local — SigLIP en tu CPU/GPU computa embeddings (incl. manual_tags como positivos). ~45s para 50 protos. Sube a R2 (--no-upload para evitar)" },
      { cmd: "npm run images:classify -- --force",           comment: "Classify local con A + B + C aplicados + cleanup local manual_tags → tag_confirmations. ~30-45 min en CPU para 1748 imgs" },
      { cmd: "npm run images:diff-classification",           comment: "🔍 VALIDA el JSON nuevo vs el de R2 — detecta regresiones de feedback humano antes de subir" },
      { cmd: "npm run images:upload-metadata",               comment: "si el diff sale OK, publica classification + tag_confirmations actualizado + manual_tags vacío a R2 → prod lo lee al instante" },
    ],
  },
  {
    title:       "Aprendizaje con prototipos kNN (Fase C)",
    emoji:       "🧬",
    description: "Cuando acumules feedback (≥3 confirmaciones o exclusiones por label), el sistema puede usar los embeddings SigLIP de esas imgs como prototipos kNN para ajustar scoring de imgs futuras similares. Boost si parecida a confirmada+, penalty si parecida a excluida−. El boost solo actúa en imgs 'inciertas' (score 0.05-0.70); el penalty SIEMPRE para corregir falsos positivos. Aprende sin tocar el modelo base.",
    steps: [
      { cmd: "npm run images:audit-feedback",      comment: "ver cuántos prototipos potenciales tienes" },
      { cmd: "npm run images:compute-prototypes",  comment: "computa embeddings de las imgs confirmadas/excluidas y persiste a meta/prototypes.json (Modal GPU)" },
      { cmd: "npm run images:classify-modal -- --force", comment: "re-clasifica todo aplicando los prototipos kNN. Verás 🧬 prototipos aplicados al classifier en el log." },
    ],
  },
  {
    title:       "Refinar prompts con feedback humano (Fase B)",
    emoji:       "🪄",
    description: "Cuando tienes feedback acumulado en /admin/images-bank (confirmaciones/exclusiones), invoca Gemini con las imgs reales para refinar los prompts de labels concretos. Persiste en meta/refined_labels.json y el classifier lo aplica automáticamente al cargar vocab.",
    steps: [
      { cmd: "npm run images:audit-feedback",     comment: "lee R2 directo y muestra qué labels tienen feedback suficiente — guía para decidir thresholds" },
      { cmd: "npm run images:refine-labels -- --dry-run", comment: "preview sin tocar R2 ni Gemini — confirma qué labels va a refinar" },
      { cmd: "npm run images:refine-labels",       comment: "ejecuta Gemini con las imgs reales, valida JSON, persiste en R2 + tools/image-audit/refined_labels.json" },
      { cmd: "npm run images:classify-modal -- --force", comment: "re-clasifica todo con los prompts refinados aplicados (modal/local da igual — el classifier los carga al inicio)" },
    ],
  },
  {
    title:       "Smoke test antes de cambios grandes",
    emoji:       "🔬",
    description: "Antes de gastar una hora reclasificando 1700 imgs tras cambiar LABELS o prompts, valida con un subset de 10 imgs primero. Si los tags pintan bien, lanza el run completo. Si no, vuelves a iterar sin haber gastado quota AI ni tiempo en Modal.",
    steps: [
      { cmd: "npm run images:classify-modal -- --limit 10",     comment: "10 imgs en Modal (~30s) — barato, lee tu .env.classifier y aplica las mismas fases A+B+C" },
      { cmd: "# (UI) abre /admin/images-bank · sort: 🕐 Más recientes", comment: "compara visualmente los tags emitidos con los que tú habrías puesto" },
      { cmd: "npm run images:classify-modal -- --force",        comment: "si OK, lanza el run completo (~3-5 min para todo el banco)" },
    ],
  },
  {
    title:       "Imágenes faltantes en local (warning de feedback)",
    emoji:       "📥",
    description: "Si al correr `images:compute-prototypes-local` o `images:classify` ves warnings tipo \"N SHAs en feedback pero NO en public/images/ — skip\", significa que el admin ha dado feedback (confirmaciones, manual_tags, refs) a imágenes cuyos binarios solo viven en R2 y NO están en tu local. Resolución: bajarlas. Pasa frecuentemente con refs nuevas descargadas por Lens.",
    steps: [
      { cmd: "npm run images:download-r2",                 comment: "baja TODO el bucket → public/images/ (idempotente — solo trae lo que falta)" },
      { cmd: "npm run images:compute-prototypes-local",    comment: "reintenta — el warning desaparece y los prototipos se computan" },
    ],
  },
  {
    title:       "Tags manuales (admin asigna labels desde la UI)",
    emoji:       "🏷️",
    description: "El admin abre /admin/images-bank, hace click en '+ Añadir tag' en una card, escoge un label (o crea uno nuevo) y opcionalmente justifica el por qué. Esos manual_tags se almacenan en meta/manual_tags.json y SE INYECTAN en el classifier como verdad humana: boost a 0.30 + flag humanAssigned + prototipo kNN positivo. Tras un run exitoso del classifier MIGRAN automáticamente a tag_confirmations.json (cleanup atómico con audit log en manual_tags_history.json).",
    steps: [
      { cmd: "# (UI) /admin/images-bank → click '+ Añadir tag' en una card", comment: "el admin asigna el label + reason opcional" },
      { cmd: "npm run images:download-metadata",            comment: "(local) baja manual_tags.json para incluirlo en el próximo run local" },
      { cmd: "npm run images:compute-prototypes",            comment: "(opcional) genera prototipos kNN visuales para los SHAs manual-tagueados" },
      { cmd: "npm run images:classify-modal -- --force",     comment: "re-clasifica + aplica los manual_tags + cleanup: manual_tags.json → tag_confirmations.json en R2" },
    ],
  },
  {
    title:       "Guardar referencias visuales (Lens / Pexels+Pixabay)",
    emoji:       "🔍",
    description: "El admin abre /admin/images-bank, hace click en la 🔍 lupa de una card y elige tab 'Pexels + Pixabay' (free, keyword) o 'Google Lens' (SerpAPI, reverse image visual real). Cada candidato lo guarda con 'Guardar referencia' → descarga el binario, lo sube a R2 con su nuevo SHA + registra el vínculo en meta/alternative_references.json. La imagen queda PENDIENTE en el banco hasta que el classifier la procese en su siguiente run.",
    steps: [
      { cmd: "# (UI) /admin/images-bank → click 🔍 lupa → tab → 'Guardar referencia'", comment: "el admin descarga la imagen ↑ R2 con SHA propio" },
      { cmd: "# (UI) filtro 'Con refs' o sort '↻ Con más refs'", comment: "ver las imágenes con referencias descargadas para auditar" },
      { cmd: "npm run images:classify-modal",                comment: "el classifier descubre los SHAs huérfanos en R2 y los clasifica (PENDIENTE → clasificada)" },
    ],
  },
  {
    title:       "Bulk-download masivo de referencias (CLI, todo el banco)",
    emoji:       "📦",
    description: "Alternativa CLI al flujo manual 🔍 para cuando quieres llenar el banco con N refs por imagen sin ir card a card. Itera el banco, salta los SHAs que YA tienen target (default 5) o que SON refs ellos mismos, y descarga lo que falte. Persiste tras cada SHA → resistente a crashes (re-ejecutar reanuda). Stock APIs por defecto (free); --provider google para gastar cuota SerpAPI Lens si quieres mejor calidad.",
    steps: [
      { cmd: "npm run images:bulk-save-refs -- --dry-run",         comment: "ver cuántas SHAs procesaría y cuántas descargas haría" },
      { cmd: "npm run images:bulk-save-refs -- --max-shas 5",      comment: "smoke test con 5 SHAs antes de tirarlo del todo" },
      { cmd: "npm run images:bulk-save-refs",                       comment: "bulk completo: stock APIs, 5 refs/img, 500ms entre descargas" },
      { cmd: "npm run images:classify-modal",                       comment: "tras el bulk, clasifica las refs huérfanas (PENDIENTE → clasificada)" },
    ],
  },
  {
    title:       "Migración masiva de imágenes a R2",
    emoji:       "🚚",
    description: "Limpieza completa del bucket + re-upload (raro — solo si cambias el esquema de nombres).",
    steps: [
      { cmd: "npm run images:clean-r2 -- --apply", comment: "borra todo el bucket (excepto meta/)" },
      { cmd: "npm run images:upload-r2",            comment: "sube /public/images/ con sus nombres actuales" },
    ],
  },
  {
    title:       "Subida de cambios local → prod",
    emoji:       "🚀",
    description: "Sync de contenido (questions, opciones, tests) preservando datos de usuario, secrets y trabajo admin.",
    steps: [
      { cmd: "npm run turso:sync -- --dry-run", comment: "preview de qué se va a INSERT / UPDATE / SKIP" },
      { cmd: "npm run turso:sync",              comment: "aplica el sync con defaults seguros" },
    ],
  },
]

// ── Catálogo ────────────────────────────────────────────────────────

const CATEGORIES: Category[] = [
  {
    title: "Desarrollo",
    emoji: "🚀",
    scripts: [
      { name: "dev",        description: "Arranca el servidor de desarrollo en http://localhost:4321" },
      { name: "dev:reset",  description: "Regenera Prisma client (úsalo si dev grita 'client out of date')" },
      { name: "build",      description: "Build de producción (regenera Prisma + Next build)" },
      { name: "start",      description: "Server de producción (después de un build)" },
      { name: "lint",       description: "ESLint sobre todo el proyecto" },
      { name: "test",       description: "Suite de tests completa (vitest --run)" },
      { name: "test:watch", description: "Tests en modo watch (re-ejecuta al cambiar)" },
      { name: "test:ui",    description: "Vitest UI en el navegador (más visual)" },
      { name: "e2e",        description: "Tests E2E con Playwright (requiere `e2e:install` la primera vez)" },
      { name: "e2e:ui",     description: "Playwright en modo UI interactivo (debug visual paso a paso)" },
      { name: "e2e:install", description: "Instala el browser Chromium para Playwright (solo la primera vez por máquina)" },
    ],
  },
  {
    title: "Base de datos (local — SQLite)",
    emoji: "💾",
    scripts: [
      { name: "db:push", description: "Aplica schema.prisma a la BBDD local sin crear migración" },
      { name: "db:seed", description: "Carga preguntas, categorías y tests iniciales desde el JSON" },
      { name: "db:reset", description: "⚠ Reset completo + seed (BORRA todos los datos locales)" },
      {
        name:        "db:pull-prod",
        description: "Descarga la BBDD de prod (Turso) → local (sanitizada por defecto)",
        args: [
          { name: "--dry-run",        type: "bool", default: "off", description: "Solo cuenta, no escribe nada en local." },
          { name: "--no-confirm",     type: "bool", default: "off", description: "Salta el prompt interactivo de confirmación." },
          { name: "--raw",            type: "bool", default: "off", description: "⚠ NO sanitiza emails/passwords — descarga datos reales." },
          { name: "--keep-appconfig", type: "bool", default: "off", description: "Incluye la tabla app_config (claves cifradas)." },
        ],
        examples: [
          "npm run db:pull-prod                          # con confirmación interactiva",
          "npm run db:pull-prod -- --dry-run",
          "npm run db:pull-prod -- --no-confirm --raw    # ⚠ peligroso",
        ],
      },
    ],
  },
  {
    title: "Base de datos (producción — Turso)",
    emoji: "🌍",
    scripts: [
      { name: "turso:init", description: "Inicializa el schema en la BBDD Turso desde cero" },
      {
        name:        "turso:sync",
        description: "Sincroniza local → Turso preservando datos de usuario, app_config y revisiones admin",
        args: [
          { name: "--dry-run",                type: "bool", default: "off", description: "Preview sin escribir (alias: -n)." },
          { name: "--no-system-data",         type: "bool", default: "off", description: "Skip categories/tests/test_questions/manual_sections." },
          { name: "--no-questions",           type: "bool", default: "off", description: "Skip questions + options." },
          { name: "--no-ai-cache",            type: "bool", default: "off", description: "Skip ai_cache_entries." },
          { name: "--no-admin-protection",    type: "bool", default: "off", description: "⚠ Sobrescribe questions editadas/aprobadas por admin." },
          { name: "--include-user-data",      type: "bool", default: "off", description: "⚠ Sobrescribe users + exam_attempts + answers en prod." },
          { name: "--include-app-config",     type: "bool", default: "off", description: "⚠ Sobrescribe secrets de prod con los de local." },
        ],
        examples: [
          "npm run turso:sync                  # default seguro: sistema + questions (con protección) + ai-cache insert-only",
          "npm run turso:sync -- --dry-run     # preview",
          "npm run turso:sync -- --no-ai-cache # sync sistema + questions, sin tocar la caché IA",
        ],
      },
      {
        name:        "turso:apply-migration",
        description: "Aplica una migración SQL concreta a Turso",
        args: [
          { name: "<name>", type: "string", required: true, description: "Nombre de carpeta dentro de prisma/migrations/." },
        ],
        examples: [
          "npm run turso:apply-migration -- 20260522190000_add_ai_question_fields",
        ],
      },
      {
        name:        "turso:sync-ai-questions",
        description: "Sube solo las preguntas IA locales que aún no estén en Turso",
        args: [
          { name: "--dry-run", type: "bool", default: "off", description: "Lista qué subiría sin hacerlo (alias: -n)." },
        ],
        examples: [
          "npm run turso:sync-ai-questions",
          "npm run turso:sync-ai-questions -- --dry-run",
        ],
      },
      {
        name:        "turso:sync-question",
        description: "UPSERTea a Turso UNA o varias preguntas concretas tras editarlas en /admin/questions. Match por externalId; refresca campos editables + DELETE/INSERT de Options. Idempotente.",
        args: [
          { name: "--id <N | N,M,...>", type: "string", required: true,  description: "Id local de la(s) pregunta(s) a subir (separado por comas)." },
          { name: "--dry-run",          type: "bool",   default: "off",   description: "Preview sin escribir." },
        ],
        examples: [
          "npm run turso:sync-question -- --id 123",
          "npm run turso:sync-question -- --id 123,456,789",
          "npm run turso:sync-question -- --id 123 --dry-run",
        ],
      },
    ],
  },
  {
    title: "Manual del temario · Índice",
    emoji: "📚",
    scripts: [
      { name: "manual:import",            description: "Importa secciones del manual (PDF flipbook + indice.json)" },
      { name: "manual:extract-skeleton",  description: "Regenera src/data/manualIndice.json (modo merge: preserva títulos)" },
      {
        name:        "manual:infer-titles",
        description: "Rellena títulos vacíos del índice con IA (Groq por defecto)",
        args: [
          { name: "--provider <id>", type: "groq | gemini", default: "groq", description: "Qué proveedor LLM usar." },
          { name: "--model <id>",    type: "string",                          description: "Override del modelo del provider." },
          { name: "--dry-run",       type: "bool",          default: "off",   description: "Muestra qué inferiría sin escribir." },
          { name: "--limit <N>",     type: "number",                          description: "Procesa solo los primeros N nodos." },
          { name: "--throttle <ms>", type: "number",                          description: "Pausa entre llamadas al LLM." },
        ],
        examples: [
          "npm run manual:infer-titles",
          "npm run manual:infer-titles -- --dry-run --limit 5",
          "npm run manual:infer-titles -- --provider gemini",
          "npm run manual:infer-titles -- --provider groq --model mixtral-8x7b-32768",
        ],
      },
      {
        name:        "questions:generate",
        description: "Genera preguntas tipo-DGT con IA en sub-bloques con pocas preguntas",
        args: [
          { name: "--count <N>",     type: "number",        default: "60",   description: "Total de preguntas a generar." },
          { name: "--per-block <N>", type: "number",        default: "3",    description: "Preguntas por sub-bloque." },
          { name: "--provider <id>", type: "groq | gemini", default: "groq", description: "Qué proveedor LLM usar." },
          { name: "--model <id>",    type: "string",                          description: "Override del modelo del provider." },
          { name: "--dry-run",       type: "bool",          default: "off",  description: "Muestra qué generaría sin escribir en BBDD." },
        ],
        examples: [
          "npm run questions:generate",
          "npm run questions:generate -- --count 30 --per-block 3",
          "npm run questions:generate -- --provider gemini --dry-run",
          "# Después: revísalas en http://localhost:4321/admin/review-questions",
        ],
      },
    ],
  },
  {
    title: "Usuarios",
    emoji: "👤",
    scripts: [
      { name: "user:seed", description: "Crea el usuario admin inicial (luishidalgoa) en local" },
      {
        name:        "user:role",
        description: "Cambia el rol de un usuario en LOCAL",
        args: [
          { name: "<username>", type: "string",                        required: true, description: "Username objetivo." },
          { name: "<role>",     type: "USER | SUBSCRIBER | ADMIN",     required: true, description: "Rol a asignar." },
        ],
        examples: ["npm run user:role -- luishidalgoa ADMIN"],
      },
      {
        name:        "user:role:prod",
        description: "⚠ Cambia el rol de un usuario en PRODUCCIÓN (Turso)",
        args: [
          { name: "<username>", type: "string",                        required: true, description: "Username objetivo." },
          { name: "<role>",     type: "USER | SUBSCRIBER | ADMIN",     required: true, description: "Rol a asignar." },
        ],
        examples: ["npm run user:role:prod -- luishidalgoa ADMIN"],
      },
      {
        name:        "user:fake-subscribe",
        description: "Marca/desmarca un user como SUBSCRIBER sin pasar por Stripe (debug)",
        args: [
          { name: "<username>", type: "string",    required: true,  description: "Username objetivo." },
          { name: "[action]",   type: "on | off",  default: "on",   description: "on = activa la sub fake; off = la quita." },
        ],
        examples: [
          "npm run user:fake-subscribe -- luisph",
          "npm run user:fake-subscribe -- luisph off",
        ],
      },
      {
        name:        "user:lowercase",
        description: "Normaliza todos los usernames a minúsculas (one-shot, idempotente)",
        args: [
          { name: "--apply", type: "bool", default: "off", description: "Aplica los cambios; sin esto solo muestra el plan." },
        ],
        examples: [
          "npm run user:lowercase                # dry-run",
          "npm run user:lowercase -- --apply",
        ],
      },
      {
        name:        "user:clear-stripe",
        description: "Limpia los campos stripeCustomerId/SubscriptionId de un user",
        args: [
          { name: "<username>", type: "string", required: true,           description: "Username objetivo." },
          { name: "--apply",    type: "bool",   default: "off", description: "Aplica los cambios; sin esto solo audita." },
        ],
        examples: [
          "npm run user:clear-stripe -- luisph",
          "npm run user:clear-stripe -- luisph --apply",
        ],
      },
    ],
  },
  {
    title: "Stripe (suscripciones)",
    emoji: "💳",
    scripts: [
      { name: "stripe:check", description: "Verifica conexión + API key de Stripe" },
      {
        name:        "stripe:sync-user",
        description: "Reconcilia el estado de un user con Stripe (rol, fechas, etc.)",
        args: [
          { name: "<username>", type: "string", required: true, description: "Username a reconciliar." },
        ],
        examples: ["npm run stripe:sync-user -- luisph"],
      },
      { name: "stripe:setup-test", description: "Configura productos/prices de TEST en tu cuenta Stripe local" },
      {
        name:        "stripe:audit",
        description: "Audita customers huérfanos en Stripe (cus_* sin user en BBDD)",
        args: [
          { name: "--cancel-orphan-subs", type: "bool", default: "off", description: "⚠ Cancela las subs activas de los orphans encontrados." },
        ],
        examples: [
          "npm run stripe:audit",
          "npm run stripe:audit -- --cancel-orphan-subs    # ⚠ destructivo",
        ],
      },
      {
        name:        "stripe:listen",
        description: "Forward de webhooks Stripe → http://localhost:4321/api/webhooks/stripe",
        examples:    ["npm run stripe:listen"],
      },
    ],
  },
  {
    title: "Banco de imágenes",
    emoji: "🖼",
    scripts: [
      // ── Sync con R2 (CDN externo) ────────────────────────────────
      {
        name:        "images:download-r2",
        description: "Descarga TODAS las imágenes del bucket R2 → /public/images/ (idempotente)",
        args: [
          { name: "FORCE", type: "env=1", default: "off", description: "Redescarga aunque exista local con mismo tamaño." },
        ],
        examples: [
          "npm run images:download-r2",
          "$env:FORCE = '1'; npm run images:download-r2   # PowerShell — force redescarga",
        ],
      },
      { name: "images:upload-r2",  description: "Sube /public/images/ → bucket R2 (CDN externo, idempotente)" },
      {
        name:        "images:clean-r2",
        description: "Borra TODAS las imágenes del bucket R2 (respeta el prefix meta/)",
        args: [
          { name: "--apply", type: "bool", default: "off", description: "Sin esto es dry-run. Pásalo para borrar de verdad." },
        ],
        examples: [
          "npm run images:clean-r2                # preview",
          "npm run images:clean-r2 -- --apply     # borra de verdad",
        ],
      },
      {
        name:        "images:upload-metadata",
        description: "Sube todos los JSONs de tools/image-audit/ → bucket R2 bajo prefix meta/. Incluye: classification.json, sha-audit.json, discovered_labels.json, refined_labels.json (Fase B), prototypes.json (Fase C), tag_exclusions.json, tag_confirmations.json, alternative_references.json (refs Lens/stock guardadas por admin), manual_tags.json (tags asignados manualmente, pendientes de migración). Idempotente (overwrite). Skip silencioso para los que no existen en local.",
      },
      {
        name:        "images:download-metadata",
        description: "Baja todos los meta/*.json de R2 → tools/image-audit/. Espejo de upload-metadata. Útil ANTES de classify local para sincronizar swipes admin recientes + tags manuales asignados + refs descargadas + refinements + prototipos kNN actualizados.",
      },

      // ── Pipeline de análisis / clasificación ────────────────────
      {
        name:        "images:setup-classifier",
        description: "Setup ONE-SHOT del clasificador: crea venv + instala torch/transformers/modal/etc. (idempotente)",
        examples: [
          "npm run images:setup-classifier   # tras clonar el repo, antes del primer images:classify",
        ],
      },
      {
        name:        "images:setup-modal",
        description: "Autentica el CLI de Modal en este venv (una vez). Abre el browser y guarda token en ~/.modal.toml",
        examples: [
          "npm run images:setup-modal   # antes del primer images:classify-modal",
        ],
      },
      {
        name:        "images:refine-labels",
        description: "Refina prompts de LABELS / LABEL_NEGATIVES usando el feedback humano acumulado en R2 vía Gemini (Fase B). Persiste en meta/refined_labels.json (R2 + local). El classifier los aplica al cargar el vocab.",
        args: [
          { name: "--dry-run",                type: "bool",   default: "off", description: "Muestra qué refinaría sin tocar R2 ni hacer calls a Gemini." },
          { name: "--label <id>",             type: "string",                  description: "Refina solo ESE label (fuerza inclusión aunque no pase thresholds)." },
          { name: "--min-confirmations <N>",  type: "number", default: "5",   description: "Mín. confirmaciones para refinar positivos." },
          { name: "--min-exclusions <N>",     type: "number", default: "10",  description: "Mín. exclusiones para refinar negativos." },
          { name: "--limit <N>",              type: "number", default: "0",   description: "Cap al número de labels a refinar (0=todos)." },
        ],
        examples: [
          "npm run images:refine-labels -- --dry-run                          # ver qué refinaría sin tocar nada",
          "npm run images:refine-labels                                       # refina TODOS los candidatos según thresholds",
          "npm run images:refine-labels -- --label lane_merge_diverge         # refina solo ese label",
          "npm run images:refine-labels -- --min-exclusions 5 --limit 3       # bajar thresholds y limitar a 3",
        ],
      },
      {
        name:        "images:compute-prototypes",
        description: "Computa embeddings SigLIP de imágenes con feedback humano (confirmadas + excluidas + manual_tags) y los persiste como prototipos kNN en meta/prototypes.json (Fase C). El classifier los usa para ajustar scores via similitud coseno (boost para positivos, penalty para negativos). Los manual_tags se proyectan como positivos in-memory para esta build (no escribe manual_tags.json — esa migración la hace el classifier al final de su run). REQUIERE MODAL.",
        args: [
          { name: "--force",         type: "bool",   default: "off", description: "Re-computa TODOS los prototipos desde cero (ignora R2 existing). Útil tras cambiar MODEL_ID." },
          { name: "--only-label <id>", type: "string",               description: "Solo computa prototipos para ese label." },
          { name: "--no-save-local", type: "bool",   default: "off", description: "No guarda copia local en tools/image-audit/prototypes.json." },
        ],
        examples: [
          "npm run images:compute-prototypes                          # incremental — solo añade prototipos nuevos del feedback acumulado",
          "npm run images:compute-prototypes -- --force               # recomputa TODO (más lento)",
          "npm run images:compute-prototypes -- --only-label moped    # solo prototipos del label moped",
        ],
      },
      {
        name:        "images:compute-prototypes-local",
        description: "Equivalente a `compute-prototypes` pero corre en tu venv local SIN Modal. Usa el mismo SigLIP local que classify_siglip.py. Necesita las imgs en public/images/ (corre `images:download-r2` antes si faltan). Incluye manual_tags como prototipos positivos in-memory. Sube a R2 por defecto (--no-upload para evitar).",
        args: [
          { name: "--force",            type: "bool",   default: "off", description: "Recomputa TODOS los prototipos desde cero." },
          { name: "--only-label <id>",  type: "string",                 description: "Solo computa prototipos para ese label." },
          { name: "--no-upload",        type: "bool",   default: "off", description: "No sube a R2 — solo guarda copia local en tools/image-audit/prototypes.json." },
        ],
        examples: [
          "npm run images:compute-prototypes-local                       # incremental, sube a R2",
          "npm run images:compute-prototypes-local -- --no-upload         # solo local",
          "npm run images:compute-prototypes-local -- --force --no-upload # recomputa local sin tocar R2",
        ],
      },
      {
        name:        "images:audit-sha",
        description: "Audita SHA-256 + cross-ref con Question.imagen → tools/image-audit/sha-audit.json",
        args: [
          { name: "IMAGES_DIR",   type: "env=path", default: "public/images",                       description: "Directorio a auditar." },
          { name: "AUDIT_OUTPUT", type: "env=path", default: "tools/image-audit/sha-audit.json",    description: "Path JSON salida." },
        ],
      },
      {
        name:        "images:audit-feedback",
        description: "Lee tag_confirmations + tag_exclusions + manual_tags + alternative_references de R2 y muestra distribución por label. Útil para decidir si correr B (refine prompts), C (kNN sobre embeddings) o procesar las refs pendientes.",
        examples: [
          "npm run images:audit-feedback   # tras swipear / taguear / descargar refs en /admin/images-bank",
        ],
      },
      {
        name:        "images:bulk-save-refs",
        description: "Bulk-download de referencias visuales para todo el banco. Por cada SHA original (excluye los que SON refs) busca candidatos y descarga hasta llegar a N refs por imagen. Persiste el registry tras cada SHA → resistente a crashes (re-ejecutar reanuda desde donde quedó). Sin login: lee creds R2 de .env. Las refs quedan sin tags hasta que corras el classifier.",
        args: [
          { name: "--target <N>",     type: "number",       default: "5",     description: "Refs por imagen. SHAs con >=N se saltan." },
          { name: "--provider <id>",  type: "stock | google", default: "stock", description: "stock=Pexels+Pixabay (free) · google=SerpAPI Lens (gasta cuota)." },
          { name: "--max-shas <N>",   type: "number",       default: "0",     description: "Limita a las primeras N SHAs (0=todas, útil para smoke test)." },
          { name: "--dry-run",        type: "bool",         default: "off",   description: "Calcula el plan sin descargar." },
          { name: "--tagged-only",    type: "bool",         default: "off",   description: "Skip SHAs sin tag (típico para refs huérfanas pendientes que aún no se han clasificado)." },
          { name: "--delay-ms <N>",   type: "number",       default: "500",   description: "Pausa entre descargas (respetar rate limits de los providers)." },
        ],
        examples: [
          "npm run images:bulk-save-refs -- --dry-run                # ver plan",
          "npm run images:bulk-save-refs -- --max-shas 5             # smoke test con 5 SHAs",
          "npm run images:bulk-save-refs                              # arranca el bulk completo con stock APIs",
          "npm run images:bulk-save-refs -- --provider google        # versión Lens (más calidad, gasta SerpAPI)",
          "npm run images:bulk-save-refs -- --target 3 --tagged-only # 3 refs solo de SHAs con tag",
        ],
      },
      {
        name:        "images:diff-classification",
        description: "Compara tools/image-audit/classification.json (LOCAL recién generado) vs meta/classification.json en R2. Detecta regresiones de feedback humano + cambios de tag principal + variación de conteos. Úsalo ANTES de upload-metadata para validar.",
        examples: [
          "npm run images:diff-classification   # tras correr classify local",
        ],
      },
      {
        name:        "images:classify-hf",
        description: "Clasifica via HuggingFace Inference API (sin torch/transformers local). Requiere HF_TOKEN en .env",
        args: [
          { name: "--input-dir <path>",  type: "string", default: "public/images",                       description: "Directorio de imgs." },
          { name: "--output <path>",     type: "string", default: "tools/image-audit/classification.json", description: "JSON output." },
          { name: "--threshold <N>",     type: "number", default: "0.5",                                  description: "Score mínimo para tag confident." },
          { name: "--limit <N>",         type: "number", default: "0",                                    description: "Limitar a N imágenes (smoke test)." },
          { name: "--skip-existing",     type: "bool",   default: "off",                                  description: "Salta SHAs que ya están en el JSON output." },
        ],
        examples: [
          "npm run images:classify-hf -- --limit 10                         # smoke test 10 imgs",
          "npm run images:classify-hf -- --skip-existing                     # incremental tras añadir nuevas imgs",
        ],
      },
      {
        name:        "images:classify-modal",
        description: "Clasifica 100% en cloud GPU (Modal.com): lee imgs de R2 → SigLIP en T4 → escribe meta/classification.json. Consume tag_confirmations + tag_exclusions + manual_tags + refined_labels + prototypes (Fases A+B+C). Al terminar, MIGRA automáticamente manual_tags.json → tag_confirmations.json en R2 (cleanup atómico tras run exitoso, con audit log en manual_tags_history.json). Requiere setup previo: `npm run images:setup-classifier` + `npm run images:setup-modal` (ver workflow 🆕).",
        args: [
          { name: "--force",             type: "bool",   default: "off", description: "Reprocesa TODAS las imágenes aunque ya estén en classification.json de R2." },
          { name: "--limit <N>",         type: "number", default: "0",   description: "Cap a las primeras N imágenes (smoke test, no usa --force)." },
          { name: "--no-save-local",     type: "bool",   default: "off", description: "No guarda la copia local en tools/image-audit/classification.json (R2 sigue siendo source of truth)." },
          { name: "--no-gemini",         type: "bool",   default: "off", description: "Desactiva auto-discovery con Gemini (útil si quieres ahorrar quota)." },
          { name: "--no-groq",           type: "bool",   default: "off", description: "Desactiva fallback Groq." },
          { name: "--retry-problematic", type: "bool",   default: "off", description: "Reprocesa SOLO las imgs sin tag confident del prev (las que quedaron sin discovery por quota agotada). Preserva las imgs con tag confident." },
        ],
        examples: [
          "npm run images:classify-modal                                 # incremental — solo imgs nuevas vs R2",
          "npm run images:classify-modal -- --limit 10                   # smoke test con 10 imgs",
          "npm run images:classify-modal -- --force                      # reprocesa todo el banco",
          "npm run images:classify-modal -- --retry-problematic          # reintenta solo las problemáticas (tras esperar 24h por quota Gemini/Groq)",
        ],
      },
      {
        name:        "images:classify",
        description: "Clasifica multi-label local con SigLIP. Sync automático de R2 al inicio (solo baja imgs que falten en local — pasa `--no-r2-sync` para saltar). Aplica feedback humano en cascada: A (humanConfirmed/humanAssigned + boost) + B (refined_labels.json) + C (kNN sobre prototypes.json) + auto-discovery Gemini→Groq con top-relevant en prompt + cache de embeddings. Lee tag_confirmations + tag_exclusions + manual_tags + refined_labels + prototypes desde tools/image-audit/ (sincronizar con `download-metadata` antes). Al terminar OK migra manual_tags.json → tag_confirmations.json LOCAL + audit log; corre `upload-metadata` después para sincronizar R2.",
        args: [
          { name: "--input-dir <path>",  type: "string",                description: "Carpeta de imgs (default: public/images). Si no existe, descarga primero con `images:download-r2`." },
          { name: "--output <path>",     type: "string",                description: "JSON salida (default: tools/image-audit/classification.json)." },
          { name: "--retry-problematic", type: "bool",   default: "off", description: "Re-procesa solo imgs sin tag confident del run anterior (las que se quedaron sin discovery)." },
          { name: "--retry-no-tags",     type: "bool",   default: "off", description: "Más estricto: re-procesa solo imgs con CERO tags (todos los scores < min_score)." },
          { name: "--no-gemini",         type: "bool",   default: "off", description: "Desactiva Gemini auto-discovery (útil si Gemini está agotado por quota)." },
          { name: "--no-groq",           type: "bool",   default: "off", description: "Desactiva Groq fallback." },
          { name: "--no-cache",          type: "bool",   default: "off", description: "Desactiva cache de embeddings de imagen (re-codifica todo)." },
          { name: "--no-vocab-check",    type: "bool",   default: "off", description: "Desactiva auto-detección de cambios en LABELS (que dispara re-clasificación automática)." },
          { name: "--no-r2-sync",        type: "bool",   default: "off", description: "Salta el sync R2 → local del inicio (offline / conexión lenta / sabes que está completo)." },
          { name: "--force, -f",         type: "bool",   default: "off", description: "Ignora classification.json existente y re-procesa TODAS las imgs desde cero." },
        ],
        examples: [
          "npm run images:classify                                  # default: cache + auto-vocab-check + A+B+C aplicados",
          "npm run images:classify -- --force                       # re-clasifica todo desde cero",
          "npm run images:classify -- --force --no-gemini --no-groq # solo SigLIP+kNN+refinements, sin gastar quota AI",
          "npm run images:classify -- --retry-problematic           # solo las imgs sin tag confident del run anterior",
        ],
      },
    ],
  },
  {
    title: "Datos y mantenimiento",
    emoji: "🛠",
    scripts: [
      { name: "ingest",            description: "Pipeline completo: seed BBDD + copy images + import manual" },
      {
        name:        "attempts:cleanup-orphan",
        description: "Borra exam_attempts sin answers (intentos abandonados)",
        args: [
          { name: "--apply", type: "bool", default: "off", description: "Borra de verdad; sin esto solo audita." },
        ],
        examples: [
          "npm run attempts:cleanup-orphan",
          "npm run attempts:cleanup-orphan -- --apply",
        ],
      },
      {
        name:        "user-ai-paid:backfill",
        description: "Marca como ya pagadas las explicaciones IA pre-Fase 79",
        args: [
          { name: "--apply",            type: "bool",   default: "off", description: "Aplica los cambios." },
          { name: "--user <username>",  type: "string",                            description: "Filtra a un solo usuario." },
        ],
        examples: [
          "npm run user-ai-paid:backfill",
          "npm run user-ai-paid:backfill -- --apply",
          "npm run user-ai-paid:backfill -- --apply --user luisph",
        ],
      },
      { name: "questions:tag-tiers", description: "Etiqueta preguntas con tier FREE/PRO según reglas" },
      {
        name:        "questions:audit",
        description: "Audita Turso prod: preguntas donde isCorrect oficial NO coincide con la más votada. Solo lectura.",
        examples: [
          "npm run questions:audit",
          "# Vuelca también el desglose completo de la pregunta #1583",
        ],
      },
      {
        name:        "dev:prepare-test-user",
        description: "Crea un user de test limpio (para flujos E2E)",
        args: [
          { name: "--username <name>", type: "string", default: "test",                  description: "Username del user de test." },
          { name: "--email <addr>",    type: "string", default: "test@dgt-tests.local", description: "Email del user de test." },
          { name: "--password <pwd>",  type: "string", default: "test1234",             description: "Password en plano (se hashea)." },
        ],
        examples: [
          "npm run dev:prepare-test-user",
          "npm run dev:prepare-test-user -- --username e2e --password secreto",
        ],
      },
      {
        name:        "dev:send-test-email",
        description: "Envía un email de prueba via Gmail SMTP",
        args: [
          { name: "<username>", type: "string",            required: true, description: "Username destinatario (debe tener email)." },
          { name: "<kind>",     type: "upcoming | failed", required: true, description: "Tipo de email a probar." },
        ],
        examples: [
          "npm run dev:send-test-email -- luisph upcoming",
          "npm run dev:send-test-email -- luisph failed",
        ],
      },
    ],
  },
]

// ── Render ──────────────────────────────────────────────────────────

const PAD_SCRIPT_NAME = 28
const PAD_ARG_NAME    = 22
const PAD_ARG_TYPE    = 26
const PAD_ARG_META    = 22

/** padEnd que garantiza al menos `minGap` espacios si el valor desborda. */
function padCell(s: string, width: number, minGap = 2): string {
  return s.length >= width ? s + " ".repeat(minGap) : s.padEnd(width)
}

function formatArg(a: Arg): string {
  const nameCol = padCell(a.name, PAD_ARG_NAME)
  const typeCol = padCell(a.type, PAD_ARG_TYPE)

  // Meta: requerido / default / opcional
  let meta: string
  if (a.required)                  meta = "requerido"
  else if (a.default !== undefined) meta = `default: ${a.default}`
  else                              meta = "opcional"
  const metaCol = padCell(`(${meta})`, PAD_ARG_META)

  return `${c.yellow}${nameCol}${c.reset}${c.gray}${typeCol}${c.dim}${metaCol}${c.reset}${a.description}`
}

function printHelp(): void {
  console.log(`\n${c.bold}📜 Comandos disponibles · DGT Tests${c.reset}`)
  console.log(`${c.gray}   Ejecuta con: ${c.reset}${c.cyan}npm run <comando>${c.reset}\n`)

  for (const cat of CATEGORIES) {
    console.log(`${c.bold}${cat.emoji}  ${cat.title}${c.reset}`)
    for (const s of cat.scripts) {
      const namePad = s.name.padEnd(PAD_SCRIPT_NAME)
      console.log(`   ${c.green}${namePad}${c.reset}${s.description}`)

      const args = s.args ?? []
      if (args.length > 0) {
        console.log(`   ${c.gray}${"".padEnd(PAD_SCRIPT_NAME)}args:${c.reset}`)
        for (const a of args) {
          console.log(`   ${"".padEnd(PAD_SCRIPT_NAME)}  ${formatArg(a)}`)
        }
      }

      if (s.examples && s.examples.length > 0) {
        console.log(`   ${c.gray}${"".padEnd(PAD_SCRIPT_NAME)}ejemplos:${c.reset}`)
        for (const ex of s.examples) {
          console.log(`   ${c.gray}${"".padEnd(PAD_SCRIPT_NAME)}  ${c.cyan}${ex}${c.reset}`)
        }
      }
    }
    console.log()
  }

  // ── Flujos compuestos ───────────────────────────────────────────
  console.log(`${c.bold}🧭 Flujos completos${c.reset}`)
  console.log(`${c.gray}   Recetas multi-comando para tareas que combinan varios scripts.${c.reset}\n`)
  for (const wf of WORKFLOWS) {
    console.log(`${c.bold}${wf.emoji}  ${wf.title}${c.reset}`)
    console.log(`   ${c.gray}${wf.description}${c.reset}`)
    for (const step of wf.steps) {
      console.log(`   ${c.cyan}${step.cmd}${c.reset}${step.comment ? `   ${c.gray}# ${step.comment}${c.reset}` : ""}`)
    }
    console.log()
  }

  console.log(`${c.dim}💡 Tip: usa "--" para pasar flags a un script:${c.reset}`)
  console.log(`   ${c.cyan}npm run db:pull-prod -- --dry-run${c.reset}\n`)
}

function assertCoverage(): void {
  // Verifica que todos los scripts del package.json estén documentados
  // aquí (excepto los lifecycle hooks que ejecuta npm automáticamente).
  const LIFECYCLE_HIDDEN = new Set(["prepare", "postinstall", "help", "?"])

  const pkgPath = resolve(process.cwd(), "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, string>
  }
  const pkgScripts = new Set(Object.keys(pkg.scripts ?? {}))

  const documentedScripts = new Set(
    CATEGORIES.flatMap((cat) => cat.scripts.map((s) => s.name))
  )

  // Scripts en package.json pero NO documentados
  const undocumented: string[] = []
  for (const name of pkgScripts) {
    if (LIFECYCLE_HIDDEN.has(name)) continue
    if (!documentedScripts.has(name)) undocumented.push(name)
  }

  // Scripts documentados pero NO en package.json
  const stale: string[] = []
  for (const name of documentedScripts) {
    if (!pkgScripts.has(name)) stale.push(name)
  }

  if (undocumented.length > 0) {
    console.log(`${c.yellow}\n⚠  Scripts en package.json SIN documentar (añádelos a scripts/help.ts):${c.reset}`)
    for (const n of undocumented) console.log(`   - ${n}`)
  }
  if (stale.length > 0) {
    console.log(`${c.yellow}\n⚠  Scripts documentados que YA NO existen en package.json (bórralos de scripts/help.ts):${c.reset}`)
    for (const n of stale) console.log(`   - ${n}`)
  }
}

printHelp()
assertCoverage()
