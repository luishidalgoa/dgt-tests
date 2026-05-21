import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { isAdmin } from "@/lib/permissions"
import { getQuotaStatus } from "@/lib/aiQuota"

/**
 * POST /api/users/me/refill-tokens
 *
 * Solo ADMIN: resetea aiTokensUsed a 0 para el usuario logueado.
 * Útil cuando el admin se ha quedado sin tokens y necesita seguir
 * usando la IA en tareas administrativas/test.
 *
 * Devuelve la quota actualizada.
 */
export async function POST() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Solo los admins pueden recargar tokens" }, { status: 403 })
  }

  await db.user.update({
    where: { id: user.id },
    data:  { aiTokensUsed: 0 },
  })

  const quota = await getQuotaStatus(user.id)
  return NextResponse.json({ ok: true, quota })
}
