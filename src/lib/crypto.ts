/**
 * Cifrado simétrico para secretos guardados en BBDD (AppConfig.value
 * cuando `encrypted=true`).
 *
 * Algoritmo: AES-256-GCM
 *   - Confidencialidad: AES-256 fuerte
 *   - Integridad: el authTag detecta cualquier manipulación del cipher
 *   - IV aleatorio por llamada (mismo plaintext + misma key → cipher
 *     distinto cada vez)
 *
 * Envelope guardado: "iv:authTag:ciphertext" en base64. Tres partes
 * para que cualquier driver libsql/SQLite lo trate como string normal.
 *
 * La key maestra vive en `APP_MASTER_KEY` (env var), 32 bytes en
 * base64. Si se pierde, los secretos cifrados son irrecuperables —
 * tendrías que volver a meter las API keys a mano. Para generar una
 * nueva: `generateMasterKey()` o `openssl rand -base64 32`.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto"

const ALGORITHM = "aes-256-gcm" as const
const IV_LENGTH = 12      // recomendado para GCM
const KEY_LENGTH = 32     // AES-256 = 32 bytes

function loadMasterKey(): Buffer {
  const raw = process.env.APP_MASTER_KEY
  if (!raw) {
    throw new Error("APP_MASTER_KEY no está definida en el entorno")
  }
  const key = Buffer.from(raw, "base64")
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `APP_MASTER_KEY debe ser 32 bytes en base64 (${KEY_LENGTH * 4 / 3} chars). ` +
      `Recibidos ${key.length} bytes.`
    )
  }
  return key
}

/**
 * Cifra una cadena con AES-256-GCM y devuelve el envelope
 * `iv:authTag:ciphertext` en base64.
 *
 * Lanza si APP_MASTER_KEY no está bien configurada.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadMasterKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":")
}

/**
 * Descifra un envelope producido por encryptSecret(). Lanza si:
 *   - El formato no es válido
 *   - APP_MASTER_KEY no coincide con la que cifró
 *   - El authTag falla (envelope manipulado)
 */
export function decryptSecret(envelope: string): string {
  const parts = envelope.split(":")
  if (parts.length !== 3) {
    throw new Error("Envelope inválido: esperaba 'iv:authTag:ciphertext' base64")
  }
  const [ivB64, tagB64, ctB64] = parts
  if (!ivB64 || !tagB64) {
    throw new Error("Envelope inválido: iv o authTag vacíos")
  }
  const key = loadMasterKey()
  const iv = Buffer.from(ivB64, "base64")
  const authTag = Buffer.from(tagB64, "base64")
  const ciphertext = Buffer.from(ctB64, "base64")

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  // .final() tira si el authTag no coincide → integridad garantizada
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString("utf8")
}

/**
 * Genera una nueva MASTER_KEY aleatoria en base64. Útil para bootstrap
 * inicial o rotación. Imprimir y guardar en .env como APP_MASTER_KEY.
 *
 * Equivalente CLI:  openssl rand -base64 32
 */
export function generateMasterKey(): string {
  return randomBytes(KEY_LENGTH).toString("base64")
}
