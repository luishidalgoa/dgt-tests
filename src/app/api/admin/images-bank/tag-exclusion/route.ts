import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/adminGuard"
import { getJsonFromR2, putJsonToR2, R2_META_KEYS } from "@/lib/imagesBankR2"
import type { TagExclusionsData } from "@/app/admin/images-bank/lib"

/**
 * POST /api/admin/images-bank/tag-exclusion
 *
 * Registra (o quita) la exclusión manual de un tag para una imagen
 * concreta. Persiste en R2 bajo `meta/tag_exclusions.json`.
 *
 * El próximo run del classifier (`npm run images:classify`) lee este
 * archivo y NO emite los tags excluidos para esa SHA aunque el score
 * sea alto.
 *
 * Solo admin (requireAdmin → 404 si no lo es).
 *
 * Body:
 *   { sha: string, tag: string, remove?: boolean }
 *
 * - Sin `remove` (o false): añade la exclusión
 * - Con `remove: true`:     quita la exclusión (deshacer)
 *
 * Devuelve:
 *   { ok: true, excludedTags: string[] }  → todas las exclusiones actuales de esa SHA
 */

export const dynamic = "force-dynamic"

const schema = z.object({
  sha:    z.string().regex(/^[a-f0-9]{64}$/, "sha debe ser hex sha256 (64 chars)"),
  tag:    z.string().min(1).max(60),
  remove: z.boolean().optional().default(false),
})

export async function POST(req: NextRequest) {
  await requireAdmin()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }
  const { sha, tag, remove } = parsed.data

  // Cargar de R2 (o estructura vacía si no existe)
  let data: TagExclusionsData
  try {
    const fetched = await getJsonFromR2<TagExclusionsData>(R2_META_KEYS.tagExclusions)
    if (fetched && typeof fetched === "object" && fetched.exclusions && typeof fetched.exclusions === "object") {
      data = fetched
    } else {
      data = { generatedAt: new Date().toISOString(), exclusions: {} }
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `R2 read failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  // Mutación
  const current = new Set(data.exclusions[sha] ?? [])
  if (remove) {
    current.delete(tag)
  } else {
    current.add(tag)
  }
  if (current.size === 0) {
    // No dejar entradas vacías que ensucien el JSON
    delete data.exclusions[sha]
  } else {
    data.exclusions[sha] = Array.from(current).sort()
  }
  data.generatedAt = new Date().toISOString()

  // Persistir en R2
  try {
    await putJsonToR2(R2_META_KEYS.tagExclusions, data)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `R2 write failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok:           true,
    excludedTags: Array.from(current).sort(),
    totalShas:    Object.keys(data.exclusions).length,
  })
}

/**
 * GET /api/admin/images-bank/tag-exclusion
 *
 * Devuelve TODAS las exclusiones actuales (útil para el frontend
 * para mostrar feedback visual: "esta imagen ya fue excluida del
 * tag X manualmente").
 */
export async function GET() {
  await requireAdmin()

  try {
    const data = await getJsonFromR2<TagExclusionsData>(R2_META_KEYS.tagExclusions)
    if (data) return NextResponse.json(data)
    // No existe aún → estructura vacía
    return NextResponse.json<TagExclusionsData>({
      generatedAt: new Date().toISOString(),
      exclusions:  {},
    })
  } catch (err) {
    return NextResponse.json(
      { error: `R2 read failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
