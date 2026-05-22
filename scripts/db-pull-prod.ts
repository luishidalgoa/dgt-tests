/**
 * Descarga TODAS las tablas de la BBDD de producción (Turso) y las
 * vuelca en la BBDD de desarrollo local (SQLite via libsql), pasando
 * antes por un sanitizador opcional.
 *
 * Uso:
 *   npm run db:pull-prod                    # sanitiza users + skipea AppConfig (default)
 *   npm run db:pull-prod -- --dry-run       # solo cuenta y reporta, no escribe
 *   npm run db:pull-prod -- --raw           # NO sanitiza users (peligroso, copia hashes/emails reales)
 *   npm run db:pull-prod -- --keep-appconfig# copia tabla app_config completa (secretos incluidos, inutilizables)
 *   npm run db:pull-prod -- --no-confirm    # sáltate el "estás seguro?" — para CI
 *
 * Sanitización por defecto:
 *   - El usuario admin (ADMIN_USERNAME) se preserva tal cual.
 *   - El resto de users: email → user_{id}@example.com,
 *                       passwordHash → bcrypt("test123"),
 *                       stripeCustomerId/SubscriptionId → null.
 *
 * AppConfig por defecto se SKIPEA porque:
 *   - Los entries cifrados usan APP_MASTER_KEY de prod (distinta a local
 *     → no se podrían descifrar).
 *   - Tu config local de /admin no se pisa (FEATURE_*, AI_PROVIDER, etc.)
 *
 * El script BORRA todos los datos de la BBDD local antes de insertar.
 * Pide confirmación interactiva salvo que pases --no-confirm.
 */

import { createClient, type Client, type InValue } from "@libsql/client"
import bcrypt from "bcryptjs"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { execSync } from "node:child_process"
import { resolve, isAbsolute } from "node:path"
import { unlinkSync, existsSync } from "node:fs"

// ── Constantes de configuración ──────────────────────────────────────────

/** Usuario al que NUNCA se le sanitizan los datos (es el admin que necesita
 *  poder loguearse en local con la misma cuenta que en prod). */
const ADMIN_USERNAME = "luishidalgoa"

/** Contraseña que se establece para todos los usuarios sanitizados, para
 *  que puedas loguearte como cualquiera con esta password en local y
 *  ver el dashboard de cualquier usuario. */
const SANITIZED_PASSWORD = "test123"

/**
 * Orden de las tablas según dependencias de FK.
 *
 * - INSERT: padres primero, hijos después (ej: users antes que exam_attempts)
 * - DELETE: hijos primero, padres después (orden inverso)
 *
 * Si añades un modelo nuevo al schema, añádelo aquí en la posición correcta.
 */
const TABLES_IN_ORDER = [
  "users",
  "categories",
  "manual_sections",
  "tests",
  "questions",
  "options",
  "test_questions",
  "ai_cache_entries",
  "exam_attempts",   // antes que user_ai_paid (FK attemptId)
  "answers",          // antes que user_ai_paid (no estrictamente, pero
                      // viene después de exam_attempts por FK propia)
  "user_ai_paid",     // FKs a users, questions, exam_attempts
  "parties",
  "party_players",
  "party_answers",
] as const

type TableName = (typeof TABLES_IN_ORDER)[number]

// ── Args ────────────────────────────────────────────────────────────────

const DRY_RUN        = process.argv.includes("--dry-run")
const RAW            = process.argv.includes("--raw")
const KEEP_APPCONFIG = process.argv.includes("--keep-appconfig")
const NO_CONFIRM     = process.argv.includes("--no-confirm")

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // 1. Validar env
  const tursoUrl  = process.env.TURSO_DATABASE_URL
  const tursoTok  = process.env.TURSO_AUTH_TOKEN
  const localUrl  = process.env.DATABASE_URL
  if (!tursoUrl)  throw new Error("Falta TURSO_DATABASE_URL en .env")
  if (!tursoTok)  throw new Error("Falta TURSO_AUTH_TOKEN en .env")
  if (!localUrl)  throw new Error("Falta DATABASE_URL en .env")
  if (localUrl === tursoUrl) {
    throw new Error("DATABASE_URL == TURSO_DATABASE_URL — el local y el remoto son el mismo. Abortando.")
  }

  // 2. Banner y confirmación
  console.log(`\n📡 Origen:  ${tursoUrl}`)
  console.log(`💾 Destino: ${localUrl}`)
  console.log(`🔧 Flags:   ${[
    DRY_RUN ? "--dry-run" : null,
    RAW ? "--raw" : null,
    KEEP_APPCONFIG ? "--keep-appconfig" : null,
  ].filter(Boolean).join(" ") || "(ninguno, defaults)"}`)
  console.log(`   - Sanitizar usuarios: ${RAW ? "NO" : `SÍ (preserva ${ADMIN_USERNAME})`}`)
  console.log(`   - Copiar AppConfig:   ${KEEP_APPCONFIG ? "SÍ" : "NO"}`)

  if (!DRY_RUN && !NO_CONFIRM) {
    console.log("\n⚠  Esto BORRA todos los datos de la BBDD local.")
    const rl = createInterface({ input: stdin, output: stdout })
    const ans = (await rl.question('   Escribe "si" para continuar: ')).trim().toLowerCase()
    rl.close()
    if (ans !== "si") {
      console.log("Cancelado.")
      return
    }
  }
  console.log()

  // 3. Asegurar que el schema existe en local (idempotente).
  //    Si dev.db estaba vacío o tenía un schema viejo, `prisma db push`
  //    crea/actualiza las tablas para que coincidan con schema.prisma.
  //    --accept-data-loss porque vamos a wipe-ar todo de todas formas;
  //    --skip-generate evita regenerar @prisma/client (lento, innecesario aquí).
  console.log("\n🛠  Asegurando schema en local (prisma db push)…")
  try {
    execSync("npx prisma db push --accept-data-loss --skip-generate", {
      stdio: ["ignore", "pipe", "pipe"],
      env:   { ...process.env, DATABASE_URL: localUrl },
    })
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string }
    const out = (err.stderr?.toString() || err.stdout?.toString() || err.message || "").slice(0, 500)
    throw new Error(`prisma db push falló:\n${out}`)
  }

  // 4. Conectar a ambas BBDD.
  //    OJO: Prisma resuelve `file:./dev.db` relativo a schema.prisma (que
  //    está en prisma/), mientras que @libsql/client lo resuelve relativo
  //    al cwd. Esto crea DOS archivos distintos: dev.db (vacío, libsql) y
  //    prisma/dev.db (con schema, Prisma). Resolvemos a path absoluto
  //    usando la convención de Prisma para que ambos apunten al mismo.
  const localUrlResolved = resolveLocalDbUrlForLibsql(localUrl)
  if (localUrlResolved !== localUrl) {
    console.log(`💾 BBDD local resuelta: ${localUrlResolved}`)
    // Limpieza: si el cwd tiene un dev.db huérfano creado por intentos
    // previos, lo borramos para no confundir.
    cleanupStaleDevDb(localUrl)
  }
  const turso = createClient({ url: tursoUrl, authToken: tursoTok })
  const local = createClient({ url: localUrlResolved })

  try {
    // 5. Leer todas las tablas de Turso
    type Row = Record<string, InValue>
    const tableData = new Map<TableName, Row[]>()
    for (const t of TABLES_IN_ORDER) {
      const r = await turso.execute(`SELECT * FROM ${t}`)
      tableData.set(t, r.rows as unknown as Row[])
    }
    let appConfigRows: Row[] = []
    if (KEEP_APPCONFIG) {
      const r = await turso.execute("SELECT * FROM app_config")
      appConfigRows = r.rows as unknown as Row[]
    }

    // 6. Sanitizar usuarios
    if (!RAW) {
      const users = tableData.get("users") ?? []
      const placeholderHash = await bcrypt.hash(SANITIZED_PASSWORD, 10)
      let touched = 0
      for (const row of users) {
        if (row.username === ADMIN_USERNAME) continue
        row.email                = `user_${row.id}@example.com`
        row.passwordHash         = placeholderHash
        row.stripeCustomerId     = null
        row.stripeSubscriptionId = null
        touched++
      }
      console.log(`🔐 Sanitizados ${touched} usuarios (preservado ${ADMIN_USERNAME})`)
    }

    // 7. Reporte de filas
    console.log("\n📊 Filas a importar:")
    let total = 0
    for (const t of TABLES_IN_ORDER) {
      const n = tableData.get(t)?.length ?? 0
      console.log(`   ${t.padEnd(20)} ${String(n).padStart(6)}`)
      total += n
    }
    if (KEEP_APPCONFIG) {
      console.log(`   ${"app_config".padEnd(20)} ${String(appConfigRows.length).padStart(6)}`)
      total += appConfigRows.length
    }
    console.log(`   ${"TOTAL".padEnd(20)} ${String(total).padStart(6)}`)

    if (DRY_RUN) {
      console.log("\n📋 dry-run: no se escribe nada. Quita --dry-run para ejecutar.")
      return
    }

    // 8. WIPE + INSERT — todo con FKs OFF para no pelearnos con el orden.
    //    El schema garantiza que los datos de prod son consistentes, así
    //    que insertar sin chequeo de FK es seguro. Reactivamos al final.
    await local.execute("PRAGMA foreign_keys = OFF")

    console.log("\n🗑  Wipe de BBDD local…")
    const tablesToWipe: string[] = [...TABLES_IN_ORDER].reverse()
    if (KEEP_APPCONFIG) tablesToWipe.unshift("app_config")
    for (const t of tablesToWipe) {
      try {
        await local.execute(`DELETE FROM ${t}`)
      } catch (e) {
        console.warn(`   ⚠ ${t}: ${(e as Error).message.slice(0, 100)}`)
      }
    }

    // 9. INSERT en la BBDD local (orden natural por FK)
    console.log("📥 Insertando…")
    for (const t of TABLES_IN_ORDER) {
      const rows = tableData.get(t) ?? []
      if (rows.length === 0) {
        console.log(`   ${t.padEnd(20)} (vacía)`)
        continue
      }
      await insertRows(local, t, rows)
      console.log(`   ${t.padEnd(20)} ${String(rows.length).padStart(6)} ✅`)
    }
    if (KEEP_APPCONFIG && appConfigRows.length > 0) {
      await insertRows(local, "app_config", appConfigRows)
      console.log(`   ${"app_config".padEnd(20)} ${String(appConfigRows.length).padStart(6)} ✅`)
    }

    await local.execute("PRAGMA foreign_keys = ON")

    console.log("\n✅ Pull completado.")
    if (!RAW) {
      console.log(`💡 Para loguearte como cualquier usuario: contraseña = "${SANITIZED_PASSWORD}"`)
      console.log(`   (${ADMIN_USERNAME} mantiene su contraseña original)`)
    }
  } finally {
    turso.close()
    local.close()
  }
}

/**
 * Convierte `file:./xyz.db` relativo a un path ABSOLUTO usando la misma
 * convención que Prisma (relativo a `<project>/prisma/`). Si la URL ya
 * es absoluta o no es file:, la devuelve tal cual.
 *
 * Sin esto, `prisma db push` crea `prisma/dev.db` pero el script abre
 * `dev.db` (en cwd) y se piensa que la BBDD está vacía.
 */
function resolveLocalDbUrlForLibsql(url: string): string {
  if (!url.startsWith("file:")) return url
  const p = url.slice("file:".length)
  if (isAbsolute(p)) return url
  return `file:${resolve(process.cwd(), "prisma", p)}`
}

/**
 * Borra el dev.db huérfano que libsql pudo haber creado en cwd en runs
 * previos del script (antes de que resolviéramos al path correcto).
 * Es opcional, pero evita confusión futura.
 */
function cleanupStaleDevDb(originalUrl: string): void {
  if (!originalUrl.startsWith("file:")) return
  const p = originalUrl.slice("file:".length)
  if (isAbsolute(p)) return
  const stalePath = resolve(process.cwd(), p)
  if (existsSync(stalePath)) {
    try {
      unlinkSync(stalePath)
      console.log(`   🧹 Borrado dev.db huérfano en ${stalePath}`)
    } catch { /* no es crítico */ }
  }
}

/**
 * Inserta un batch de rows en una tabla. Construye dinámicamente los
 * placeholders según las columnas de la primera fila. Asume que TODAS
 * las rows tienen las mismas columnas (es lo normal en SQLite uniforme).
 */
async function insertRows(
  client: Client,
  table:  string,
  rows:   Record<string, InValue>[],
): Promise<void> {
  if (rows.length === 0) return
  const cols = Object.keys(rows[0])
  const placeholders = cols.map(() => "?").join(", ")
  const sql = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`

  // Insertamos en batches de 100 para evitar SQL demasiado grande en redes lentas.
  const BATCH = 100
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const stmts = chunk.map((row) => ({
      sql,
      args: cols.map((c) => row[c]),
    }))
    await client.batch(stmts, "write")
  }
}

main().catch((e) => {
  console.error("\n❌", e)
  process.exit(1)
})
