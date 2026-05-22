"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/adminGuard"
import { setSecretConfig } from "@/lib/appConfig"
import { db } from "@/lib/db"
import { SECRET_CATALOG } from "@/lib/secretCatalog"

type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Actualiza (o crea) un secret cifrado en AppConfig.
 *
 * Guard:
 *   - requireAdmin() → 404 si no es ADMIN
 *   - whitelist contra SECRET_CATALOG (no se aceptan keys arbitrarias)
 *
 * El value llega en plaintext desde el formulario, se cifra con
 * setSecretConfig (AES-256-GCM con APP_MASTER_KEY) antes de tocar BBDD.
 *
 * Tras OK revalidamos /admin/secrets para que la UI muestre el nuevo
 * estado ("configurado" / mask actualizado).
 */
export async function updateSecretAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()

  const key = formData.get("key")
  if (typeof key !== "string") return { ok: false, error: "key inválida" }
  if (!SECRET_CATALOG.find((s) => s.key === key)) {
    return { ok: false, error: `key '${key}' no está en el catálogo de secretos` }
  }

  const value = formData.get("value")
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: "El valor del secret no puede estar vacío" }
  }

  await setSecretConfig(key, value, { byUserId: admin.id })
  revalidatePath("/admin/secrets")
  return { ok: true }
}

/**
 * Borra un secret de AppConfig. El runtime caerá al env var (si lo hay).
 *
 * Útil para "des-overridear" un secret y volver a usar el de Vercel.
 */
export async function deleteSecretAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const key = formData.get("key")
  if (typeof key !== "string") return { ok: false, error: "key inválida" }
  if (!SECRET_CATALOG.find((s) => s.key === key)) {
    return { ok: false, error: `key '${key}' no está en el catálogo` }
  }

  // Solo borramos si existe — delete a no existente tiraría error en
  // Prisma. Usamos deleteMany para que sea idempotente.
  await db.appConfig.deleteMany({ where: { key, encrypted: true } })
  revalidatePath("/admin/secrets")
  return { ok: true }
}
