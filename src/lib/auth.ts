import bcrypt from "bcryptjs"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getSession } from "@/lib/session"

const BCRYPT_ROUNDS = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Crea un usuario nuevo. Lanza error si el username ya existe. */
export async function createUser(username: string, password: string, displayName?: string) {
  const trimmedUser = username.trim()
  if (!trimmedUser || trimmedUser.length < 3) {
    throw new Error("El nombre de usuario debe tener al menos 3 caracteres")
  }
  if (!password || password.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres")
  }

  const existing = await db.user.findUnique({ where: { username: trimmedUser } })
  if (existing) {
    throw new Error("Ese usuario ya existe")
  }

  const passwordHash = await hashPassword(password)
  return db.user.create({
    data: {
      username:    trimmedUser,
      passwordHash,
      displayName: displayName ?? trimmedUser,
    },
  })
}

/** Comprueba credenciales y devuelve el usuario o null. */
export async function authenticate(username: string, password: string) {
  const user = await db.user.findUnique({ where: { username: username.trim() } })
  if (!user) return null
  const ok = await verifyPassword(password, user.passwordHash)
  return ok ? user : null
}

/** Devuelve el usuario logueado o null. Usar en server components / API. */
export async function getCurrentUser() {
  const session = await getSession()
  if (!session.userId) return null
  return db.user.findUnique({ where: { id: session.userId } })
}

/** Igual que getCurrentUser pero redirige a /login si no hay sesión. */
export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}
