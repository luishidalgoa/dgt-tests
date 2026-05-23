/**
 * Detectores de archivos .env en el filesystem.
 *
 * Para el panel /admin/secrets queremos decir con precisión QUÉ archivo
 * está aportando cada variable, no solo ".env" en abstracto. Esto NO
 * es posible vía process.env (Node no recuerda de dónde vino cada var);
 * tenemos que leer los archivos a mano y buscar la definición.
 *
 * Solo aplica en local-dev (server-side, Node). En Vercel no hay
 * archivos .env físicos en runtime — las env vars vienen del panel.
 */

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Orden de precedencia que aplica Next.js cuando arranca en development.
 * El primero gana sobre el siguiente:
 *   .env.development.local > .env.local > .env.development > .env
 *
 * (En production, Next.js no carga `.env*.local`, pero igual los
 * incluimos para coherencia visual en local-dev.)
 */
export const ENV_FILE_PRECEDENCE = [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
] as const

interface Options {
  /** Permite override del cwd, útil en tests. Default: process.cwd(). */
  cwd?: string
}

/**
 * Lista los archivos .env que EXISTEN en el cwd, en orden de
 * precedencia (el primero gana).
 */
export function detectEnvFiles(opts: Options = {}): string[] {
  // En Vercel no hay .env files físicos (las vars vienen del panel del
  // proyecto). Early-return para que Turbopack no tracee `resolve(cwd,
  // <dynamic>)` en cada lambda. Esa trace era inofensiva pero ensuciaba
  // el bundle del lambda con el cwd entero.
  if (process.env.VERCEL === "1") return []
  const cwd = opts.cwd ?? process.cwd()
  return ENV_FILE_PRECEDENCE.filter((name) => existsSync(resolve(cwd, name)))
}

/**
 * Encuentra el archivo .env del que viene una variable concreta.
 * Recorre los archivos en orden de precedencia y devuelve el primero
 * que contiene una definición de la variable. Devuelve null si no
 * aparece en ninguno (la var puede venir del shell o no existir).
 *
 * Parser muy ligero: busca líneas tipo `VAR=...` o `VAR = ...` o
 * `export VAR=...`, ignorando comentarios y líneas vacías. NO
 * interpreta interpolaciones, no resuelve `$VAR`.
 */
export function getEnvFileForVar(varName: string, opts: Options = {}): string | null {
  // En Vercel no hay .env files físicos — ver detectEnvFiles arriba.
  if (process.env.VERCEL === "1") return null
  const cwd = opts.cwd ?? process.cwd()
  for (const name of ENV_FILE_PRECEDENCE) {
    const path = resolve(cwd, name)
    if (!existsSync(path)) continue
    let content: string
    try {
      content = readFileSync(path, "utf8")
    } catch {
      continue
    }
    if (hasVarDefinition(content, varName)) return name
  }
  return null
}

/**
 * ¿El contenido tiene una definición de varName?
 *
 * Acepta:
 *   VAR=value
 *   VAR = value
 *   VAR="value"
 *   export VAR=value
 *
 * Rechaza líneas comentadas (#) y prefijos parecidos
 * (VAR_X no matchea cuando buscamos VAR).
 */
function hasVarDefinition(content: string, varName: string): boolean {
  // Regex: opcional "export ", luego nombre EXACTO, luego espacios opt y "="
  const re = new RegExp(`^\\s*(?:export\\s+)?${escapeRegex(varName)}\\s*=`, "m")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    if (re.test(line)) return true
  }
  return false
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
