/**
 * Single source of truth para el precio de la suscripción PRO.
 *
 * Si cambias el precio en Stripe, cámbialo TAMBIÉN aquí — la UI lo lee
 * desde estas constantes, así no se queda desincronizada.
 *
 * Stripe internamente guarda el precio en céntimos en el Price object.
 * Estos valores son solo para mostrar al usuario en la web.
 */

/** Precio en céntimos (igual que en Stripe Price.unit_amount). */
export const PRO_PRICE_CENTS = 699

/** Moneda ISO 4217. */
export const PRO_CURRENCY = "EUR" as const

/** Cadencia de facturación. */
export const PRO_INTERVAL = "month" as const

/** Cadena formateada en español, p.ej. "6,99 €" */
export const PRO_PRICE_LABEL = formatEUR(PRO_PRICE_CENTS)

/** "6,99 €/mes" — útil en CTAs. */
export const PRO_PRICE_PER_MONTH = `${PRO_PRICE_LABEL}/mes`

function formatEUR(cents: number): string {
  const euros = cents / 100
  // Locale es: "6,99 €"
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(euros)
}
