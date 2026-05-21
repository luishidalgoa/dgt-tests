import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { isTursoQuotaError, notifyTursoQuotaExceeded } from "@/lib/alerts"

/**
 * Cliente Prisma usando el adapter libSQL.
 *
 * - En local: TURSO_DATABASE_URL ausente o vacía → SQLite local
 *   (prisma/dev.db). El `.env.local` deja TURSO_DATABASE_URL="" para
 *   sobrescribir cualquier valor heredado de `.env` (que puede tener
 *   las credenciales prod para scripts puntuales como
 *   turso:apply-migration).
 * - En Vercel (prod): TURSO_DATABASE_URL=libsql://<algo>.turso.io,
 *                      TURSO_AUTH_TOKEN=eyJ...
 *
 * Cuando una query falla con un error de cuota de Turso, se dispara un
 * email de alerta (rate-limited a 1 por hora) — ver src/lib/alerts.ts.
 */

declare global {
   
  var prisma: PrismaClient | undefined
}

function buildLocalUrl(): string {
  return pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href
}

// Usamos `||` (NO `??`) a propósito: si TURSO_DATABASE_URL viene como
// string vacío (".env.local lo sobreescribe a vacío"), también caemos
// al SQLite local. Con `??` solo caería para `undefined`/`null` y
// libsql intentaría conectar con "" → boom.
const databaseUrl = process.env.TURSO_DATABASE_URL || buildLocalUrl()

const adapter = new PrismaLibSql({
  url:       databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

function makeClient() {
  const base = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })

  // Interceptamos todas las queries para detectar errores de cuota de Turso
  return base.$extends({
    query: {
      async $allOperations({ args, query, model, operation }) {
        try {
          return await query(args)
        } catch (err) {
          if (isTursoQuotaError(err)) {
            // Disparamos la alerta pero NO esperamos al envío
            // para no bloquear la respuesta al cliente
            void notifyTursoQuotaExceeded(err, `${model ?? "?"}.${operation}`)
          }
          throw err
        }
      },
    },
  })
}

// El tipo del cliente extendido es difícil de exportar como PrismaClient;
// dejamos que TypeScript infiera el tipo y usamos `typeof db` donde haga falta.
export const db = global.prisma ?? (makeClient() as unknown as PrismaClient)

if (process.env.NODE_ENV !== "production") global.prisma = db

// ── Sanity check: avisar si el cliente generado está stale ─────────────
// Listamos algunos campos que se han ido añadiendo a User. Si alguno
// falta en el modelo en runtime, es que el cliente Prisma cargado en el
// proceso Node es anterior a la última migración. Hay que regenerar.
if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userFields = (db as any)?._runtimeDataModel?.models?.User?.fields as
    | { name: string }[]
    | undefined
  const EXPECTED_USER_FIELDS = [
    "role",
    "aiTokensUsed",
    "aiTokensMonth",
    "stripeCustomerId",
    "subscriptionStatus",
    "acknowledgments",
  ]
  if (userFields) {
    const present = new Set(userFields.map((f) => f.name))
    const missing = EXPECTED_USER_FIELDS.filter((f) => !present.has(f))
    if (missing.length > 0) {
       
      console.warn(
        [
          "",
          "──────────────────────────────────────────────────────────────",
          "⚠  PRISMA CLIENT STALE",
          "──────────────────────────────────────────────────────────────",
          `Faltan los campos: ${missing.join(", ")}`,
          "",
          "El proceso de Node tiene cargada una versión vieja del cliente",
          "Prisma. La migración ya está aplicada en la BBDD pero hay que",
          "regenerar el cliente y reiniciar el dev server:",
          "",
          "  1. Para el dev server (Ctrl+C en su terminal)",
          "  2. npx prisma generate",
          "  3. npm run dev",
          "",
          "Mientras tanto, los endpoints que tocan estos campos darán 500.",
          "──────────────────────────────────────────────────────────────",
          "",
        ].join("\n")
      )
    }
  }
}
