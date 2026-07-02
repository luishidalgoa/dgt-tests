import Link from "next/link"
import { getConfig } from "@/lib/appConfig"
import { CONFIG_CATALOG, type ConfigEntry, type ConfigCategory } from "@/lib/configCatalog"
import { getEffectiveSecret } from "@/lib/secretCatalog"
import { db } from "@/lib/db"
import { QUESTION_APPROVED_AI_WHERE, QUESTION_PENDING_REVIEW_WHERE } from "@/lib/questions"
import { ConfigForm } from "./ConfigForm"
import { Sliders, ToggleLeft, MessageSquareText, Sparkles, Mail, ListChecks, ArrowRight, Pencil, MessageSquareWarning, BarChart3, Bug, Cloud, ExternalLink, Image as ImageIcon } from "lucide-react"

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

  // Métricas de paneles secundarios (badge counts)
  const pendingReviewCount  = await db.question.count({ where: QUESTION_PENDING_REVIEW_WHERE })
  const approvedAiCount     = await db.question.count({ where: QUESTION_APPROVED_AI_WHERE })
  const totalQuestions      = await db.question.count()
  const pendingReportsCount = await db.questionReport.count({ where: { status: "pending" } })

  // URL al bucket R2 — la construimos en render leyendo los secrets para
  // que se mantenga sincronizada con la config actual. Si falta cualquiera
  // de los dos, fallback al overview general de R2 (Cloudflare resolverá
  // el `:account` automáticamente al estar logueado).
  const [r2AccountId, r2BucketName] = await Promise.all([
    getEffectiveSecret("R2_ACCOUNT_ID"),
    getEffectiveSecret("R2_BUCKET_NAME"),
  ])
  const r2BucketUrl = r2AccountId && r2BucketName
    ? `https://dash.cloudflare.com/${r2AccountId}/r2/default/buckets/${r2BucketName}`
    : "https://dash.cloudflare.com/?to=/:account/r2/overview"

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
    {
      category: "integrations",
      title:    "Integraciones IA",
      icon:     <Sparkles className="h-5 w-5" />,
      entries:  CONFIG_CATALOG.filter((c) => c.category === "integrations"),
    },
    {
      category: "email",
      title:    "Email / SMTP",
      icon:     <Mail className="h-5 w-5" />,
      entries:  CONFIG_CATALOG.filter((c) => c.category === "email"),
    },
  ]

  return (
    <div className="space-y-8">
      {/* Atajos a sub-paneles admin */}
      <section>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <ListChecks className="h-5 w-5" />
          Paneles
        </h2>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {/* El acceso a /admin/secrets vive en el botón "API keys" del
              nav superior (layout.tsx) — aquí lo eliminamos para no
              duplicar el enlace. */}
          <AdminLinkCard
            href="/admin/questions"
            icon={<Pencil className="h-5 w-5" />}
            title="Editar preguntas"
            description="Listado paginado del banco completo con filtros para revisar y corregir el enunciado, las opciones o la explicación de cualquier pregunta."
            badge={totalQuestions > 0 ? `${totalQuestions} en banco` : undefined}
          />
          <AdminLinkCard
            href="/admin/review-questions"
            icon={<Sparkles className="h-5 w-5" />}
            title="Revisar preguntas IA"
            description="Aprobar o descartar preguntas generadas por `npm run questions:generate`."
            badge={pendingReviewCount > 0 ? `${pendingReviewCount} pendientes` : undefined}
          />
          <AdminLinkCard
            href="/admin/ai-questions"
            icon={<Sparkles className="h-5 w-5" />}
            title="Preguntas IA aprobadas"
            description="Auditoría de las preguntas IA ya aprobadas, filtrable por tema/bloque/sub-bloque."
            badge={approvedAiCount > 0 ? `${approvedAiCount} en circulación` : undefined}
          />
          <AdminLinkCard
            href="/admin/reports"
            icon={<MessageSquareWarning className="h-5 w-5" />}
            title="Incidencias reportadas"
            description="Reportes de usuarios sobre preguntas con errata, imagen rota, opciones repetidas, etc."
            badge={pendingReportsCount > 0 ? `${pendingReportsCount} pendientes` : undefined}
          />
          <AdminLinkCard
            href="/admin/images-bank"
            icon={<ImageIcon className="h-5 w-5" />}
            title="Banco de imágenes (dev)"
            description="Vista del banco clasificado por SigLIP — filtra por tag o por imágenes sin clasificar. Solo funciona en local con sanitize/ poblado."
          />
        </div>
      </section>

      {/* Herramientas externas — dashboards de monitorización y analytics.
          Cada link abre el provider en pestaña nueva (target="_blank") y
          NO requieren navegación dentro de la app. */}
      <section>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <ExternalLink className="h-5 w-5" />
          Herramientas externas
        </h2>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <AdminExternalCard
            href="https://cloud.umami.is/websites/e275a86c-edbb-4b6b-ac2a-e3ae6a80437c"
            icon={<BarChart3 className="h-5 w-5" />}
            title="Umami · Analytics"
            description="Visitantes, eventos (signup, subscription, test_completed), funnels de conversión. Datos en tiempo real, sin cookies."
          />
          <AdminExternalCard
            href="https://luishidalgoa.sentry.io/issues/?project=dgt-tests"
            icon={<Bug className="h-5 w-5" />}
            title="Sentry · Errores"
            description="Stack traces de errores en producción, agrupados por tipo. Filtra por environment=production para ver lo real."
          />
          <AdminExternalCard
            href={r2BucketUrl}
            icon={<Cloud className="h-5 w-5" />}
            title="Cloudflare R2 · Bucket"
            description={
              r2AccountId && r2BucketName
                ? `Imágenes del banco DGT. Bucket "${r2BucketName}" — ver objects, métricas de uso y configuración del CDN público.`
                : "Configura R2_ACCOUNT_ID y R2_BUCKET_NAME en /admin/secrets para enlace directo al bucket. Por ahora abre el overview de R2."
            }
          />
        </div>
      </section>

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

function AdminLinkCard({ href, icon, title, description, badge }: {
  href:        string
  icon:        React.ReactNode
  title:       string
  description: string
  badge?:      string
}) {
  return (
    <Link
      href={href}
      className="card-soft"
      style={{
        display:        "flex",
        alignItems:     "flex-start",
        gap:            12,
        padding:        16,
        textDecoration: "none",
        color:          "inherit",
      }}
    >
      <div style={{
        flexShrink: 0,
        width: 38, height: 38,
        borderRadius: 10,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(168, 85, 247, 0.10)",
        color: "rgb(126, 34, 206)",
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          {badge && (
            <span style={{
              padding: "1px 8px",
              borderRadius: 999,
              background: "rgba(245, 158, 11, 0.15)",
              color: "var(--amber-d)",
              fontSize: 10,
              fontWeight: 800,
            }}>
              {badge}
            </span>
          )}
        </div>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--slate-500)", lineHeight: 1.4 }}>
          {description}
        </p>
      </div>
      <ArrowRight className="h-4 w-4" style={{ color: "var(--slate-400)", flexShrink: 0, marginTop: 4 }} />
    </Link>
  )
}

/**
 * Variante de AdminLinkCard para enlaces EXTERNOS (Umami, Sentry, etc.).
 * Usa <a target="_blank"> en vez de <Link> de Next, y muestra el icono
 * ExternalLink en lugar de la flecha derecha para indicar visualmente
 * que abre otra pestaña.
 */
function AdminExternalCard({ href, icon, title, description }: {
  href:        string
  icon:        React.ReactNode
  title:       string
  description: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="card-soft"
      style={{
        display:        "flex",
        alignItems:     "flex-start",
        gap:            12,
        padding:        16,
        textDecoration: "none",
        color:          "inherit",
      }}
    >
      <div style={{
        flexShrink:     0,
        width:          38, height: 38,
        borderRadius:   10,
        display:        "inline-flex",
        alignItems:     "center",
        justifyContent: "center",
        background:     "rgba(14, 165, 233, 0.10)",   // sky-500 light bg
        color:          "rgb(2, 132, 199)",            // sky-700 fg
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
        </div>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--slate-500)", lineHeight: 1.4 }}>
          {description}
        </p>
      </div>
      <ExternalLink className="h-4 w-4" style={{ color: "var(--slate-400)", flexShrink: 0, marginTop: 4 }} />
    </a>
  )
}
