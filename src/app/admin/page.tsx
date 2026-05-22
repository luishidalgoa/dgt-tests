import { listAllConfig } from "@/lib/appConfig"
import { Sliders } from "lucide-react"

export const dynamic = "force-dynamic"

/**
 * Página principal del panel admin. Por ahora solo muestra la lista de
 * configuración actual (read-only). Los formularios para editar van en
 * Fase 92.
 *
 * El guard de acceso vive en src/app/admin/layout.tsx (requireAdmin).
 */
export default async function AdminPage() {
  const configs = await listAllConfig()
  const nonSecret = configs.filter(c => !c.encrypted)
  const secret    = configs.filter(c => c.encrypted)

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <Sliders className="h-5 w-5" />
        Configuración runtime
      </h2>

      {configs.length === 0 ? (
        <div className="empty-state">
          <span className="ico">🧩</span>
          Todavía no hay nada configurado.<br />
          <small style={{ color: "var(--slate-500)", marginTop: 8, display: "block" }}>
            En Fase 92 añadimos los formularios para crear quotas, feature flags, etc.
          </small>
        </div>
      ) : (
        <div className="card-soft" style={{ padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--slate-200)", textAlign: "left", fontSize: 12, textTransform: "uppercase", color: "var(--slate-500)" }}>
                <th style={{ padding: 12 }}>Key</th>
                <th style={{ padding: 12 }}>Valor</th>
                <th style={{ padding: 12 }}>Tipo</th>
                <th style={{ padding: 12 }}>Última edición</th>
              </tr>
            </thead>
            <tbody>
              {nonSecret.map(c => (
                <tr key={c.key} style={{ borderBottom: "1px solid var(--slate-100)" }}>
                  <td style={{ padding: 12, fontFamily: "monospace" }}>{c.key}</td>
                  <td style={{ padding: 12, fontFamily: "monospace" }}>{JSON.stringify(c.value)}</td>
                  <td style={{ padding: 12 }}><Badge>plain</Badge></td>
                  <td style={{ padding: 12, fontSize: 12, color: "var(--slate-500)" }}>
                    {c.updatedAt.toLocaleString("es-ES")}
                  </td>
                </tr>
              ))}
              {secret.map(c => (
                <tr key={c.key} style={{ borderBottom: "1px solid var(--slate-100)" }}>
                  <td style={{ padding: 12, fontFamily: "monospace" }}>{c.key}</td>
                  <td style={{ padding: 12, fontFamily: "monospace", color: "var(--slate-400)" }}>•••••••• (cifrado)</td>
                  <td style={{ padding: 12 }}><Badge variant="secret">secret</Badge></td>
                  <td style={{ padding: 12, fontSize: 12, color: "var(--slate-500)" }}>
                    {c.updatedAt.toLocaleString("es-ES")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--slate-500)" }}>
        Los formularios de creación/edición llegan en Fase 92. Esta página es solo lectura por ahora.
      </p>
    </div>
  )
}

function Badge({ children, variant }: { children: React.ReactNode; variant?: "secret" }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      background: variant === "secret" ? "rgba(234, 88, 12, 0.15)" : "rgba(148, 163, 184, 0.15)",
      color:      variant === "secret" ? "var(--orange-600)"        : "var(--slate-600)",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
    }}>
      {children}
    </span>
  )
}
