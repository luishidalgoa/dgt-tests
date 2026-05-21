/**
 * Lógica pura para cambiar el role de un usuario. Sin I/O directa: recibe
 * un cliente Prisma (o mock) y devuelve un resultado discriminado.
 *
 * Vive en src/lib/ (no en scripts/) para que vitest lo pille por el
 * `include` del config y para que se pueda reutilizar desde un endpoint
 * admin en el futuro.
 */

export const VALID_ROLES = ["USER", "SUBSCRIBER", "ADMIN"] as const
export type Role = (typeof VALID_ROLES)[number]

export function parseRoleArg(raw: string): { role: Role } | { error: string } {
  const role = raw.toUpperCase() as Role
  if (!VALID_ROLES.includes(role)) {
    return { error: `Rol inválido '${raw}'. Usa uno de: ${VALID_ROLES.join(", ")}` }
  }
  return { role }
}

/** Cliente Prisma mínimo que necesitamos. Tipado liviano para tests. */
export interface UserRoleDb {
  user: {
    findUnique: (args: { where: { username: string } }) => Promise<{
      id:       number
      username: string
      role:     string
    } | null>
    update: (args: {
      where: { username: string }
      data:  { role: Role }
    }) => Promise<{ id: number; username: string; role: string }>
  }
}

export type SetRoleResult =
  | { ok: true;  user: { id: number; username: string; role: string } }
  | { ok: false; error: string }

export async function setUserRole(
  db: UserRoleDb,
  username: string,
  role: Role
): Promise<SetRoleResult> {
  // Re-validar el role (defensa por si llaman sin parseRoleArg antes)
  const parsed = parseRoleArg(role)
  if ("error" in parsed) return { ok: false, error: parsed.error }

  const existing = await db.user.findUnique({ where: { username } })
  if (!existing) {
    return { ok: false, error: `No existe el usuario '${username}'` }
  }

  const updated = await db.user.update({
    where: { username },
    data:  { role: parsed.role },
  })
  return { ok: true, user: updated }
}
