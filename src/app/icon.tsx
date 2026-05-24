import { ImageResponse } from "next/og"

/**
 * Icono PWA generado en build (estático tras build, sirve desde CDN).
 *
 * Por qué TSX en vez de PNG físico: con ImageResponse el icono usa la
 * misma paleta de marca que el OG image (`opengraph-image.tsx`) sin
 * tener que mantener PNGs en sincronía manual. Next lo regenera al
 * build si cambia este archivo.
 *
 * Tamaño 512×512: el mínimo "obligatorio" de PWA según Chrome para
 * que el sitio sea "installable". Maskable: el icono ocupa todo el
 * canvas (sin padding interno) → la plataforma puede recortarlo en
 * círculo o squircle según el SO sin perder detalle.
 *
 * NOTA: convive con icon.svg (favicon escalable) — Next sirve ambos
 * y el manifest.ts apunta a cada uno con su propósito.
 */
export const runtime = "edge"
export const size    = { width: 512, height: 512 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width:    "100%",
          height:   "100%",
          display:  "flex",
          alignItems:     "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #fdba74 0%, #f97316 45%, #dc2626 100%)",
          borderRadius: 0,
        }}
      >
        <div
          style={{
            fontSize:   320,
            lineHeight: 1,
            filter:     "drop-shadow(0 12px 24px rgba(0,0,0,0.25))",
            display:    "flex",
          }}
        >
          🚗
        </div>
      </div>
    ),
    { ...size },
  )
}
