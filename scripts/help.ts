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
      { name: "turso:sync", description: "Aplica el schema actual de Prisma a Turso" },
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
    title: "Datos y mantenimiento",
    emoji: "🛠",
    scripts: [
      { name: "ingest",            description: "Pipeline completo: seed BBDD + copy images + import manual" },
      { name: "images:copy",       description: "Copia las imágenes del banco de preguntas a /public/images" },
      { name: "images:upload-r2",  description: "Sube las imágenes a Cloudflare R2 (CDN externo)" },
      { name: "images:setup-r2",   description: "Configura el bucket R2 (CORS, dominio público, etc.)" },
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
