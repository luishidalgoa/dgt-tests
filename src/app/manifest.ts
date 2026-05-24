import type { MetadataRoute } from "next"

/**
 * /manifest.webmanifest — manifest PWA generado por Next App Router.
 *
 * Hace la web instalable como aplicación en móvil/desktop:
 *   - Chrome Android: opción "Add to home screen" automática si se
 *     cumplen los criterios (HTTPS + manifest + sw + iconos).
 *   - iOS Safari: "Compartir → Añadir a pantalla de inicio".
 *   - Edge/Chrome desktop: icono "instalar" en la URL bar.
 *
 * Una vez instalada se abre en modo standalone (sin barra del navegador,
 * fullscreen) y con el icono de la app en el launcher del SO.
 *
 * theme_color afecta a la barra superior del navegador / status bar del
 * móvil. background_color es el splash screen mientras carga la app
 * tras tocar el icono.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             "DGT Tests · Examen teórico de conducir",
    short_name:       "DGT Tests",
    description:      "Tests del examen teórico del carné de conducir DGT. Permiso B, ADAS, repaso final con explicaciones y modo IA.",
    start_url:        "/",
    scope:            "/",
    display:          "standalone",
    orientation:      "portrait",
    lang:             "es-ES",
    // Naranja de marca para la status bar / theme.
    theme_color:      "#ea580c",
    // Cream del fondo para el splash de carga.
    background_color: "#fef7ed",
    icons: [
      // PNG generados dinámicamente vía icon.tsx (192/512 — los obligatorios PWA).
      { src: "/icon",  sizes: "512x512", type: "image/png", purpose: "any maskable" },
      // SVG como fallback escalable (mejor para zoom y pantallas hi-DPI).
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      // Apple-touch-icon para iOS (no aparece aquí pero lo sirve apple-icon.svg).
    ],
    categories: ["education", "productivity"],
  }
}
