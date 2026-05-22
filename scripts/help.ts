/**
 * Lista descriptiva de todos los `npm run *` del proyecto, agrupados
 * por categoría, con ejemplos de uso.
 *
 * Se invoca con `npm run help` (o `npm run ?`).
 *
 * Por qué no usar `npm run` directo: npm no permite descripciones por
 * script en package.json. Este help las define en código TypeScript,
 * lo cual además permite verificar contra el package.json real que no
 * se nos cuela ninguno sin documentar (assertCoverage al final).
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// ── Colores ANSI (solo si stdout es TTY) ─────────────────────────────

const useColor = Boolean(process.stdout.isTTY)
const c = {
  reset:  useColor ? "\x1b[0m"  : "",
  bold:   useColor ? "\x1b[1m"  : "",
  dim:    useColor ? "\x1b[2m"  : "",
  cyan:   useColor ? "\x1b[36m" : "",
  green:  useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  magenta:useColor ? "\x1b[35m" : "",
  gray:   useColor ? "\x1b[90m" : "",
}

// ── Catálogo ────────────────────────────────────────────────────────

interface ScriptDef {
  /** Nombre del script en package.json. Debe existir. */
  name:        string
  /** Una línea descriptiva (ideal < 80 chars). */
  description: string
  /** Ejemplos de uso. Si tiene flags útiles, lístalos. */
  examples?:   string[]
}

interface Category {
  title:   string
  emoji:   string
  scripts: ScriptDef[]
}

const CATEGORIES: Category[] = [
  {
    title: "Desarrollo",
    emoji: "🚀",
    scripts: [
      {
        name:        "dev",
        description: "Arranca el servidor de desarrollo en http://localhost:4321",
        examples:    ["npm run dev"],
      },
      {
        name:        "dev:reset",
        description: "Regenera Prisma client (úsalo si dev grita 'client out of date')",
      },
      {
        name:        "build",
        description: "Build de producción (regenera Prisma + Next build)",
      },
      {
        name:        "start",
        description: "Server de producción (después de un build)",
      },
      {
        name:        "lint",
        description: "ESLint sobre todo el proyecto",
      },
      {
        name:        "test",
        description: "Suite de tests completa (vitest --run)",
      },
      {
        name:        "test:watch",
        description: "Tests en modo watch (re-ejecuta al cambiar)",
      },
      {
        name:        "test:ui",
        description: "Vitest UI en el navegador (más visual)",
      },
    ],
  },
  {
    title: "Base de datos (local — SQLite)",
    emoji: "💾",
    scripts: [
      {
        name:        "db:push",
        description: "Aplica schema.prisma a la BBDD local sin crear migración",
      },
      {
        name:        "db:seed",
        description: "Carga preguntas, categorías y tests iniciales desde el JSON",
      },
      {
        name:        "db:reset",
        description: "⚠ Reset completo + seed (BORRA todos los datos locales)",
      },
      {
        name:        "db:pull-prod",
        description: "Descarga la BBDD de prod (Turso) → local (sanitizada por defecto)",
        examples: [
          "npm run db:pull-prod                  # con confirmación interactiva",
          "npm run db:pull-prod -- --dry-run     # solo cuenta, no escribe",
          "npm run db:pull-prod -- --no-confirm  # sin prompt",
          "npm run db:pull-prod -- --raw         # ⚠ NO sanitiza (passwords/emails reales)",
        ],
      },
    ],
  },
  {
    title: "Base de datos (producción — Turso)",
    emoji: "🌍",
    scripts: [
      {
        name:        "turso:init",
        description: "Inicializa el schema en la BBDD Turso desde cero",
      },
      {
        name:        "turso:sync",
        description: "Aplica el schema actual de Prisma a Turso",
      },
      {
        name:        "turso:apply-migration",
        description: "Aplica una migración SQL concreta a Turso",
        examples:    ["npm run turso:apply-migration -- 20260522190000_add_ai_question_fields"],
      },
      {
        name:        "turso:sync-ai-questions",
        description: "Sube solo las preguntas IA locales que aún no estén en Turso",
        examples: [
          "npm run turso:sync-ai-questions             # sube las que faltan",
          "npm run turso:sync-ai-questions -- --dry-run",
        ],
      },
    ],
  },
  {
    title: "Manual del temario · Índice",
    emoji: "📚",
    scripts: [
      {
        name:        "manual:import",
        description: "Importa secciones del manual (PDF flipbook + indice.json)",
      },
      {
        name:        "manual:extract-skeleton",
        description: "Regenera src/data/manualIndice.json (modo merge: preserva títulos)",
        examples:    ["npm run manual:extract-skeleton"],
      },
      {
        name:        "manual:infer-titles",
        description: "Rellena títulos vacíos del índice con IA (Groq por defecto)",
        examples: [
          "npm run manual:infer-titles                                   # default (Groq)",
          "npm run manual:infer-titles -- --dry-run --limit 5            # preview",
          "npm run manual:infer-titles -- --provider gemini              # otro provider",
          "npm run manual:infer-titles -- --provider groq --model mixtral-8x7b-32768",
        ],
      },
      {
        name:        "questions:generate",
        description: "Genera preguntas tipo-DGT con IA en sub-bloques con pocas preguntas",
        examples: [
          "npm run questions:generate                                    # 60 preg, 3 por sub-bloque, Groq",
          "npm run questions:generate -- --count 30 --per-block 3        # menos preguntas",
          "npm run questions:generate -- --provider gemini --dry-run     # preview sin escribir",
          "# Después: revísalas en http://localhost:4321/admin/review-questions",
        ],
      },
    ],
  },
  {
    title: "Usuarios",
    emoji: "👤",
    scripts: [
      {
        name:        "user:seed",
        description: "Crea el usuario admin inicial (luishidalgoa) en local",
      },
      {
        name:        "user:role",
        description: "Cambia el rol de un usuario en LOCAL",
        examples:    ["npm run user:role -- luishidalgoa ADMIN"],
      },
      {
        name:        "user:role:prod",
        description: "⚠ Cambia el rol de un usuario en PRODUCCIÓN (Turso)",
        examples:    ["npm run user:role:prod -- luishidalgoa ADMIN"],
      },
      {
        name:        "user:fake-subscribe",
        description: "Marca un user como SUBSCRIBER sin pasar por Stripe (debug)",
      },
      {
        name:        "user:lowercase",
        description: "Normaliza todos los usernames a minúsculas (one-shot)",
      },
      {
        name:        "user:clear-stripe",
        description: "Limpia los campos stripeCustomerId/SubscriptionId de un user",
      },
    ],
  },
  {
    title: "Stripe (suscripciones)",
    emoji: "💳",
    scripts: [
      {
        name:        "stripe:check",
        description: "Verifica conexión + API key de Stripe",
      },
      {
        name:        "stripe:sync-user",
        description: "Reconcilia el estado de un user con Stripe (rol, fechas, etc.)",
      },
      {
        name:        "stripe:setup-test",
        description: "Configura productos/prices de TEST en tu cuenta Stripe local",
      },
      {
        name:        "stripe:audit",
        description: "Audita customers huérfanos en Stripe (cus_* sin user en BBDD)",
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
      {
        name:        "ingest",
        description: "Pipeline completo: seed BBDD + copy images + import manual",
      },
      {
        name:        "images:copy",
        description: "Copia las imágenes del banco de preguntas a /public/images",
      },
      {
        name:        "attempts:cleanup-orphan",
        description: "Borra exam_attempts sin answers (intentos abandonados)",
      },
      {
        name:        "user-ai-paid:backfill",
        description: "Marca como ya pagadas las explicaciones IA pre-Fase 79",
      },
      {
        name:        "questions:tag-tiers",
        description: "Etiqueta preguntas con tier FREE/PRO según reglas",
      },
      {
        name:        "dev:prepare-test-user",
        description: "Crea un user de test limpio (para flujos E2E)",
      },
      {
        name:        "dev:send-test-email",
        description: "Envía un email de prueba via Gmail SMTP",
      },
    ],
  },
]

// ── Render ──────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`\n${c.bold}📜 Comandos disponibles · DGT Tests${c.reset}`)
  console.log(`${c.gray}   Ejecuta con: ${c.reset}${c.cyan}npm run <comando>${c.reset}\n`)

  for (const cat of CATEGORIES) {
    console.log(`${c.bold}${cat.emoji}  ${cat.title}${c.reset}`)
    for (const s of cat.scripts) {
      const namePad = s.name.padEnd(28)
      console.log(`   ${c.green}${namePad}${c.reset}${s.description}`)
      if (s.examples) {
        for (const ex of s.examples) {
          console.log(`   ${c.gray}                            ↳ ${ex}${c.reset}`)
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
