import { ImageResponse } from "next/og"

/**
 * Open Graph image generada en build (estática tras build, sirve desde
 * CDN). Next.js la sirve en /opengraph-image y la inyecta automáticamente
 * en las meta og:image y twitter:image del root.
 *
 * Diseño: gradiente naranja-rojo (paleta marca DGT Tests) con emoji 🚗,
 * título grande y tagline. Sin fuentes custom para evitar pasos extra de
 * build — usa la fuente system del runtime de Vercel (Inter equivalente).
 *
 * Cómo previsualizar tras commit: abre
 *   https://dgt-tests.hdglabs.com/opengraph-image
 * Pruébala en https://www.opengraph.xyz/url/<URL_ENCODED>
 */

export const runtime = "edge"
export const alt     = "DGT Tests · Aprueba el examen teórico a la primera"
export const size    = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width:    "100%",
          height:   "100%",
          display:  "flex",
          flexDirection:  "column",
          alignItems:     "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #fdba74 0%, #f97316 45%, #dc2626 100%)",
          color:      "#1f1611",
          padding:    "80px 60px",
          textAlign:  "center",
          position:   "relative",
        }}
      >
        {/* Pattern decorativo de fondo: puntos sutiles */}
        <div
          style={{
            position: "absolute",
            inset:    0,
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.18) 1.5px, transparent 1.5px)",
            backgroundSize:  "32px 32px",
            opacity:  0.4,
          }}
        />

        {/* Emoji car */}
        <div
          style={{
            fontSize:    160,
            lineHeight:  1,
            marginBottom: 24,
            filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.25))",
            display: "flex",
          }}
        >
          🚗
        </div>

        {/* Título marca */}
        <div
          style={{
            fontSize:     112,
            fontWeight:   900,
            letterSpacing: "-0.04em",
            color:        "#fff",
            textShadow:   "0 4px 16px rgba(0,0,0,0.25)",
            lineHeight:   1,
            marginBottom: 18,
            display:      "flex",
          }}
        >
          DGT Tests
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize:     38,
            fontWeight:   600,
            color:        "rgba(255,255,255,0.95)",
            maxWidth:     900,
            lineHeight:   1.25,
            display:      "flex",
          }}
        >
          Aprueba el examen teórico a la primera
        </div>

        {/* Footer URL */}
        <div
          style={{
            position: "absolute",
            bottom:   40,
            left:     0,
            right:    0,
            display:  "flex",
            justifyContent: "center",
            fontSize:  26,
            fontWeight: 700,
            color:     "rgba(255,255,255,0.85)",
            letterSpacing: "0.04em",
          }}
        >
          dgt-tests.hdglabs.com
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
