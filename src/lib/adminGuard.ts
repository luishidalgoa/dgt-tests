/**
 * Guard de acceso al panel /admin.
 *
 * Filosofía: si el user no es ADMIN, respondemos `notFound()` (HTTP 404)
 * en lugar de redirect a login. Esto evita filtrar que la ruta existe
 * — para un user no autorizado, /admin se ve exactamente igual que una
 * URL random inventada.
 *
 * Reglas:
 *   - Llamar requireAdmin() en CADA page de /admin (no confiar solo en
 *     middleware).
 *   - Llamar requireAdmin() en CADA route handler de /api/admin.
 *   - ADMIN se asigna a mano vía `npm run user:role -- <username> ADMIN`;
 *     nunca desde la propia UI.
 */
import { notFound } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import type { User } from "@prisma/client"

/** Predicado puro testeable. */
export function isAdminUser(user: { role?: string } | null | undefined): boolean {
  return Boolean(user) && user!.role === "ADMIN"
}

/**
 * Para usar en server components y route handlers del /admin:
 *
 *   const admin = await requireAdmin()
 *
 * Si no es admin, llama a notFound() — esto throws internamente y Next.js
 * renderiza el 404. La función NUNCA devuelve para non-admins.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser()
  if (!isAdminUser(user)) {
    notFound()
  }
  // After notFound() throws, control never reaches here, but TS doesn't know.
  return user!
}
