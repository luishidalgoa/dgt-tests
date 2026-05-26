import { ImageResponse } from "next/og"
import type { NextRequest } from "next/server"

/**
 * Splash screens del PWA para iOS Safari.
 *
 * Por qué este endpoint en vez de PNGs físicos en /public:
 *   - Generamos las 10 resoluciones on-demand vía ImageResponse, usando
 *     la misma paleta de marca (cream → orange → red) que el icon y el
 *     OG image. Si cambia la marca, solo tocas este archivo.
 *   - Cero binarios en git, cero mantenimiento manual de 10 PNGs.
 *
 * iOS Safari ignora el manifest.icons para el splash screen — necesita
 * <link rel="apple-touch-startup-image"> con un `media` query EXACTO que
 * matchee la combinación (device-width, device-height, dpi, orientation).
 * Esos link tags los emite Next.js desde metadata.appleWebApp.startupImage
 * en layout.tsx, apuntando a estas rutas.
 *
 * Si el `device` no está en el catálogo, devolvemos 404 (no caemos a un
 * "default" — preferimos que iOS use el fallback de su sistema antes que
 * mostrar un splash mal escalado).
 */

export const runtime = "edge"

// Resoluciones físicas (en px @ device pixel ratio nativo) de cada device.
// El alto > ancho porque iOS pide siempre portrait — los landscape se
// pueden añadir como entradas separadas si alguna vez instalan la PWA
// con orientación apaisada (poco común).
const DEVICES: Record<string, { width: number; height: number }> = {
  // iPhone 14/15 Pro Max, 16 Pro Max
  "iphone-pro-max":  { width: 1290, height: 2796 },
  // iPhone 14/15 Pro, 16 Pro
  "iphone-pro":      { width: 1179, height: 2556 },
  // iPhone 12/13/14, 12/13 Pro
  "iphone-standard": { width: 1170, height: 2532 },
  // iPhone X / XS / 11 Pro
  "iphone-x":        { width: 1125, height: 2436 },
  // iPhone 8 Plus / 6+ / 7+
  "iphone-8-plus":   { width: 1242, height: 2208 },
  // iPhone 8 / 7 / 6 / SE 2/3
  "iphone-8":        { width: 750,  height: 1334 },
  // iPad Pro 12.9"
  "ipad-pro-12":     { width: 2048, height: 2732 },
  // iPad Pro 11"
  "ipad-pro-11":     { width: 1668, height: 2388 },
  // iPad Air
  "ipad-air":        { width: 1640, height: 2360 },
  // iPad mini
  "ipad-mini":       { width: 1488, height: 2266 },
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ device: string }> },
) {
  const { device } = await params
  const size = DEVICES[device]
  if (!size) return new Response("Splash device not found", { status: 404 })

  // Los iPads tienen más superficie → escalamos el icon y los textos un
  // poco más arriba para que no se vea perdido en el centro de la pantalla.
  const isIPad     = device.startsWith("ipad")
  const iconSize   = isIPad ? 380 : 320
  const emojiSize  = isIPad ? 240 : 200
  const titleSize  = isIPad ? 84  : 64
  const subSize    = isIPad ? 40  : 30
  const radius     = iconSize * 0.22  // squircle (~22% del lado)

  return new ImageResponse(
    (
      <div
        style={{
          width:           "100%",
          height:          "100%",
          background:      "linear-gradient(180deg, #fef7ed 0%, #fed7aa 100%)",
          display:         "flex",
          flexDirection:   "column",
          alignItems:      "center",
          justifyContent:  "center",
        }}
      >
        <div
          style={{
            width:           iconSize,
            height:          iconSize,
            background:      "linear-gradient(135deg, #fdba74 0%, #f97316 45%, #dc2626 100%)",
            borderRadius:    radius,
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "center",
            boxShadow:       "0 24px 48px -16px rgba(220, 38, 38, 0.45)",
          }}
        >
          <div style={{ fontSize: emojiSize, lineHeight: 1, display: "flex" }}>
            🚗
          </div>
        </div>
        <div
          style={{
            marginTop:      56,
            fontSize:       titleSize,
            fontWeight:     900,
            color:          "#7c2d12",
            letterSpacing:  -1,
            display:        "flex",
          }}
        >
          DGT Tests
        </div>
        <div
          style={{
            marginTop:   14,
            fontSize:    subSize,
            color:       "#9a3412",
            fontWeight:  500,
            display:     "flex",
          }}
        >
          Examen teórico
        </div>
      </div>
    ),
    {
      ...size,
      headers: {
        // Las splash no cambian salvo redeploy → cacheamos agresivamente.
        // El path es fijo por device, no hace falta versionar — si cambias
        // el diseño y quieres invalidar, basta con renombrar este endpoint
        // (o añadir un querystring) en la próxima release.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  )
}
