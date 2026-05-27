import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/adminGuard"
import {
  getJsonFromR2,
  putJsonToR2,
  R2_META_KEYS,
  type ManualTag,
  type ManualTagsData,
} from "@/lib/imagesBankR2"

/**
 * POST   /api/admin/images-bank/manual-tag  · añadir tag manual
 * DELETE /api/admin/images-bank/manual-tag  · eliminar tag manual
 *
 * Tag manual = etiqueta asignada DIRECTAMENTE por el admin a una imagen,
 * sin pasar por el classifier. Pueden ser labels conocidos (en LABELS.py)
 * o ids inventados (futuros descubrimientos). Se persisten en R2 (meta/
 * manual_tags.json) y los lee el frontend para mostrarlos como tags con
 * badge "M" sobre la card. El clasificador en su próximo run los usa
 * como prototipos kNN positivos para reforzar al modelo.
 *
 * El campo `reason` (opcional) es la justificación libre del admin —
 * útil para el LLM en few-shot prompts: "esta imagen es trailer porque
 * 'se ve un camión con remolque al fondo'".
 */

export const dynamic = "force-dynamic"

const TAG_ID_REGEX = /^[a-z][a-z0-9_-]{1,40}$/  // mismo formato que labels.py

// ── POST ──────────────────────────────────────────────────────────────

const postSchema = z.object({
  sha:    z.string().regex(/^[a-f0-9]{64}$/, "sha debe ser hex sha256 (64 chars)"),
  tag:    z.string().regex(TAG_ID_REGEX, "tag debe ser lowercase letters/digits/_- (1-40 chars)"),
  reason: z.string().max(500, "reason demasiado largo (máx 500 chars)").optional(),
})

export async function POST(req: NextRequest) {
  const admin = await requireAdmin()
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido" }, { status: 400 })
  }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }
  const { sha, tag, reason } = parsed.data

  // Trim reason — si llega solo con espacios, lo tratamos como ausente.
  const trimmedReason = reason?.trim()
  const effectiveReason = trimmedReason && trimmedReason.length > 0 ? trimmedReason : undefined

  // ── Leer registry ────────────────────────────────────────────────
  let registry: ManualTagsData
  try {
    const existing = await getJsonFromR2<ManualTagsData>(R2_META_KEYS.manualTags)
    registry = existing ?? { version: 1, entries: {} }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `No se pudo leer manual_tags.json: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }

  const list = registry.entries[sha] ?? []
  const existingEntry = list.find((e) => e.tag === tag)

  if (existingEntry) {
    // Dedup: si ya está, pero el admin pasó un `reason` nuevo, lo actualizamos
    // (caso: añadió el tag rápido sin explicar, vuelve y rellena el por qué).
    let updated = false
    if (effectiveReason && existingEntry.reason !== effectiveReason) {
      existingEntry.reason     = effectiveReason
      existingEntry.assignedAt = new Date().toISOString()
      existingEntry.assignedBy = admin.username
      updated = true
    }
    if (updated) {
      try {
        await putJsonToR2(R2_META_KEYS.manualTags, registry)
      } catch (err) {
        return NextResponse.json(
          { ok: false, error: `R2 write failed: ${err instanceof Error ? err.message : err}` },
          { status: 500 },
        )
      }
    }
    return NextResponse.json({
      ok:               true,
      dedup:            true,
      updated,
      totalForSha:      list.length,
      tagsForSha:       list.map((e) => e.tag),
    })
  }

  // ── Append nueva entry ───────────────────────────────────────────
  const entry: ManualTag = {
    tag,
    assignedAt: new Date().toISOString(),
    assignedBy: admin.username,
    reason:     effectiveReason,
  }
  registry.entries[sha] = [...list, entry]

  try {
    await putJsonToR2(R2_META_KEYS.manualTags, registry)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `R2 write failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok:           true,
    dedup:        false,
    totalForSha:  registry.entries[sha].length,
    tagsForSha:   registry.entries[sha].map((e) => e.tag),
  })
}

// ── DELETE ────────────────────────────────────────────────────────────

const deleteSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{64}$/),
  tag: z.string().regex(TAG_ID_REGEX),
})

export async function DELETE(req: NextRequest) {
  await requireAdmin()
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido" }, { status: 400 })
  }
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }
  const { sha, tag } = parsed.data

  let registry: ManualTagsData
  try {
    const existing = await getJsonFromR2<ManualTagsData>(R2_META_KEYS.manualTags)
    registry = existing ?? { version: 1, entries: {} }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `No se pudo leer manual_tags.json: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }

  const list = registry.entries[sha] ?? []
  const filtered = list.filter((e) => e.tag !== tag)
  if (filtered.length === list.length) {
    // No estaba — 200 OK silencioso, no es error
    return NextResponse.json({
      ok:          true,
      removed:     false,
      totalForSha: list.length,
      tagsForSha:  list.map((e) => e.tag),
    })
  }

  if (filtered.length === 0) {
    // No quedan más manual_tags para este sha — quitamos la entry entera
    // para que el JSON no acumule arrays vacíos a perpetuidad.
    delete registry.entries[sha]
  } else {
    registry.entries[sha] = filtered
  }

  try {
    await putJsonToR2(R2_META_KEYS.manualTags, registry)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `R2 write failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok:           true,
    removed:      true,
    totalForSha:  filtered.length,
    tagsForSha:   filtered.map((e) => e.tag),
  })
}
