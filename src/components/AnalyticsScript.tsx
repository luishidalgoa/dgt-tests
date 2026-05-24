import Script from "next/script"

/**
 * Inyecta el script del provider de analytics si está configurado.
 *
 * Config vía env vars (NEXT_PUBLIC_*):
 *   - NEXT_PUBLIC_ANALYTICS_PROVIDER:  "umami" | "plausible"
 *   - NEXT_PUBLIC_ANALYTICS_SCRIPT_URL: URL completa del script
 *   - NEXT_PUBLIC_ANALYTICS_WEBSITE_ID: ID del site (Umami) o domain (Plausible)
 *
 * Si WEBSITE_ID no está set, no inyecta nada → sitio sin analytics.
 *
 * Estrategia de carga: `afterInteractive` para que no bloquee la hydratación
 * inicial pero esté disponible casi inmediatamente para los primeros eventos.
 *
 * Atributos por provider:
 *   - Umami:     data-website-id="<id>"  (a veces también data-domain)
 *   - Plausible: data-domain="<domain>"  (a veces también data-api)
 *
 * Renderizamos AMBOS data-* aunque el provider use solo uno — el otro lo
 * ignora. Más simple que branch logic.
 */
export function AnalyticsScript() {
  const provider  = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER
  const scriptUrl = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL
  const websiteId = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID

  if (!scriptUrl || !websiteId) return null

  return (
    <Script
      src={scriptUrl}
      strategy="afterInteractive"
      defer
      // Umami usa data-website-id; Plausible usa data-domain. El que no aplica lo ignora.
      data-website-id={websiteId}
      data-domain={websiteId}
      // Anti-cache forcing (para que el provider no sirva versión stale)
      data-cache="true"
      // Marcador útil para depurar en DevTools.
      data-provider={provider ?? "auto"}
    />
  )
}
