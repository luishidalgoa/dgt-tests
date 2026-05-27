import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/adminGuard"
import { getJsonFromR2, R2_META_KEYS } from "@/lib/imagesBankR2"
import { LABEL_METADATA } from "@/app/admin/images-bank/labelMetadata"
import {
  findFromAllProviders,
  getProviderByName,
  getAllProviders,
  type Candidate,
  type ImageType,
} from "@/lib/reverseImageSearch"

/**
 * POST /api/admin/images-bank/find-replacements
 *
 * Busca candidatos de reemplazo para una imagen del banco usando reverse
 * image search (estilo Google Lens). Backend: stock APIs gratis con keyword
 * del tag confident principal de la imagen.
 *
 * Si tienes múltiples providers configurados (PIXABAY_API_KEY +
 * PEXELS_API_KEY + UNSPLASH_ACCESS_KEY), por defecto AGREGA resultados
 * de todos en round-robin. Para forzar uno solo, pasa `providerName`.
 *
 * Body:
 *   {
 *     sha:           string               // SHA-256 de la imagen original
 *     max?:          number               // máx candidatos (default 12)
 *     imageType?:    "photo" | "illustration" | "vector" | "any"
 *     providerName?: "pixabay" | "pexels" | "unsplash"  // si quieres forzar uno
 *     keyword?:      string               // override del tag automático
 *   }
 *
 * Response:
 *   { ok: true, candidates: Candidate[], keyword: string, providersUsed: string[] }
 */

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  sha:          z.string().regex(/^[a-f0-9]{64}$/, "sha debe ser hex sha256 (64 chars)"),
  max:          z.number().int().min(1).max(50).optional(),
  imageType:    z.enum(["photo", "illustration", "vector", "any"]).optional(),
  providerName: z.enum(["pixabay", "pexels", "unsplash", "serpapi"]).optional(),
  keyword:      z.string().min(2).max(100).optional(),
})

interface ClassificationImage {
  filename:  string
  tags:      Array<{ tag: string; score: number; confident: boolean }>
  allScores: Record<string, number>
}

interface ClassificationData {
  images: Record<string, ClassificationImage>
}

export async function POST(req: NextRequest) {
  await requireAdmin()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }
  const { sha, max = 12, imageType = "any", providerName, keyword: keywordOverride } = parsed.data

  // ── 1. Determinar el keyword ───────────────────────────────────────
  let keyword: string
  if (keywordOverride) {
    keyword = keywordOverride
  } else {
    // Cargar classification.json para sacar el tag confident principal
    let classification: ClassificationData | null = null
    try {
      classification = await getJsonFromR2<ClassificationData>(R2_META_KEYS.classification)
    } catch (err) {
      return NextResponse.json(
        {
          ok:    false,
          error: `No se pudo leer classification.json de R2: ${err instanceof Error ? err.message : err}`,
        },
        { status: 500 },
      )
    }

    if (!classification?.images?.[sha]) {
      return NextResponse.json(
        {
          ok:    false,
          error: `SHA '${sha.slice(0, 12)}…' no existe en classification.json. ` +
                 `Pasa 'keyword' manualmente para buscar de todas formas.`,
        },
        { status: 404 },
      )
    }

    const entry = classification.images[sha]
    const confidentTags = entry.tags.filter((t) => t.confident).sort((a, b) => b.score - a.score)
    const topTag       = confidentTags[0] ?? entry.tags[0]   // fallback al tag más alto si no hay confident

    if (!topTag) {
      return NextResponse.json(
        {
          ok:    false,
          error: `La imagen '${sha.slice(0, 12)}…' no tiene ningún tag asignado. ` +
                 `Pasa 'keyword' manualmente.`,
        },
        { status: 422 },
      )
    }

    // Usar displayEs (español) si lo conocemos — Pixabay etc. funcionan mejor en español
    // ya que el banco es DGT español. Fallback al id en inglés.
    const meta = LABEL_METADATA[topTag.tag]
    keyword = meta?.displayEs?.split("·")[0].trim()  // "Mecánica / Motor / Esquema" → solo el primero
                                                       // si tiene "·" separador
                                                       // (no rompe nada si no lo tiene)
              ?? topTag.tag.replace(/_/g, " ")        // fallback: "tunnel_entrance" → "tunnel entrance"

    // Limpieza: quitar caracteres raros que confunden a la API
    keyword = keyword.replace(/[/]/g, " ").replace(/\s+/g, " ").trim()
  }

  // ── 2. Llamar al provider ──────────────────────────────────────────
  try {
    let candidates: Candidate[]
    let providersUsed: string[]
    if (providerName) {
      const provider = getProviderByName(providerName)
      candidates = await provider.findSimilar({
        keyword,
        max,
        imageType: imageType as ImageType,
        lang:      "es",
      })
      providersUsed = [provider.name]
    } else {
      const all = getAllProviders()
      if (all.length === 0) {
        return NextResponse.json(
          {
            ok:    false,
            error: "No hay provider configurado. Añade alguna a .env.local: " +
                   "SERPAPI_API_KEY (recomendado, Google Images), PIXABAY_API_KEY (free 5000/h), " +
                   "PEXELS_API_KEY, UNSPLASH_ACCESS_KEY.",
          },
          { status: 500 },
        )
      }
      candidates = await findFromAllProviders({
        keyword,
        max,
        imageType: imageType as ImageType,
        lang:      "es",
      })
      providersUsed = all.map((p) => p.name)
    }

    return NextResponse.json({
      ok:            true,
      keyword,
      providersUsed,
      candidates,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok:    false,
        error: `Provider error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    )
  }
}
