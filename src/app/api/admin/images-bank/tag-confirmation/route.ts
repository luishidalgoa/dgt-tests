import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/adminGuard"
import { getJsonFromR2, putJsonToR2, R2_META_KEYS } from "@/lib/imagesBankR2"
import type { TagConfirmationsData } from "@/app/admin/images-bank/lib"

/**
 * POST /api/admin/images-bank/tag-confirmation
 *
 * Registra (o quita) la CONFIRMACIÓN manual de un tag para una
 * imagen — el admin dice "esta imagen SÍ es de este tag".
 * Persiste en R2 bajo `meta/tag_confirmations.json`.
 *
 * Efecto:
 *   - El classifier (próximo run) BOOST el score del tag a un mínimo
 *     (NORMALIZE_BOOST_SCORE en classify_siglip.py, actualmente 0.30
 *     = entra en filtro "Calidad medio"). Si el score actual ya es
 *     >= 0.30, se respeta el valor real.
 *   - page.tsx aplica el mismo boost en runtime para feedback inmediato.
 *
 * SOLO ADMIN — requireAdmin lanza 404 si no lo es.
 *
 * Body:
 *   { sha: string, tag: string, remove?: boolean }
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

  let data: TagConfirmationsData
  try {
    const fetched = await getJsonFromR2<TagConfirmationsData>(R2_META_KEYS.tagConfirmations)
    if (fetched && typeof fetched === "object" && fetched.confirmations && typeof fetched.confirmations === "object") {
      data = fetched
    } else {
      data = { generatedAt: new Date().toISOString(), confirmations: {} }
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `R2 read failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  const current = new Set(data.confirmations[sha] ?? [])
  if (remove) {
    current.delete(tag)
  } else {
    current.add(tag)
  }
  if (current.size === 0) {
    delete data.confirmations[sha]
  } else {
    data.confirmations[sha] = Array.from(current).sort()
  }
  data.generatedAt = new Date().toISOString()

  try {
    await putJsonToR2(R2_META_KEYS.tagConfirmations, data)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `R2 write failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok:            true,
    confirmedTags: Array.from(current).sort(),
    totalShas:     Object.keys(data.confirmations).length,
  })
}

export async function GET() {
  await requireAdmin()
  try {
    const data = await getJsonFromR2<TagConfirmationsData>(R2_META_KEYS.tagConfirmations)
    if (data) return NextResponse.json(data)
    return NextResponse.json<TagConfirmationsData>({
      generatedAt:   new Date().toISOString(),
      confirmations: {},
    })
  } catch (err) {
    return NextResponse.json(
      { error: `R2 read failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
