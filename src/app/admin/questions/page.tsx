import Link from "next/link"
import { Pencil, ChevronLeft, ChevronRight, ListChecks, Search, MessageSquareWarning } from "lucide-react"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { classifyCodigoTema } from "@/lib/temas"
import { QuestionsFilters } from "./QuestionsFilters"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

interface PageProps {
  searchParams: Promise<{
    padre?:     string
    bloque?:    string
    sub?:       string
    id?:        string
    q?:         string
    tier?:      string         // "FREE" | "PRO" | "" (todas)
    categoria?: string         // category.slug
    page?:      string
  }>
}

/**
 * Panel admin: listado paginado de preguntas con filtros para localizar
 * y editar. La acción por fila lleva a /admin/questions/[id]/edit.
 *
 * Filtros (via searchParams para que cada combinación sea URL-shareable):
 *   - tema padre / bloque / sub (parseados de codigoTema con classifyCodigoTema)
 *   - id exacto
 *   - búsqueda libre en enunciado (LIKE %q%, case-insensitive)
 *   - tier (FREE / PRO)
 *   - categoría (slug: permiso-b, repaso-final, adas)
 *
 * NO aplicamos QUESTION_VISIBLE_WHERE: el panel admin lo es para ver
 * TODO, incluidas pendientes / descartadas. Si quieres filtrar IA
 * pendientes hay paneles dedicados.
 */
export default async function AdminQuestionsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1)
  const idFilter = sp.id ? parseInt(sp.id, 10) : null

  // Catálogo de categorías para el select del filtro.
  const categories = await db.category.findMany({
    select:  { slug: true, name: true },
    orderBy: { id: "asc" },
  })

  // ── Construir WHERE Prisma ────────────────────────────────────────
  const where: Prisma.QuestionWhereInput = {}

  if (idFilter && Number.isInteger(idFilter) && idFilter > 0) {
    where.id = idFilter
  }
  if (sp.q && sp.q.trim().length > 0) {
    // SQLite LIKE es case-insensitive por defecto para ASCII; aún así
    // pasamos `mode: "insensitive"` por si en el futuro cambiamos de
    // motor. libsql lo respeta como hint.
    where.enunciado = { contains: sp.q.trim() }
  }
  if (sp.tier === "FREE" || sp.tier === "PRO") {
    where.tier = sp.tier
  }
  if (sp.categoria && sp.categoria.length > 0) {
    where.testQuestions = {
      some: { test: { category: { slug: sp.categoria } } },
    }
  }
  // Para padre/bloque/sub, codigoTema es jerárquico — usamos `startsWith`
  // de la forma "TC <bloque>" cuando se pide bloque, "TC <padre>" cuando
  // se pide solo padre. El filtro "sub" implica filtrar tras hacer la
  // query (no es un prefix sencillo del string), por eso lo aplicamos
  // en memoria abajo si está activo.
  if (sp.bloque) {
    where.codigoTema = { startsWith: `TC ${sp.bloque}` }
  } else if (sp.padre) {
    // padre suelto = "1", queremos "TC 1" pero NO "TC 10". Por eso
    // restringimos con un OR de patterns: "TC 1\b" no existe en LIKE,
    // así que comparamos en JS tras un fetch ancho. Para volúmenes
    // típicos (~2.500) sigue siendo rápido.
    where.codigoTema = { startsWith: `TC ${sp.padre}` }
  }

  // ── Contar total y traer la página ──────────────────────────────
  // Tipo de fila que cargamos: incluye la relación lastEditedByUser para
  // pintar "última edición por X" en la tabla.
  type Row = Prisma.QuestionGetPayload<{
    include: { lastEditedByUser: { select: { username: true; displayName: true } } }
  }>
  let total: number
  let rows: Row[]

  // Si hay filtros de sub o padre estricto, fetch sin take y filtramos
  // en memoria (precisión correcta del codigoTema jerárquico).
  const needsMemoryFilter = Boolean(sp.sub) || Boolean(sp.padre && !sp.bloque)

  if (needsMemoryFilter) {
    const all = await db.question.findMany({
      where,
      orderBy: [{ id: "desc" }],
      include: {
        lastEditedByUser: { select: { username: true, displayName: true } },
      },
    })
    const filtered = all.filter((q) => {
      const cls = classifyCodigoTema(q.codigoTema)
      if (sp.padre && cls?.padreCode !== sp.padre) return false
      if (sp.sub) {
        // Match exacto del sub, o prefix si el usuario pegó solo un
        // segmento padre (ej "1.2" debería incluir "1.2.5.3"). Aplicamos
        // startsWith con un separador final que se mete a sub-bloques.
        const sub = cls?.subCode
        if (!sub) return false
        if (sub !== sp.sub && !sub.startsWith(`${sp.sub}.`)) return false
      }
      return true
    })
    total = filtered.length
    rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  } else {
    total = await db.question.count({ where })
    rows = await db.question.findMany({
      where,
      orderBy: [{ id: "desc" }],
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
      include: {
        lastEditedByUser: { select: { username: true, displayName: true } },
      },
    })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Conteo de reports PENDIENTES por pregunta de la página actual. Una
  // sola query agrupada — no añadimos columna oculta cuando no hay reports
  // (UI los esconde con el ?? 0). Le damos visibilidad sin tocar el filtro.
  const pendingReportsByQuestion = new Map<number, number>()
  if (rows.length > 0) {
    const reportCounts = await db.questionReport.groupBy({
      by:     ["questionId"],
      where:  { questionId: { in: rows.map((r) => r.id) }, status: "pending" },
      _count: { _all: true },
    })
    for (const c of reportCounts) {
      pendingReportsByQuestion.set(c.questionId, c._count._all)
    }
  }

  return (
    <div>
      <Link href="/admin" className="back-link" style={{ marginBottom: 14 }}>
        <ChevronLeft className="h-4 w-4" />
        Admin
      </Link>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <ListChecks className="h-5 w-5" />
        Editor de preguntas
      </h2>
      <p style={{ color: "var(--slate-500)", fontSize: 13.5, marginBottom: 18, marginTop: 0 }}>
        Listado del banco completo (humanas + IA en cualquier estado). Filtra y
        edita lo que necesites corregir. Los cambios revalidan caché en el
        sitio público al instante; para subirlos a Turso desde dev usa
        {" "}
        <code style={{ background: "var(--slate-100)", padding: "1px 6px", borderRadius: 4 }}>
          npm run turso:sync-question -- --id N
        </code>.
      </p>

      <QuestionsFilters
        initial={{
          padre:     sp.padre     ?? "",
          bloque:    sp.bloque    ?? "",
          sub:       sp.sub       ?? "",
          id:        sp.id        ?? "",
          q:         sp.q         ?? "",
          tier:      sp.tier      ?? "",
          categoria: sp.categoria ?? "",
        }}
        categories={categories}
      />

      <div style={{ fontSize: 13, color: "var(--slate-600)", margin: "10px 0 14px" }}>
        <b className="font-mono-tabular">{total}</b>{" "}
        {total === 1 ? "pregunta encontrada" : "preguntas encontradas"}
        {totalPages > 1 && (
          <span style={{ color: "var(--slate-400)" }}>
            {" · página "}<b>{page}</b>{" de "}<b>{totalPages}</b>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card-soft" style={{ padding: 28, textAlign: "center", color: "var(--slate-500)", border: "1px dashed var(--slate-200)" }}>
          <Search className="h-6 w-6" style={{ margin: "0 auto 8px", color: "var(--slate-400)" }} />
          <p style={{ margin: 0, fontSize: 14 }}>
            Ninguna pregunta coincide con los filtros aplicados.
          </p>
        </div>
      ) : (
        <div className="card-soft" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(148, 163, 184, 0.06)", textAlign: "left" }}>
                  <Th style={{ width: 70 }}>ID</Th>
                  <Th style={{ width: 180 }}>codigoTema</Th>
                  <Th>Enunciado</Th>
                  <Th style={{ width: 70 }}>Tier</Th>
                  <Th style={{ width: 60 }}>IA</Th>
                  <Th style={{ width: 70 }}>Reports</Th>
                  <Th style={{ width: 160 }}>Última edición</Th>
                  <Th style={{ width: 90 }}>Acción</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} style={{ borderTop: "1px solid var(--slate-100)" }}>
                    <Td>
                      <span className="font-mono-tabular" style={{ color: "var(--slate-500)" }}>#{q.id}</span>
                    </Td>
                    <Td>
                      {q.codigoTema ? (
                        <span className="font-mono-tabular" style={{
                          padding: "2px 8px", borderRadius: 6,
                          background: "rgba(168, 85, 247, 0.10)",
                          color: "rgb(126, 34, 206)",
                          fontSize: 11, fontWeight: 700,
                        }}>
                          {q.codigoTema}
                        </span>
                      ) : (
                        <span style={{ color: "var(--slate-400)", fontStyle: "italic", fontSize: 11 }}>
                          (sin código)
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        lineHeight: 1.35,
                        maxWidth: 540,
                      }}>
                        {q.enunciado}
                      </div>
                    </Td>
                    <Td>
                      <span style={{
                        padding: "2px 8px", borderRadius: 999,
                        background: q.tier === "FREE" ? "rgba(34, 197, 94, 0.12)" : "rgba(245, 158, 11, 0.15)",
                        color:      q.tier === "FREE" ? "var(--green-d)"          : "var(--amber-d, #92400e)",
                        fontSize: 11, fontWeight: 800,
                      }}>
                        {q.tier}
                      </span>
                    </Td>
                    <Td>
                      {q.aiGenerated ? (
                        <span title={q.aiApproved === true ? "Aprobada" : q.aiApproved === false ? "Descartada" : "Pendiente"} style={{
                          padding: "1px 6px", borderRadius: 4,
                          background: "rgba(168, 85, 247, 0.10)",
                          color: "rgb(126, 34, 206)",
                          fontSize: 10, fontWeight: 800,
                        }}>
                          {q.aiApproved === true ? "✓" : q.aiApproved === false ? "✗" : "…"}
                        </span>
                      ) : (
                        <span style={{ color: "var(--slate-300)", fontSize: 11 }}>—</span>
                      )}
                    </Td>
                    <Td>
                      {(pendingReportsByQuestion.get(q.id) ?? 0) > 0 ? (
                        <Link
                          href="/admin/reports"
                          title={`${pendingReportsByQuestion.get(q.id)} incidencias pendientes sobre esta pregunta`}
                          style={{
                            display:        "inline-flex",
                            alignItems:     "center",
                            gap:            4,
                            padding:        "2px 8px",
                            borderRadius:   999,
                            background:     "rgba(245, 158, 11, 0.12)",
                            color:          "var(--amber-d, #92400e)",
                            fontSize:       11,
                            fontWeight:     800,
                            textDecoration: "none",
                          }}
                        >
                          <MessageSquareWarning className="h-3 w-3" />
                          {pendingReportsByQuestion.get(q.id)}
                        </Link>
                      ) : (
                        <span style={{ color: "var(--slate-300)", fontSize: 11 }}>—</span>
                      )}
                    </Td>
                    <Td>
                      {q.lastEditedAt ? (
                        <div style={{ fontSize: 11.5, color: "var(--slate-600)" }}>
                          {formatRelative(q.lastEditedAt)}
                          {q.lastEditedByUser && (
                            <div style={{ fontSize: 10.5, color: "var(--slate-400)" }}>
                              por {q.lastEditedByUser.displayName || q.lastEditedByUser.username}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: "var(--slate-300)", fontSize: 11 }}>—</span>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/questions/${q.id}/edit`}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "5px 10px",
                          borderRadius: 6,
                          background: "var(--orange-600)",
                          color: "white",
                          fontSize: 12, fontWeight: 700,
                          textDecoration: "none",
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Editar
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <Pagination current={page} total={totalPages} searchParams={sp} />
      )}
    </div>
  )
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{
      padding: "10px 12px",
      fontSize: 11,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      color: "var(--slate-500)",
      ...style,
    }}>
      {children}
    </th>
  )
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{
      padding: "10px 12px",
      verticalAlign: "middle",
      ...style,
    }}>
      {children}
    </td>
  )
}

function Pagination({ current, total, searchParams }: {
  current: number
  total: number
  searchParams: Awaited<PageProps["searchParams"]>
}) {
  function pageHref(p: number): string {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "page") continue
      if (typeof v === "string" && v.length > 0) qs.set(k, v)
    }
    if (p > 1) qs.set("page", String(p))
    const s = qs.toString()
    return s ? `/admin/questions?${s}` : "/admin/questions"
  }
  const prev = current > 1 ? current - 1 : null
  const next = current < total ? current + 1 : null
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 20 }}>
      {prev ? (
        <Link href={pageHref(prev)} style={pagBtnStyle}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </Link>
      ) : (
        <span style={{ ...pagBtnStyle, opacity: 0.4, pointerEvents: "none" }}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </span>
      )}
      <span style={{ fontSize: 13, color: "var(--slate-500)" }}>
        {current} / {total}
      </span>
      {next ? (
        <Link href={pageHref(next)} style={pagBtnStyle}>
          Siguiente <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <span style={{ ...pagBtnStyle, opacity: 0.4, pointerEvents: "none" }}>
          Siguiente <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </div>
  )
}

const pagBtnStyle: React.CSSProperties = {
  display:      "inline-flex",
  alignItems:   "center",
  gap:          4,
  padding:      "6px 12px",
  borderRadius: 8,
  border:       "1.5px solid var(--slate-200)",
  background:   "#fff",
  color:        "var(--slate-700)",
  fontSize:     13,
  fontWeight:   600,
  textDecoration: "none",
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 1) return "ahora mismo"
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  const diffD = Math.round(diffH / 24)
  if (diffD < 14) return `hace ${diffD} d`
  return d.toLocaleDateString("es-ES")
}
