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
 *
 * ICONOS: PNGs físicos en /public/icons/ a varios tamaños. Antes
 * generábamos un PNG con emoji 🚗 (icon.tsx) pero el emoji depende
 * del font del sistema y se veía pixelado en móviles. Ahora usamos el
 * volante real de marca (mismo diseño que /public/stripe/logo-*.png).
 * - 256: thumbnails / pequeñas (Android home grid pequeño)
 * - 512: PWA "installable" (Chrome lo exige). Maskable para que
 *        Android lo recorte en círculo/squircle sin perder detalle.
 * - 1024: hi-DPI para pantallas retina / 4K (iOS, Android premium)
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
      // PNGs físicos del logo de marca (volante blanco sobre naranja).
      // Varios tamaños para que cada SO escoja el más cercano a su DPI.
      { src: "/icons/icon-256.png",  sizes: "256x256",   type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png",  sizes: "512x512",   type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png",  sizes: "512x512",   type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      // SVG escalable como fallback (mejor para zoom y pantallas hi-DPI extremas).
      { src: "/icon.svg",            sizes: "any",       type: "image/svg+xml", purpose: "any" },
    ],
    categories: ["education", "productivity"],
  }
}
