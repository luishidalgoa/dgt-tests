"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/adminGuard"
import { setConfig } from "@/lib/appConfig"
import { CONFIG_CATALOG } from "@/lib/configCatalog"

/**
 * Server Action para actualizar una entrada de AppConfig.
 *
 * Guard:
 *   - requireAdmin() lanza notFound() (404) si no es ADMIN. Esto es
 *     la barrera principal — no se puede llamar esta función sin
 *     ser admin desde cualquier sitio (server-only).
 *
 * Validación:
 *   - La key debe existir en CONFIG_CATALOG (whitelist). Esto evita
 *     que un cliente malicioso meta keys arbitrarias en BBDD.
 *   - El value se castea al tipo declarado en el catálogo. Si el
 *     cast falla, devuelve error sin tocar BBDD.
 */
export async function updateConfigAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin()

  const key = formData.get("key")
  if (typeof key !== "string") return { ok: false, error: "key inválida" }
  const entry = CONFIG_CATALOG.find((c) => c.key === key)
  if (!entry) return { ok: false, error: `key '${key}' no está en el catálogo` }

  const rawValue = formData.get("value")
  let value: number | boolean | string
  try {
    value = coerceValue(rawValue, entry.type)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "valor inválido" }
  }

  await setConfig(key, value, { byUserId: admin.id })
  revalidatePath("/admin")
  // También revalidamos las páginas afectadas por settings comunes
  revalidatePath("/")
  revalidatePath("/settings")
  return { ok: true }
}

function coerceValue(raw: FormDataEntryValue | null, type: "number" | "boolean" | "string"): number | boolean | string {
  if (type === "boolean") {
    // Form sends "on" / "true" / "false" / "" depending on input type
    if (raw === null || raw === "" || raw === "false" || raw === "off") return false
    return true
  }
  if (type === "number") {
    const s = String(raw ?? "").trim()
    const n = Number(s)
    if (!Number.isFinite(n)) throw new Error(`'${s}' no es un número`)
    return n
  }
  // string
  return String(raw ?? "")
}
