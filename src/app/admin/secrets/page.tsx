import { db } from "@/lib/db"
import { SECRET_CATALOG, maskSecret } from "@/lib/secretCatalog"
import { decryptSecret } from "@/lib/crypto"
import { SecretForm } from "./SecretForm"
import { KeyRound, ExternalLink } from "lucide-react"

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

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <KeyRound className="h-5 w-5" />
        API keys y secretos
      </h2>
      <p style={{ color: "var(--slate-500)", fontSize: 13.5, marginBottom: 22, marginTop: 0 }}>
        Se guardan cifrados con AES-256-GCM (APP_MASTER_KEY). Si dejas un campo vacío
        y borras la entrada, el runtime cae al env var del mismo nombre.
      </p>

      <div className="space-y-5">
        {SECRET_CATALOG.map(entry => {
          const row = rowsByKey.get(entry.key)
          let preview: string | null = null
          if (row) {
            try {
              preview = maskSecret(decryptSecret(row.value))
            } catch {
              preview = "•••••••• (corrupto / key cambiada)"
            }
          }
          const envFallback = process.env[entry.key]
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
                <StatusBadge inDb={Boolean(row)} inEnv={Boolean(envFallback)} />
              </div>

              {row && (
                <div style={{ fontSize: 12, color: "var(--slate-600)", marginBottom: 8, fontFamily: "monospace" }}>
                  Valor actual: <b>{preview}</b>{" "}
                  <span style={{ color: "var(--slate-400)", fontFamily: "inherit", marginLeft: 8 }}>
                    · actualizado {row.updatedAt.toLocaleString("es-ES")}
                  </span>
                </div>
              )}

              {!row && envFallback && (
                <div style={{ fontSize: 12, color: "var(--slate-500)", marginBottom: 8 }}>
                  Usando el valor del archivo <code>.env</code> de prod.
                </div>
              )}

              {!row && !envFallback && (
                <div style={{ fontSize: 12, color: "var(--red-600)", marginBottom: 8, fontWeight: 600 }}>
                  ⚠ No hay valor configurado — la integración correspondiente no funcionará.
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

function StatusBadge({ inDb, inEnv }: { inDb: boolean; inEnv: boolean }) {
  const config: { label: string; bg: string; color: string } = inDb
    ? { label: "BBDD (override)", bg: "rgba(34, 197, 94, 0.12)", color: "var(--green-d)" }
    : inEnv
    ? { label: ".env",            bg: "rgba(148, 163, 184, 0.15)", color: "var(--slate-600)" }
    : { label: "no configurado",  bg: "rgba(239, 68, 68, 0.12)",   color: "var(--red-600)" }
  return (
    <span style={{
      flexShrink: 0,
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      background: config.bg,
      color: config.color,
    }}>
      {config.label}
    </span>
  )
}
