import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Cliente Prisma usando el adapter libSQL.
 *
 * - En local: TURSO_DATABASE_URL no está definida → apuntamos al SQLite local
 *   con ruta ABSOLUTA (file://...) porque libsql resuelve los paths relativos
 *   distinto a Prisma CLI.
 * - En Vercel: TURSO_DATABASE_URL = libsql://<algo>.turso.io
 *              TURSO_AUTH_TOKEN  = token de Turso.
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

export const db =
  global.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") global.prisma = db
