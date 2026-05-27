import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/adminGuard"
import { getJsonFromR2, R2_META_KEYS } from "@/lib/imagesBankR2"
import { absoluteImageUrl } from "@/lib/imageUrl"
import { LABEL_METADATA } from "@/app/admin/images-bank/labelMetadata"
import {
  findFromAllProviders,
  findFromProviders,
  getProviderByName,
  getAllProviders,
  type Candidate,
  type ImageType,
} from "@/lib/reverseImageSearch"
import type { AlternativeReferencesData } from "@/lib/imagesBankR2"

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
  // providerName fuerza UNO concreto. providerSet elige una agrupación
  // semántica ("stock" = gratis combinado, "google" = SerpAPI). Si pasas
  // ambos, providerName gana (más específico). Si no pasas ninguno,
  // se usan TODOS los providers configurados (comportamiento legacy).
  providerName: z.enum(["pixabay", "pexels", "unsplash", "serpapi"]).optional(),
  providerSet:  z.enum(["stock", "google"]).optional(),
  keyword:      z.string().min(2).max(100).optional(),
})

// Composición de cada `providerSet`:
//   - "stock":  Pixabay + Pexels (free, sin SerpAPI ni Unsplash para evitar
//                gastar quota cara o el rate limit más estricto de Unsplash).
//   - "google": SerpAPI exclusivo (Google Images con filtro Creative Commons).
const PROVIDER_SETS = {
  stock:  ["pixabay", "pexels"],
  google: ["serpapi"],
} as const

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
  const { sha, max = 12, imageType = "any", providerName, providerSet, keyword: keywordOverride } = parsed.data

  // ── 1. Cargar classification.json (necesario tanto para el keyword
  //       automático como para el filename → URL pública para Lens) ────
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

  // URL pública de la imagen original — esto es lo que Google Lens fetcha
  // para hacer reverse image search visual. absoluteImageUrl() resuelve
  // al CDN R2 público (NEXT_PUBLIC_IMAGE_CDN_URL) → accesible para Google.
  const imageUrl = absoluteImageUrl(entry.filename)

  // ── 2. Determinar el keyword (fallback para google_images + necesario
  //       para stock APIs que no tienen visual search) ──────────────────
  let keyword: string
  if (keywordOverride) {
    keyword = keywordOverride
  } else {
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

  // ── 3. Llamar al provider ──────────────────────────────────────────
  // Prioridad de selección:
  //   1. providerName (más específico, fuerza UN provider concreto)
  //   2. providerSet  (tab "stock" o "google" del modal)
  //   3. nada → comportamiento legacy: TODOS los providers configurados
  //
  // Pasamos AMBOS keyword e imageUrl en searchOpts:
  //   - Pixabay/Pexels/Unsplash ignoran imageUrl y usan keyword.
  //   - SerpApiProvider prioriza imageUrl (engine=google_lens, reverse
  //     image visual REAL) y cae a keyword (engine=google_images) si no.
  const searchOpts = {
    keyword,
    imageUrl,
    max,
    imageType: imageType as ImageType,
    lang:      "es",
  }
  try {
    let candidates: Candidate[]
    let providersUsed: string[]
    if (providerName) {
      const provider = getProviderByName(providerName)
      candidates   = await provider.findSimilar(searchOpts)
      providersUsed = [provider.name]
    } else if (providerSet) {
      const names = PROVIDER_SETS[providerSet] as readonly string[]
      candidates   = await findFromProviders([...names], searchOpts)
      providersUsed = [...names]
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
      candidates = await findFromAllProviders(searchOpts)
      providersUsed = all.map((p) => p.name)
    }

    // ── Marcar candidatos ya descargados anteriormente ───────────────
    // Leemos meta/alternative_references.json y construimos un set con
    // todas las URLs registradas en cualquier originalSha (no solo el
    // que disparó esta búsqueda — una misma URL de Pixabay puede haber
    // sido guardada como ref de varias imágenes del banco). Marcamos
    // cada candidato cuya sourceUrl o url aparezca en el set para que
    // el modal pueda pintarlo como "Guardada" sin tener que descargar
    // el binario para calcular el SHA y compararlo.
    try {
      const registry = await getJsonFromR2<AlternativeReferencesData>(R2_META_KEYS.alternativeReferences)
      if (registry?.references) {
        const downloadedSourceUrls = new Set<string>()
        for (const arr of Object.values(registry.references)) {
          for (const r of arr ?? []) {
            if (r.sourceUrl) downloadedSourceUrls.add(r.sourceUrl)
          }
        }
        if (downloadedSourceUrls.size > 0) {
          candidates = candidates.map((c) => ({
            ...c,
            alreadyDownloaded:
              downloadedSourceUrls.has(c.sourceUrl) ||
              downloadedSourceUrls.has(c.url),
          }))
        }
      }
    } catch {
      // Si el registry no carga seguimos sin marcado — no es fatal.
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
