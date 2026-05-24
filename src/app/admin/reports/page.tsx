import Link from "next/link"
import { ChevronLeft, MessageSquareWarning, AlertTriangle, Mail, User as UserIcon } from "lucide-react"
import { db } from "@/lib/db"
import { questionToSlug } from "@/lib/questionUrl"
import {
  REPORT_STATUSES,
  REPORT_STATUS_LABEL,
  isReportStatus,
  reportTypeLabel,
  type ReportStatus,
} from "@/lib/questionReports"
import { GroupedReportActions } from "./GroupedReportActions"

export const dynamic = "force-dynamic"

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

/**
 * Panel admin para revisar las incidencias reportadas por usuarios sobre
 * preguntas. Listadas por defecto en status=pending y orden createdAt DESC.
 *
 * El filtro de status se pasa por querystring (`?status=fixed`) — así el
 * admin puede compartir un enlace a "lo que queda pendiente" sin estado
 * de UI client-side. Si el querystring no es válido, fallback a pending.
 *
 * Cada item enlaza a la pregunta pública (/preguntas/[cat]/[slug]) en una
 * tab nueva para que el admin pueda verificar el reporte sin perder la
 * lista. Las acciones (revisado/fixed/dismissed) viven en un client
 * component aparte (ReportActions) que llama a una server action.
 */
export default async function AdminReportsPage({ searchParams }: PageProps) {
  const { status: rawStatus } = await searchParams
  const filterStatus: ReportStatus = isReportStatus(rawStatus ?? "")
    ? (rawStatus as ReportStatus)
    : "pending"

  // Contadores por status — para el panel de filtros con badges.
  const counts = await db.questionReport.groupBy({
    by:      ["status"],
    _count:  { _all: true },
  })
  const countByStatus = new Map<string, number>(
    counts.map((c) => [c.status, c._count._all])
  )

  // Reports del filtro actual. include question + category + (opcional) user.
  const reports = await db.questionReport.findMany({
    where:   { status: filterStatus },
    orderBy: { createdAt: "desc" },
    include: {
      question: {
        include: {
          testQuestions: {
            take:    1,
            orderBy: { test: { testNumber: "asc" } },
            include: { test: { include: { category: true } } },
          },
        },
      },
    },
    take: 200,
  })

  // Cargamos usuarios en una sola query (las reports pueden ser de guests
  // sin userId, que no añadimos a la lista). Es un join manual para
  // evitar añadir una relación bidireccional User<->QuestionReport sólo
  // para esto — la relación existiría sin onDelete real (queremos
  // conservar histórico aunque el user se borre).
  const userIds = Array.from(
    new Set(reports.map((r) => r.userId).filter((x): x is number => x !== null))
  )
  const userById = new Map<number, { username: string; displayName: string | null }>()
  if (userIds.length > 0) {
    const users = await db.user.findMany({
      where:  { id: { in: userIds } },
      select: { id: true, username: true, displayName: true },
    })
    for (const u of users) {
      userById.set(u.id, { username: u.username, displayName: u.displayName })
    }
  }

  return (
    <div>
      <Link href="/admin" className="back-link" style={{ marginBottom: 14 }}>
        <ChevronLeft className="h-4 w-4" />
        Admin
      </Link>

      <h2
        style={{
          fontSize:    22,
          fontWeight:  800,
          marginBottom: 6,
          display:     "flex",
          alignItems:  "center",
          gap:         8,
        }}
      >
        <MessageSquareWarning className="h-5 w-5" style={{ color: "var(--amber-d, #92400e)" }} />
        Incidencias reportadas
      </h2>
      <p style={{ color: "var(--slate-500)", fontSize: 13.5, marginBottom: 18, marginTop: 0 }}>
        Las preguntas pueden tener erratas, imágenes rotas o opciones repetidas.
        Aquí salen las que los usuarios han reportado. Revisa, arregla la pregunta
        si procede, marca como fixed o descarta si era un falso positivo.
      </p>

      {/* Filtro por status como pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
        {REPORT_STATUSES.map((s) => {
          const isActive = s === filterStatus
          const count    = countByStatus.get(s) ?? 0
          return (
            <Link
              key={s}
              href={`/admin/reports?status=${s}`}
              className="card-soft"
              style={{
                padding:       "8px 14px",
                fontSize:      13,
                fontWeight:    700,
                textDecoration: "none",
                color:         isActive ? "#fff" : "var(--slate-700)",
                background:    isActive ? "var(--orange-600)" : "#fff",
                border:        isActive ? "1px solid var(--orange-600)" : "1px solid var(--slate-200)",
                display:       "inline-flex",
                alignItems:    "center",
                gap:           8,
              }}
            >
              {REPORT_STATUS_LABEL[s]}
              <span
                style={{
                  padding:      "1px 8px",
                  borderRadius: 999,
                  background:   isActive ? "rgba(255,255,255,0.25)" : "var(--slate-100)",
                  color:        isActive ? "#fff" : "var(--slate-600)",
                  fontSize:     11,
                  fontWeight:   800,
                }}
              >
                {count}
              </span>
            </Link>
          )
        })}
      </div>

      {reports.length === 0 ? (
        <div
          className="card-soft"
          style={{
            padding:    28,
            textAlign:  "center",
            color:      "var(--slate-500)",
            border:     "1px dashed var(--slate-200)",
          }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            No hay reportes con status &quot;{REPORT_STATUS_LABEL[filterStatus]}&quot;.
          </p>
        </div>
      ) : (
        (() => {
          // ── Agrupamos los reports por questionId ─────────────────────
          // Una sola card por pregunta con N incidencias acumuladas. Los
          // reports ya vienen ordenados por createdAt DESC, así que la
          // primera entrada de cada grupo es la más reciente — la usamos
          // para la fecha mostrada en la cabecera.
          type ReportRow = typeof reports[number]
          interface Group {
            questionId:    number
            question:      ReportRow["question"]
            items:         ReportRow[]
            mostRecentAt:  Date
            typeCounts:    Map<string, number>
          }
          const groupsMap = new Map<number, Group>()
          for (const r of reports) {
            const g = groupsMap.get(r.question.id)
            if (g) {
              g.items.push(r)
              g.typeCounts.set(r.type, (g.typeCounts.get(r.type) ?? 0) + 1)
              if (r.createdAt > g.mostRecentAt) g.mostRecentAt = r.createdAt
            } else {
              groupsMap.set(r.question.id, {
                questionId:   r.question.id,
                question:     r.question,
                items:        [r],
                mostRecentAt: r.createdAt,
                typeCounts:   new Map([[r.type, 1]]),
              })
            }
          }
          const groups = Array.from(groupsMap.values())
            .sort((a, b) => b.mostRecentAt.getTime() - a.mostRecentAt.getTime())

          return (
            <div style={{ display: "grid", gap: 12 }}>
              {groups.map((g) => {
                const cat         = g.question.testQuestions[0]?.test.category
                const slug        = questionToSlug({ id: g.question.id, enunciado: g.question.enunciado })
                const questionUrl = cat ? `/preguntas/${cat.slug}/${slug}` : null
                const count       = g.items.length
                return (
                  <article
                    key={g.questionId}
                    className="card-soft"
                    style={{ padding: 18, display: "grid", gap: 10 }}
                  >
                    {/* Cabecera: contador grande + tipos distintos + fecha más reciente */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        title={count === 1 ? "1 incidencia" : `${count} incidencias acumuladas sobre esta pregunta`}
                        style={{
                          display:      "inline-flex",
                          alignItems:   "center",
                          gap:          6,
                          padding:      "3px 10px",
                          borderRadius: 999,
                          background:   count > 1 ? "rgba(239, 68, 68, 0.12)" : "rgba(245, 158, 11, 0.10)",
                          color:        count > 1 ? "var(--red-600)" : "var(--amber-d, #92400e)",
                          fontSize:     11.5,
                          fontWeight:   800,
                        }}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {count === 1 ? "1 incidencia" : `${count} incidencias`}
                      </span>
                      {/* Chips de los tipos distintos */}
                      {Array.from(g.typeCounts.entries()).map(([type, n]) => (
                        <span
                          key={type}
                          style={{
                            padding:      "2px 8px",
                            borderRadius: 999,
                            background:   "var(--slate-100)",
                            color:        "var(--slate-700)",
                            fontSize:     11,
                            fontWeight:   700,
                          }}
                        >
                          {reportTypeLabel(type)}{n > 1 ? ` ×${n}` : ""}
                        </span>
                      ))}
                      <span style={{ fontSize: 12, color: "var(--slate-500)" }}>
                        última: {formatDate(g.mostRecentAt)}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--slate-500)", fontWeight: 600 }}>
                        #{g.questionId}
                      </span>
                    </div>

                    {/* Enunciado + meta */}
                    <div>
                      {questionUrl ? (
                        <Link
                          href={questionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize:       15,
                            fontWeight:     700,
                            color:          "var(--orange-700, #c2410c)",
                            textDecoration: "none",
                            lineHeight:     1.4,
                          }}
                        >
                          {g.question.enunciado}
                        </Link>
                      ) : (
                        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--slate-700)" }}>
                          {g.question.enunciado}
                        </span>
                      )}
                      <div style={{ fontSize: 11.5, color: "var(--slate-500)", marginTop: 4 }}>
                        Pregunta #{g.question.id}
                        {g.question.codigoTema && <> · {g.question.codigoTema}</>}
                        {cat && <> · {cat.name}</>}
                      </div>
                    </div>

                    {/* Lista de incidencias individuales del grupo */}
                    <ul
                      style={{
                        margin:       0,
                        padding:      0,
                        listStyle:    "none",
                        display:      "grid",
                        gap:          8,
                        borderTop:    "1px dashed var(--slate-200)",
                        paddingTop:   10,
                      }}
                    >
                      {g.items.map((r) => {
                        const user      = r.userId !== null ? userById.get(r.userId) : null
                        const userLabel = user ? (user.displayName ?? user.username) : "Guest"
                        return (
                          <li
                            key={r.id}
                            style={{
                              padding:      "8px 12px",
                              borderRadius: 8,
                              background:   "var(--slate-50, #f8fafc)",
                              border:       "1px solid var(--slate-100)",
                              display:      "grid",
                              gap:          4,
                              fontSize:     12.5,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--slate-600)" }}>
                              <span style={{ fontWeight: 700, color: "var(--slate-700)" }}>
                                {reportTypeLabel(r.type)}
                              </span>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                <UserIcon className="h-3 w-3" />
                                {userLabel}
                              </span>
                              {r.guestEmail && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                  <Mail className="h-3 w-3" />
                                  <a href={`mailto:${r.guestEmail}`} style={{ color: "var(--slate-600)" }}>
                                    {r.guestEmail}
                                  </a>
                                </span>
                              )}
                              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--slate-400)" }}>
                                {formatDate(r.createdAt)} · #{r.id}
                              </span>
                            </div>
                            {r.comment && (
                              <blockquote
                                style={{
                                  margin:     0,
                                  padding:    "4px 0 0 10px",
                                  borderLeft: "2px solid var(--slate-300)",
                                  fontSize:   13,
                                  lineHeight: 1.45,
                                  color:      "var(--slate-700)",
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {r.comment}
                              </blockquote>
                            )}
                          </li>
                        )
                      })}
                    </ul>

                    {/* Acciones bulk sobre todas las incidencias del grupo */}
                    <div
                      style={{
                        display:        "flex",
                        justifyContent: "flex-end",
                        gap:            12,
                        flexWrap:       "wrap",
                        borderTop:      "1px solid var(--slate-100)",
                        paddingTop:     10,
                      }}
                    >
                      <GroupedReportActions
                        questionId={g.questionId}
                        groupCount={count}
                        currentStatus={filterStatus}
                      />
                    </div>
                  </article>
                )
              })}
            </div>
          )
        })()
      )}
    </div>
  )
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    day:    "2-digit",
    month:  "short",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  }).format(d)
}
