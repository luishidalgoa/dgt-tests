import { db } from "@/lib/db"
import { SECRET_CATALOG, maskSecret } from "@/lib/secretCatalog"
import { decryptSecret } from "@/lib/crypto"
import { detectRuntimeEnv, detectStripeMode } from "@/lib/runtimeEnv"
import { detectEnvFiles, getEnvFileForVar } from "@/lib/envFiles"
import { SecretForm } from "./SecretForm"
import { KeyRound, ExternalLink, Cloud, Laptop } from "lucide-react"

export const dynamic = "force-dynamic"

/**
 * Panel /admin/secrets:
 *   - Lista cada secret del catálogo
 *   - Muestra estado: configurado en BBDD (con mask de 8 chars) /
 *     usando env / no configurado
 *   - Formulario para cambiar (cifra antes de guardar)
 *   - Botón borrar (vuelve al env si lo hay)
 *
 * El layout padre (src/app/admin/layout.tsx) ya valida que el user
 * sea ADMIN. Esta page solo asume que se llegó aquí porque sí lo es.
 */
export default async function AdminSecretsPage() {
  // Cargamos en una sola query todas las rows encrypted del catálogo
  const allKeys = SECRET_CATALOG.map(s => s.key)
  const rows = await db.appConfig.findMany({
    where: { key: { in: allKeys }, encrypted: true },
    select: { key: true, value: true, updatedAt: true },
  })
  const rowsByKey = new Map(rows.map(r => [r.key, r]))

  const runtime = detectRuntimeEnv()
  // En local solo: lista de archivos .env existentes (no aplica en Vercel).
  const envFiles = runtime.isLocal ? detectEnvFiles() : []

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <KeyRound className="h-5 w-5" />
        API keys y secretos
      </h2>
      <p style={{ color: "var(--slate-500)", fontSize: 13.5, marginBottom: 12, marginTop: 0 }}>
        Se guardan cifrados con AES-256-GCM (APP_MASTER_KEY). Si dejas un campo vacío
        y borras la entrada, el runtime cae al valor del entorno actual.
      </p>

      {/* Banner de entorno actual */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px",
        borderRadius: 10,
        background: runtime.isLocal ? "rgba(168, 85, 247, 0.08)" : "rgba(34, 197, 94, 0.08)",
        border: `1px solid ${runtime.isLocal ? "rgba(168, 85, 247, 0.25)" : "rgba(34, 197, 94, 0.30)"}`,
        marginBottom: 22,
        fontSize: 12.5,
        color: "var(--slate-700)",
      }}>
        {runtime.isLocal ? (
          <Laptop className="h-4 w-4" style={{ color: "rgb(126, 34, 206)" }} />
        ) : (
          <Cloud className="h-4 w-4" style={{ color: "var(--green-d)" }} />
        )}
        <span>
          Entorno detectado: <b>{runtime.label}</b>
          {envFiles.length > 0 && (
            <>
              {" "}
              <span style={{ color: "var(--slate-500)" }}>
                · archivos {envFiles.map((f, i) => (
                  <code key={f} style={{ background: "rgba(168, 85, 247, 0.1)", padding: "1px 5px", borderRadius: 4, marginLeft: i ? 4 : 0 }}>{f}</code>
                ))}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="space-y-5">
        {SECRET_CATALOG.map(entry => {
          const row = rowsByKey.get(entry.key)
          let preview: string | null = null
          let effectiveValue: string | null = null
          if (row) {
            try {
              effectiveValue = decryptSecret(row.value)
              preview        = maskSecret(effectiveValue)
            } catch {
              preview = "•••••••• (corrupto / key cambiada)"
            }
          }
          const envFallback = process.env[entry.key] ?? null
          // Si no hay override en BBDD, el valor efectivo es el del env
          if (!effectiveValue && envFallback) effectiveValue = envFallback
          // Detectar live/test SOLO para keys Stripe (incluyendo el price_id)
          const isStripeKey = entry.key.startsWith("STRIPE_") || entry.key.includes("STRIPE")
          const stripeMode  = isStripeKey ? detectStripeMode(effectiveValue) : "unknown"
          return (
            <div key={entry.key} className="card-soft" style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14.5 }}>
                    {entry.label}
                    <span className="font-mono-tabular" style={{ marginLeft: 8, fontSize: 11, color: "var(--slate-400)", fontWeight: 500 }}>
                      {entry.key}
                    </span>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--slate-500)", lineHeight: 1.45 }}>
                    {entry.description}
                  </p>
                  {entry.formatHint && (
                    <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--slate-400)", fontFamily: "monospace" }}>
                      formato: {entry.formatHint}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <StatusBadge inDb={Boolean(row)} inEnv={Boolean(envFallback)} runtimeLabel={runtime.label} />
                  {isStripeKey && stripeMode !== "unknown" && (
                    <StripeModeBadge mode={stripeMode} />
                  )}
                </div>
              </div>

              {row && (
                <div style={{ fontSize: 12, color: "var(--slate-600)", marginBottom: 8, fontFamily: "monospace" }}>
                  Valor actual: <b>{preview}</b>{" "}
                  <span style={{ color: "var(--slate-400)", fontFamily: "inherit", marginLeft: 8 }}>
                    · actualizado {row.updatedAt.toLocaleString("es-ES")}
                  </span>
                </div>
              )}

              {!row && envFallback && (() => {
                // Detectamos el ARCHIVO concreto que aporta el valor en local.
                // En Vercel no hay archivos físicos → mostramos "Vercel Env Variables".
                const sourceFile = runtime.isLocal
                  ? getEnvFileForVar(entry.key)
                  : null
                return (
                  <div style={{ fontSize: 12, color: "var(--slate-500)", marginBottom: 8 }}>
                    Usando el valor de{" "}
                    {runtime.isLocal ? (
                      sourceFile
                        ? <code>{sourceFile}</code>
                        : <span><code>process.env</code> (no encontrado en ningún archivo .env — ¿lo exportaste desde el shell?)</span>
                    ) : (
                      <code>Vercel Environment Variables</code>
                    )}
                    .
                  </div>
                )
              })()}

              {!row && !envFallback && (
                <div style={{ fontSize: 12, color: "var(--red-600)", marginBottom: 8, fontWeight: 600 }}>
                  ⚠ No hay valor configurado en {runtime.label} — la integración correspondiente no funcionará.
                </div>
              )}

              <SecretForm secretKey={entry.key} hasValue={Boolean(row)} />

              {entry.providerUrl && (
                <a
                  href={entry.providerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    color: "var(--slate-500)",
                    textDecoration: "none",
                    marginTop: 8,
                  }}
                >
                  Obtener / gestionar en el proveedor <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusBadge({ inDb, inEnv, runtimeLabel }: { inDb: boolean; inEnv: boolean; runtimeLabel: string }) {
  const config: { label: string; bg: string; color: string; title?: string } = inDb
    ? { label: "BBDD (override)", bg: "rgba(34, 197, 94, 0.12)", color: "var(--green-d)",
        title: `Valor guardado cifrado en BBDD (gana sobre el entorno: ${runtimeLabel})` }
    : inEnv
    ? { label: "entorno",         bg: "rgba(148, 163, 184, 0.15)", color: "var(--slate-600)",
        title: `Leyendo del entorno: ${runtimeLabel}` }
    : { label: "no configurado",  bg: "rgba(239, 68, 68, 0.12)",   color: "var(--red-600)",
        title: `No hay valor ni en BBDD ni en el entorno (${runtimeLabel})` }
  return (
    <span
      title={config.title}
      style={{
        flexShrink: 0,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: config.bg,
        color: config.color,
        cursor: "help",
      }}
    >
      {config.label}
    </span>
  )
}

function StripeModeBadge({ mode }: { mode: "live" | "test" }) {
  const isLive = mode === "live"
  return (
    <span
      title={isLive ? "Stripe LIVE: pagos reales" : "Stripe TEST: pagos ficticios con tarjetas de prueba"}
      style={{
        flexShrink: 0,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: isLive ? "rgba(239, 68, 68, 0.12)" : "rgba(34, 197, 94, 0.12)",
        color:      isLive ? "var(--red-600)" : "var(--green-d)",
        cursor:     "help",
      }}
    >
      {isLive ? "🔴 LIVE" : "🟢 TEST"}
    </span>
  )
}
