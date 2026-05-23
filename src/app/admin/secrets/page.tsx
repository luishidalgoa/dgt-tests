import { db } from "@/lib/db"
import { SECRET_CATALOG, type SecretEntry, maskSecret } from "@/lib/secretCatalog"
import { decryptSecret } from "@/lib/crypto"
import { detectRuntimeEnv, detectStripeMode } from "@/lib/runtimeEnv"
import { detectEnvFiles, getEnvFileForVar } from "@/lib/envFiles"
import { SecretForm } from "./SecretForm"
import { TestAIConnectionButton } from "@/components/TestAIConnectionButton"
import { TestSentryConnectionButton } from "@/components/TestSentryConnectionButton"
import { KeyRound, ExternalLink, Cloud, Laptop, ChevronRight } from "lucide-react"

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

      {(() => {
        // Particionamos en (a) flat = entries sin group, (b) groups = Map de
        // group→entries. Renderizamos primero las flat tal cual, después
        // cada group como <details> colapsable.
        const flat: SecretEntry[]                    = []
        const groups: Map<string, SecretEntry[]>     = new Map()
        for (const e of SECRET_CATALOG) {
          if (e.group) {
            const arr = groups.get(e.group) ?? []
            arr.push(e)
            groups.set(e.group, arr)
          } else {
            flat.push(e)
          }
        }

        function renderCard(entry: SecretEntry) {
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
          if (!effectiveValue && envFallback) effectiveValue = envFallback
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
                    {entry.scope === "build" && (
                      <span title="Solo se usa al `next build` (no en cada request)" style={{ marginLeft: 8, fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "rgba(168, 85, 247, 0.12)", color: "rgb(126, 34, 206)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        build-time
                      </span>
                    )}
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
                const sourceFile = runtime.isLocal ? getEnvFileForVar(entry.key) : null
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

              {entry.aiProvider && (
                <TestAIConnectionButton provider={entry.aiProvider} label={entry.label} />
              )}

              {/* Sentry test: solo en la card del DSN. Las otras 3 entries
                  (ORG/PROJECT/AUTH_TOKEN) no necesitan test propio — solo
                  importan al build time, no en runtime. */}
              {entry.key === "NEXT_PUBLIC_SENTRY_DSN" && (
                <TestSentryConnectionButton label="Sentry" />
              )}

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
        }

        return (
          <div className="space-y-5">
            {flat.map(renderCard)}
            {Array.from(groups.entries()).map(([groupName, entries]) => {
              // Cuenta entries con valor (en DB o env) para que el header
              // muestre "3/4 configurados".
              const configured = entries.filter((e) => {
                return rowsByKey.has(e.key) || Boolean(process.env[e.key])
              }).length
              return (
                <details key={groupName} className="card-soft" style={{ padding: 0, overflow: "hidden" }}>
                  <summary style={{
                    cursor: "pointer",
                    padding: "14px 18px",
                    listStyle: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontWeight: 800,
                    fontSize: 15,
                    background: "rgba(148, 163, 184, 0.06)",
                    userSelect: "none",
                  }}>
                    <ChevronRight className="h-4 w-4 secret-group-chevron" style={{ transition: "transform 0.15s", flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{groupName}</span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: configured === entries.length
                        ? "rgba(34, 197, 94, 0.15)"
                        : configured === 0
                        ? "rgba(239, 68, 68, 0.12)"
                        : "rgba(245, 158, 11, 0.15)",
                      color: configured === entries.length
                        ? "var(--green-d)"
                        : configured === 0
                        ? "var(--red-600)"
                        : "var(--amber-d, #92400e)",
                    }}>
                      {configured}/{entries.length} configurados
                    </span>
                  </summary>
                  <div style={{ padding: "12px 18px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                    {entries.map(renderCard)}
                  </div>
                </details>
              )
            })}
          </div>
        )
      })()}
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
