import { getConfig } from "@/lib/appConfig"
import { CONFIG_CATALOG, type ConfigEntry, type ConfigCategory } from "@/lib/configCatalog"
import { ConfigForm } from "./ConfigForm"
import { Sliders, ToggleLeft, MessageSquareText } from "lucide-react"

export const dynamic = "force-dynamic"

/**
 * Panel admin: muestra los formularios de edición agrupados por
 * categoría (quotas, features, messages). Cada form llama a
 * updateConfigAction (Server Action) que requireAdmin() valida.
 *
 * Los valores actuales se cargan desde BBDD; si no existen, se
 * muestra el default del catálogo. El form envía el value y la
 * action persiste + revalida la ruta.
 */
export default async function AdminPage() {
  // Cargamos en paralelo el valor actual de cada entrada
  const currentByKey = new Map<string, unknown>()
  await Promise.all(
    CONFIG_CATALOG.map(async (entry) => {
      const current = await getConfig(entry.key, entry.default)
      currentByKey.set(entry.key, current)
    })
  )

  const groups: { category: ConfigCategory; title: string; icon: React.ReactNode; entries: ConfigEntry[] }[] = [
    {
      category: "quotas",
      title:    "Quotas y límites",
      icon:     <Sliders className="h-5 w-5" />,
      entries:  CONFIG_CATALOG.filter((c) => c.category === "quotas"),
    },
    {
      category: "features",
      title:    "Features y mantenimiento",
      icon:     <ToggleLeft className="h-5 w-5" />,
      entries:  CONFIG_CATALOG.filter((c) => c.category === "features"),
    },
    {
      category: "messages",
      title:    "Mensajes y textos",
      icon:     <MessageSquareText className="h-5 w-5" />,
      entries:  CONFIG_CATALOG.filter((c) => c.category === "messages"),
    },
  ]

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.category}>
          <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            {group.icon}
            {group.title}
          </h2>
          <div className="card-soft" style={{ padding: 20 }}>
            <div className="space-y-5">
              {group.entries.map((entry) => (
                <ConfigForm
                  key={entry.key}
                  entry={entry}
                  current={currentByKey.get(entry.key) as number | boolean | string}
                />
              ))}
            </div>
          </div>
        </section>
      ))}

      <p style={{ fontSize: 12, color: "var(--slate-500)" }}>
        Los cambios se aplican inmediatamente. Algunas páginas tienen cache —
        si no ves el efecto, recarga (Ctrl+F5).
      </p>
    </div>
  )
}
