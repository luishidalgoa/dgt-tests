import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"
import { requireAdmin } from "@/lib/adminGuard"
import { getJsonFromR2, R2_META_KEYS } from "@/lib/imagesBankR2"
import type { BankApiPayload } from "@/app/admin/images-bank/lib"

/**
 * GET /api/admin/images-bank/data
 *
 * Devuelve el snapshot completo del banco de imágenes que necesita el
 * `ImageBankPicker` (componente cliente).
 *
 * Fuentes de datos:
 *   - R2 (bucket): classification.json, sha-audit.json, discovered_labels.json,
 *     tag_exclusions.json, tag_confirmations.json. Bajo prefix `meta/`.
 *   - Filesystem local: lista de archivos en public/images/ + mtime,
 *     usado solo en local dev (en prod este array sale vacío y la UI
 *     resuelve los nombres directamente del classification.json).
 *
 * Solo admin (requireAdmin → 404 si no lo es).
 *
 * Performance: 5 GetObject paralelos a R2 → ~80-300ms desde Vercel. Para
 * un panel admin es aceptable. Si llegase a doler, meter cache in-memory
 * con TTL corto (5s) — la mayoría de cargas son back-to-back del mismo
 * admin navegando.
 */

export const dynamic = "force-dynamic"

const IMAGES_DIR = path.join(process.cwd(), "public", "images")

export async function GET() {
  await requireAdmin()

  try {
    // 5 GetObject en paralelo. classification y audit son obligatorios;
    // los otros 3 son tolerantes a no-existir (estructura vacía).
    const [classification, audit, discovered, exclData, confData, existingFilesMtime] = await Promise.all([
      getJsonFromR2<BankApiPayload["classification"]>(R2_META_KEYS.classification),
      getJsonFromR2<BankApiPayload["audit"]>(R2_META_KEYS.shaAudit),
      getJsonFromR2<BankApiPayload["discovered"]>(R2_META_KEYS.discoveredLabels),
      getJsonFromR2<{ generatedAt: string; exclusions: Record<string, string[]> }>(R2_META_KEYS.tagExclusions),
      getJsonFromR2<{ generatedAt: string; confirmations: Record<string, string[]> }>(R2_META_KEYS.tagConfirmations),
      loadFilesMtime(IMAGES_DIR),
    ])

    if (!classification || !audit) {
      return NextResponse.json(
        {
          error: "Faltan JSONs base en R2 (classification.json / sha-audit.json)",
          hint:  "Corre `npm run images:upload-metadata` después de generar los JSONs en local.",
        },
        { status: 500 },
      )
    }

    const payload: BankApiPayload = {
      classification,
      audit,
      discovered:         discovered ?? null,
      existingFilesMtime,
      tagExclusions:      exclData?.exclusions    ?? {},
      tagConfirmations:   confData?.confirmations ?? {},
    }

    return NextResponse.json(payload)
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load image bank data",
        hint:  "¿Variables R2_* configuradas? Si es primera vez, corre `npm run images:upload-metadata`.",
      },
      { status: 500 },
    )
  }
}

/**
 * Lista todos los archivos de `dir` y devuelve {filename: mtimeMs}.
 * Si la carpeta no existe devuelve {} (caso prod sin /public/images/).
 *
 * Coste: 1 readdir + N stat. Para ~3000 archivos en SSD <100ms.
 */
async function loadFilesMtime(dir: string): Promise<Record<string, number>> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return {}
  }
  const out: Record<string, number> = {}
  await Promise.all(entries.map(async (name) => {
    try {
      const st = await fs.stat(path.join(dir, name))
      out[name] = st.mtimeMs
    } catch {
      // Archivo desapareció entre readdir y stat — ignoramos.
    }
  }))
  return out
}
