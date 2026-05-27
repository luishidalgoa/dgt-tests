/**
 * Reverse image search — busca imágenes con licencia libre para reemplazar
 * las problemáticas del banco DGT.
 *
 * Arquitectura: abstracción `ReverseImageProvider` que permite enchufar
 * distintos backends:
 *   - PixabayProvider (default, free, 5000 req/h)
 *   - UnsplashProvider (free, 50 req/h)
 *   - PexelsProvider (free, 200 req/h)
 *   - SerpApiProvider (~$50/mes, Google reverse image — TRUE visual similarity)
 *
 * NOTA: las APIs de stock buscan por KEYWORD (no por similitud visual exacta).
 * Para el banco DGT, usamos el `tag` confident principal de la imagen como
 * keyword — es suficiente para encontrar reemplazos temáticamente parecidos
 * con licencia libre. Si la calidad no convence, el upgrade a SerpAPI da
 * reverse image search REAL (sube la imagen → encuentra similares).
 *
 * Por qué Bing NO está aquí: Bing Search APIs fueron retirados el 11/08/2025
 * (https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement).
 * El sucesor "Grounding with Bing Search" es para LLM context, no reverse image.
 */

// ── Tipos compartidos ────────────────────────────────────────────────

export type ImageLicense =
  | "cc0"            // Creative Commons Zero — uso libre comercial sin atribución
  | "cc-by"          // Creative Commons BY — libre con atribución
  | "pixabay"        // Pixabay License — equivalente a CC0 para uso comercial
  | "unsplash"       // Unsplash License — uso libre comercial con atribución recomendada
  | "pexels"         // Pexels License — uso libre comercial con atribución recomendada
  | "unknown"

export type ImageType = "photo" | "illustration" | "vector" | "any"

export interface Candidate {
  /** URL completa para descarga directa */
  url:          string
  /** Thumbnail para previsualización en UI (puede ser igual al url o más pequeño) */
  thumbnailUrl: string
  /** URL de la página web donde vive (para atribución/auditoría) */
  sourceUrl:    string
  /** Provider de donde viene */
  provider:     "pixabay" | "unsplash" | "pexels" | "serpapi"
  /** Ancho y alto en píxeles (si los conocemos) */
  width:        number
  height:       number
  /** Tipo de imagen (foto, ilustración, vector) */
  imageType:    ImageType
  /** Licencia */
  license:      ImageLicense
  /** Tags asociados a la imagen en el provider (útil para filtrar manualmente) */
  tags?:        string[]
  /** Atribución requerida (autor) si aplica */
  attribution?: string
  /** Mime type guessed */
  contentType?: string
}

export interface SearchOpts {
  /** Keyword para búsqueda por concepto (provider stock APIs) */
  keyword?:       string
  /** Bytes de imagen original para reverse image search visual (solo SerpAPI / etc.) */
  imageBytes?:    Buffer
  /** Máximo de candidatos a devolver. Default 12. */
  max?:           number
  /** Tipo de imagen permitido (algunos providers lo soportan, otros no) */
  imageType?:     ImageType
  /** Filtro de tamaño mínimo en píxeles (lado más corto). Default 480px. */
  minSize?:       number
  /** Idioma de la búsqueda (algunos providers lo soportan) */
  lang?:          string
}

export interface ReverseImageProvider {
  name: string
  /** True si está configurado (tiene API key, etc.) */
  isConfigured(): boolean
  /** Busca candidatos */
  findSimilar(opts: SearchOpts): Promise<Candidate[]>
}

// ── Pixabay Provider ─────────────────────────────────────────────────
// Docs: https://pixabay.com/api/docs/
// API key: registrarse free en https://pixabay.com/accounts/register/
// Rate limit free: 100 req/min (5000 req/h)
// License: Pixabay License (equivalente a CC0 para uso comercial)

class PixabayProvider implements ReverseImageProvider {
  name = "pixabay" as const

  isConfigured(): boolean {
    return Boolean(process.env.PIXABAY_API_KEY)
  }

  async findSimilar(opts: SearchOpts): Promise<Candidate[]> {
    const apiKey = process.env.PIXABAY_API_KEY
    if (!apiKey) {
      throw new Error("PIXABAY_API_KEY no configurada en .env / .env.local")
    }
    if (!opts.keyword) {
      throw new Error("Pixabay requiere 'keyword' (no soporta reverse image visual)")
    }

    const max = opts.max ?? 12
    const minSize = opts.minSize ?? 480

    // Pixabay acepta: image_type = all | photo | illustration | vector
    const imageTypeParam = opts.imageType && opts.imageType !== "any" ? opts.imageType : "all"

    const params = new URLSearchParams({
      key:        apiKey,
      q:          opts.keyword,
      per_page:   String(Math.min(Math.max(3, max), 200)),  // 3-200 por la API
      image_type: imageTypeParam,
      safesearch: "true",
      min_width:  String(minSize),
      min_height: String(minSize),
      lang:       opts.lang ?? "es",
    })

    const res = await fetch(`https://pixabay.com/api/?${params.toString()}`, {
      method:  "GET",
      headers: { Accept: "application/json" },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Pixabay API HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const data = (await res.json()) as {
      total: number
      totalHits: number
      hits: Array<{
        id: number
        type: "photo" | "illustration" | "vector"
        tags: string
        previewURL: string
        webformatURL: string
        largeImageURL: string
        imageWidth: number
        imageHeight: number
        user: string
        pageURL: string
      }>
    }

    return (data.hits ?? []).slice(0, max).map((hit): Candidate => ({
      url:          hit.largeImageURL || hit.webformatURL,
      thumbnailUrl: hit.previewURL,
      sourceUrl:    hit.pageURL,
      provider:     "pixabay",
      width:        hit.imageWidth,
      height:       hit.imageHeight,
      imageType:    hit.type,
      license:      "pixabay",
      tags:         hit.tags.split(",").map((t) => t.trim()).filter(Boolean),
      attribution:  hit.user,
      contentType:  guessContentType(hit.largeImageURL || hit.webformatURL),
    }))
  }
}

// ── Pexels Provider (preparado, no activo hasta tener PEXELS_API_KEY) ──
// Docs: https://www.pexels.com/api/documentation/
// Rate limit free: 200 req/h, 20.000 req/mes

class PexelsProvider implements ReverseImageProvider {
  name = "pexels" as const

  isConfigured(): boolean {
    return Boolean(process.env.PEXELS_API_KEY)
  }

  async findSimilar(opts: SearchOpts): Promise<Candidate[]> {
    const apiKey = process.env.PEXELS_API_KEY
    if (!apiKey) throw new Error("PEXELS_API_KEY no configurada")
    if (!opts.keyword) throw new Error("Pexels requiere 'keyword'")

    const max = opts.max ?? 12
    const params = new URLSearchParams({
      query:    opts.keyword,
      per_page: String(Math.min(Math.max(1, max), 80)),
      locale:   opts.lang === "es" ? "es-ES" : "en-US",
    })

    const res = await fetch(`https://api.pexels.com/v1/search?${params.toString()}`, {
      headers: { Authorization: apiKey, Accept: "application/json" },
    })
    if (!res.ok) {
      throw new Error(`Pexels API HTTP ${res.status}`)
    }
    const data = (await res.json()) as {
      photos: Array<{
        id: number
        width: number
        height: number
        url: string
        photographer: string
        src: { original: string; large: string; medium: string; small: string }
        alt: string
      }>
    }

    return (data.photos ?? []).slice(0, max).map((p): Candidate => ({
      url:          p.src.large,
      thumbnailUrl: p.src.small,
      sourceUrl:    p.url,
      provider:     "pexels",
      width:        p.width,
      height:       p.height,
      imageType:    "photo",
      license:      "pexels",
      tags:         p.alt ? [p.alt] : [],
      attribution:  p.photographer,
      contentType:  guessContentType(p.src.large),
    }))
  }
}

// ── SerpAPI Google Images Provider ───────────────────────────────────
// Docs: https://serpapi.com/google-images-api
// Key:  https://serpapi.com/manage-api-key (free tier 100 búsquedas/mes,
//       después $50/mes para 5000).
//
// Por qué este es el bueno:
//   Los stock APIs (Pixabay/Pexels/Unsplash) buscan en un corpus pequeño
//   de fotos comerciales — para un pictograma DGT o un diagrama didáctico
//   no tienen NADA. SerpAPI envuelve Google Images, que indexa toda la
//   web (PDFs de manuales, blogs de autoescuelas, foros, etc.). La calidad
//   y relevancia es órdenes de magnitud mejor para nuestro caso DGT.
//
// Licencia: por defecto pedimos `tbs=il:cl` (Creative Commons) para que
//   los resultados sean LEGALMENTE reusables. Sin ese filtro, salen imgs
//   con copyright que NO se pueden usar comercialmente.

class SerpApiProvider implements ReverseImageProvider {
  name = "serpapi" as const

  isConfigured(): boolean {
    return Boolean(process.env.SERPAPI_API_KEY)
  }

  async findSimilar(opts: SearchOpts): Promise<Candidate[]> {
    const apiKey = process.env.SERPAPI_API_KEY
    if (!apiKey) throw new Error("SERPAPI_API_KEY no configurada en .env / .env.local")
    if (!opts.keyword) throw new Error("SerpAPI requiere 'keyword'")

    const max = opts.max ?? 12

    // tbs (Google search filters) — encadenable con `,`:
    //   il:cl       → license filter Creative Commons (libre uso comercial
    //                 y modificación). CRÍTICO para no meter copyrighted
    //                 en el banco DGT.
    //   itp:photo   → solo fotos (no clipart). Permitimos otros si el
    //                 caller pide vector/illustration.
    const tbsParts: string[] = ["il:cl"]
    if (opts.imageType === "photo") tbsParts.push("itp:photo")
    else if (opts.imageType === "illustration") tbsParts.push("itp:clipart")
    else if (opts.imageType === "vector") tbsParts.push("itp:lineart")
    const tbs = tbsParts.join(",")

    const params = new URLSearchParams({
      engine:  "google_images",
      q:       opts.keyword,
      api_key: apiKey,
      hl:      opts.lang ?? "es",
      gl:      "es",                          // geo Spain → resultados localizados
      safe:    "active",
      tbs,
      ijn:     "0",                            // primera página
      num:     String(Math.min(Math.max(10, max * 2), 100)),  // pedimos algo más para filtrar
    })

    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      method:  "GET",
      headers: { Accept: "application/json" },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`SerpAPI HTTP ${res.status}: ${text.slice(0, 240)}`)
    }

    const data = (await res.json()) as {
      error?: string
      images_results?: Array<{
        position?:        number
        thumbnail?:       string
        source?:          string
        title?:           string
        link?:            string
        original?:        string
        original_width?:  number
        original_height?: number
        is_product?:      boolean
        tag?:             string
      }>
    }

    if (data.error) {
      throw new Error(`SerpAPI error: ${data.error}`)
    }

    const results = data.images_results ?? []

    // Filtrar: necesitamos original + dimensiones razonables. Algunos hits
    // vienen sin `original` (solo thumbnail) — los descartamos porque al
    // intentar descargarlos en /replace-image fallaría.
    return results
      .filter((r) => r.original && r.original.startsWith("http"))
      .filter((r) => {
        const w = r.original_width  ?? 0
        const h = r.original_height ?? 0
        const minSize = opts.minSize ?? 480
        // Si no conocemos las dimensiones, lo dejamos pasar (Google a veces
        // las omite). Si las conocemos, exigimos mínimo.
        return (w === 0 && h === 0) || (w >= minSize || h >= minSize)
      })
      .slice(0, max)
      .map((r): Candidate => ({
        url:          r.original!,
        thumbnailUrl: r.thumbnail ?? r.original!,
        sourceUrl:    r.link ?? r.original!,
        provider:     "serpapi",
        width:        r.original_width  ?? 0,
        height:       r.original_height ?? 0,
        imageType:    opts.imageType && opts.imageType !== "any" ? opts.imageType : "photo",
        license:      "cc-by",                                  // tbs=il:cl ≈ CC, asumimos atribución
        tags:         r.title ? [r.title] : [],
        attribution:  r.source ?? "Google Images",
        contentType:  guessContentType(r.original!),
      }))
  }
}

// ── Unsplash Provider (preparado) ────────────────────────────────────
// Docs: https://unsplash.com/documentation
// Free tier: 50 req/h

class UnsplashProvider implements ReverseImageProvider {
  name = "unsplash" as const

  isConfigured(): boolean {
    return Boolean(process.env.UNSPLASH_ACCESS_KEY)
  }

  async findSimilar(opts: SearchOpts): Promise<Candidate[]> {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY
    if (!accessKey) throw new Error("UNSPLASH_ACCESS_KEY no configurada")
    if (!opts.keyword) throw new Error("Unsplash requiere 'keyword'")

    const max = opts.max ?? 12
    const params = new URLSearchParams({
      query:    opts.keyword,
      per_page: String(Math.min(Math.max(1, max), 30)),
      lang:     opts.lang ?? "es",
    })

    const res = await fetch(`https://api.unsplash.com/search/photos?${params.toString()}`, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        Accept:        "application/json",
      },
    })
    if (!res.ok) throw new Error(`Unsplash API HTTP ${res.status}`)
    const data = (await res.json()) as {
      results: Array<{
        id: string
        width: number
        height: number
        urls: { raw: string; full: string; regular: string; small: string; thumb: string }
        links: { html: string }
        user: { name: string }
        description: string | null
        alt_description: string | null
      }>
    }

    return (data.results ?? []).slice(0, max).map((r): Candidate => ({
      url:          r.urls.regular,
      thumbnailUrl: r.urls.small,
      sourceUrl:    r.links.html,
      provider:     "unsplash",
      width:        r.width,
      height:       r.height,
      imageType:    "photo",
      license:      "unsplash",
      tags:         [r.alt_description, r.description].filter(Boolean) as string[],
      attribution:  r.user.name,
      contentType:  "image/jpeg",
    }))
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function guessContentType(url: string): string {
  const lower = url.toLowerCase().split("?")[0]
  if (lower.endsWith(".png"))  return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif"))  return "image/gif"
  if (lower.endsWith(".svg"))  return "image/svg+xml"
  return "image/jpeg"
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Devuelve el provider primario configurado. Orden de preferencia:
 *   1. SerpAPI   (pago, $50/mes — Google Images real, MUCHO más relevante
 *                 para pictogramas DGT y escenas de tráfico que stock APIs)
 *   2. Pixabay   (free, 5000/h, license CC0-equivalente)
 *   3. Pexels    (free, 200/h)
 *   4. Unsplash  (free, 50/h)
 *
 * Si quieres forzar uno concreto: `getProviderByName("unsplash")`.
 * Si quieres TODOS los configurados (búsqueda agregada): `getAllProviders()`.
 */
export function getProvider(): ReverseImageProvider {
  const all = getAllProviders()
  if (all.length === 0) {
    throw new Error(
      "No hay provider de reverse image search configurado. " +
      "Añade alguna de estas keys a .env.local: " +
      "SERPAPI_API_KEY (Google Images, recomendado), PIXABAY_API_KEY, PEXELS_API_KEY, UNSPLASH_ACCESS_KEY.",
    )
  }
  return all[0]
}

export function getProviderByName(name: string): ReverseImageProvider {
  const provider = PROVIDERS.find((p) => p.name === name)
  if (!provider) throw new Error(`Provider desconocido: ${name}`)
  if (!provider.isConfigured()) {
    throw new Error(`Provider '${name}' no está configurado (falta API key)`)
  }
  return provider
}

export function getAllProviders(): ReverseImageProvider[] {
  return PROVIDERS.filter((p) => p.isConfigured())
}

// Orden de preferencia: SerpAPI primero (Google Images = mejor calidad
// para casos DGT). El resto en orden de rate limit descendente — si solo
// hay stock APIs, Pixabay es el siguiente más útil por su quota generosa.
const PROVIDERS: ReverseImageProvider[] = [
  new SerpApiProvider(),
  new PixabayProvider(),
  new PexelsProvider(),
  new UnsplashProvider(),
]

// ── Búsqueda agregada (opcional — combina todos los providers configurados) ──

/**
 * Busca en TODOS los providers configurados y devuelve resultados intercalados.
 * Útil cuando quieres maximizar la cobertura con cero coste recurrente.
 */
export async function findFromAllProviders(opts: SearchOpts): Promise<Candidate[]> {
  const providers = getAllProviders()
  if (providers.length === 0) throw new Error("Ningún provider configurado")

  const perProvider = Math.ceil((opts.max ?? 12) / providers.length)
  const results = await Promise.allSettled(
    providers.map((p) => p.findSimilar({ ...opts, max: perProvider })),
  )

  // Intercalar resultados (round-robin) para diversidad de fuentes
  const allLists = results
    .filter((r): r is PromiseFulfilledResult<Candidate[]> => r.status === "fulfilled")
    .map((r) => r.value)

  const interleaved: Candidate[] = []
  const maxLen = Math.max(...allLists.map((l) => l.length))
  for (let i = 0; i < maxLen; i++) {
    for (const list of allLists) {
      if (i < list.length) interleaved.push(list[i])
    }
  }
  return interleaved.slice(0, opts.max ?? 12)
}
