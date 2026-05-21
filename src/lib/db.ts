import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { isTursoQuotaError, notifyTursoQuotaExceeded } from "@/lib/alerts"

/**
 * Cliente Prisma usando el adapter libSQL.
 *
 * - En local: TURSO_DATABASE_URL no está definida → apuntamos al SQLite local
 *   con ruta ABSOLUTA (file://...) porque libsql resuelve los paths relativos
 *   distinto a Prisma CLI.
 * - En Vercel: TURSO_DATABASE_URL = libsql://<algo>.turso.io
 *              TURSO_AUTH_TOKEN  = token de Turso.
 *
 * Cuando una query falla con un error de cuota de Turso, se dispara un
 * email de alerta (rate-limited a 1 por hora) — ver src/lib/alerts.ts.
 */

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

function buildLocalUrl(): string {
  return pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href
}

const databaseUrl = process.env.TURSO_DATABASE_URL ?? buildLocalUrl()

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
