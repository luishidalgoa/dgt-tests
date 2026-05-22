/**
 * Helpers para leer/escribir AppConfig (panel admin).
 *
 * Dos APIs:
 *   - getConfig/setConfig: valores tipados, guardados como JSON plano
 *     (números, strings, booleans, objetos…). NO confidenciales.
 *   - getSecretConfig/setSecretConfig: strings que se cifran con
 *     AES-256-GCM via APP_MASTER_KEY antes de tocar BBDD. Pensado
 *     para API keys.
 *
 * Diseño:
 *   - get* devuelve un default razonable si la key no existe o si
 *     el JSON/envelope está corrupto (no rompe la app en caliente).
 *   - set* hace upsert por key + registra updatedBy.
 *   - listAllConfig devuelve metadata (key, encrypted, updatedAt,
 *     updatedBy) sin desencriptar valores — para el panel admin que
 *     muestra el estado pero NUNCA expone secretos al render.
 */
import { db } from "@/lib/db"
import { encryptSecret, decryptSecret } from "@/lib/crypto"

// ── No-secret config (JSON tipado) ──────────────────────────────────

export async function getConfig<T>(key: string, defaultValue: T): Promise<T> {
  const row = await db.appConfig.findUnique({ where: { key } })
  if (!row) return defaultValue
  try {
    return JSON.parse(row.value) as T
  } catch {
    // Valor en BBDD corrupto — devolvemos default para no romper
    console.warn(`[appConfig] valor inválido para key='${key}', usando default`)
    return defaultValue
  }
}

export interface SetConfigOpts {
  /** Id del admin que hace el cambio (para audit). */
  byUserId: number
}

export async function setConfig<T>(
  key: string,
  value: T,
  opts: SetConfigOpts
): Promise<void> {
  const serialized = JSON.stringify(value)
  await db.appConfig.upsert({
    where:  { key },
    create: { key, value: serialized, encrypted: false, updatedBy: opts.byUserId },
    update: {       value: serialized, encrypted: false, updatedBy: opts.byUserId },
  })
}

// ── Secret config (string cifrado) ──────────────────────────────────

/**
 * Devuelve el plaintext del secret, o null si no existe o está corrupto.
 * NUNCA lanza — el caller decide qué hacer con null (fallback a env, etc.).
 */
export async function getSecretConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  if (!row || !row.encrypted) return null
  try {
    return decryptSecret(row.value)
  } catch (err) {
    console.warn(`[appConfig] no pude desencriptar '${key}':`, err instanceof Error ? err.message : err)
    return null
  }
}

export async function setSecretConfig(
  key: string,
  plaintext: string,
  opts: SetConfigOpts
): Promise<void> {
  const envelope = encryptSecret(plaintext)
  await db.appConfig.upsert({
    where:  { key },
    create: { key, value: envelope, encrypted: true, updatedBy: opts.byUserId },
    update: {       value: envelope, encrypted: true, updatedBy: opts.byUserId },
  })
}

// ── Listado para el panel admin (sin desencriptar) ──────────────────

export interface AppConfigSummary {
  key:       string
  encrypted: boolean
  updatedAt: Date
  updatedBy: number | null
  /** Solo presente para configs NO encriptadas. */
  value?:    unknown
  /** Solo para encrypted=true. Indica si hay algún valor guardado. */
  hasValue?: boolean
}

/**
 * Lista TODAS las entradas de AppConfig. Para non-secret, incluye el
 * valor parseado. Para secret, SOLO indica que existe (hasValue=true)
 * sin desencriptar. Garantía: ningún plaintext de secret sale de aquí.
 */
export async function listAllConfig(): Promise<AppConfigSummary[]> {
  const rows = await db.appConfig.findMany({
    orderBy: { key: "asc" },
  })
  return rows.map((r) => {
    if (r.encrypted) {
      return {
        key:       r.key,
        encrypted: true,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
        hasValue:  Boolean(r.value),
      }
    }
    // No-secret: incluimos el valor parseado
    let value: unknown = null
    try { value = JSON.parse(r.value) } catch { value = null }
    return {
      key:       r.key,
      encrypted: false,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
      value,
    }
  })
}
