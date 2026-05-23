import bcrypt from "bcryptjs"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"
import { identifyUserInSentry } from "@/lib/sentryUser"

const BCRYPT_ROUNDS = 10

/**
 * Convención: username y email se guardan SIEMPRE en minúscula en la BBDD
 * (canonical form). Para mostrar al usuario se usa `displayName`, que sí
 * conserva el casing original. Esto evita confusión "luis vs Luis vs LUIS"
 * y permite login case-insensitive trivialmente.
 */

const USERNAME_REGEX = /^[a-z0-9_.-]+$/

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase()
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/**
 * Crea un usuario nuevo. Lanza error si username o email ya existen.
 */
export async function createUser(opts: {
  username:     string
  password:     string
  email:        string
  displayName?: string
}) {
  const username = normalizeUsername(opts.username)
  const email    = normalizeEmail(opts.email)

  if (!username || username.length < 3) {
    throw new Error("El nombre de usuario debe tener al menos 3 caracteres")
  }
  if (!USERNAME_REGEX.test(username)) {
    throw new Error("El usuario solo puede contener letras minúsculas, números, _ . -")
  }
  if (!opts.password || opts.password.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres")
  }
  if (!email || !email.includes("@")) {
    throw new Error("Email no válido")
  }

  const existingByUsername = await db.user.findUnique({ where: { username } })
  if (existingByUsername) {
    throw new Error("Ese nombre de usuario ya está en uso")
  }
  const existingByEmail = await db.user.findUnique({ where: { email } })
  if (existingByEmail) {
    throw new Error("Ese email ya está asociado a otra cuenta")
  }

  const passwordHash = await hashPassword(opts.password)
  return db.user.create({
    data: {
      username,
      email,
      passwordHash,
      displayName: opts.displayName?.trim() || username,
    },
  })
}

/**
 * Comprueba credenciales y devuelve el usuario o null.
 *
 * `identifier` puede ser un email (contiene "@") o un username. La búsqueda
 * es case-insensitive porque ambos campos están guardados en minúscula y
 * normalizamos el input antes de buscar.
 */
export async function authenticate(identifier: string, password: string) {
  const trimmed = identifier.trim()
  if (!trimmed) return null

  const user = trimmed.includes("@")
    ? await db.user.findUnique({ where: { email: normalizeEmail(trimmed) } })
    : await db.user.findUnique({ where: { username: normalizeUsername(trimmed) } })

  if (!user) return null
  const ok = await verifyPassword(password, user.passwordHash)
  return ok ? user : null
}

/** Devuelve el usuario logueado o null. Usar en server components / API.
 *
 * Side-effect: asocia el user al scope de Sentry para que cualquier error
 * capturado durante este request quede correlacionado en el dashboard.
 * Si el user es null (request anónimo), limpiamos el scope. */
export async function getCurrentUser() {
  const session = await getSession()
  if (!session.userId) {
    identifyUserInSentry(null)
    return null
  }
  const user = await db.user.findUnique({ where: { id: session.userId } })
  if (user) {
    identifyUserInSentry({ id: user.id, username: user.username })
  } else {
    identifyUserInSentry(null)
  }
  return user
}

/** Igual que getCurrentUser pero redirige a /login si no hay sesión. */
export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}
