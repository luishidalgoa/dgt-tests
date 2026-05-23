import Link from "next/link"
import { db } from "@/lib/db"
import { QUESTION_APPROVED_AI_WHERE } from "@/lib/questions"
import { classifyCodigoTema, getTemaPadreName, getTemaName, compareTemaCodes } from "@/lib/temas"
import { getSubBloqueInfo } from "@/lib/manualIndice"
import { ChevronLeft, Sparkles, ListChecks, Filter } from "lucide-react"
import { ApprovedQuestionCard } from "./ApprovedQuestionCard"

interface PageProps {
  searchParams: Promise<{ tema?: string }>
}

export const dynamic = "force-dynamic"

/**
 * Panel admin: lista todas las preguntas IA que YA hemos aprobado y por
 * tanto están circulando en exámenes / tests / temas / competir.
 *
 * Filtro principal: por TEMA PADRE (TC 1, TC 2, …) mediante pills en la
 * parte superior. Dentro de cada tema, las preguntas se agrupan por
 * BLOQUE y SUB-BLOQUE con sus nombres legibles del catálogo
 * manualIndice.json — sirve también de "auditoría de cobertura" para
 * saber qué sub-bloques estamos enriqueciendo.
 *
 * Acción disponible por pregunta: descartar (revierte aprobación).
 * Para volver a aprobar una descartada hay que tirar de BBDD manual —
 * MVP, no es un flujo habitual.
 */
export default async function ApprovedAiQuestionsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const temaFiltro = sp.tema?.trim() || null

  const all = await db.question.findMany({
    where:   QUESTION_APPROVED_AI_WHERE,
    orderBy: [{ codigoTema: "asc" }, { id: "asc" }],
    include: { options: { orderBy: { letra: "asc" } } },
  })

  // ── Conteo global por tema padre (para las pills de filtro) ──────
  const countByPadre = new Map<string, number>()   // "1" → 12
  for (const q of all) {
    const cls = classifyCodigoTema(q.codigoTema)
    const padre = cls?.padreCode ?? "?"
    countByPadre.set(padre, (countByPadre.get(padre) ?? 0) + 1)
  }
  const padresOrdenados = Array.from(countByPadre.keys()).sort((a, b) =>
    compareTemaCodes(`TC ${a}`, `TC ${b}`)
  )

  // ── Filtrar por tema padre seleccionado ─────────────────────────
  const filtered = temaFiltro
    ? all.filter((q) => (classifyCodigoTema(q.codigoTema)?.padreCode ?? "?") === temaFiltro)
    : all

  // ── Agrupar Bloque > SubBloque para la sección filtrada ─────────
  // Estructura: padre → bloque → (subCode|null) → preguntas
  interface SubGroup {
    subCode:    string | null
    subTitulo:  string                       // "General" si subCode=null
    questions:  typeof filtered
  }
  interface BloqueGroup {
    bloqueCode:    string                     // ej "1.2"
    bloqueTitulo:  string                     // de manualIndice o fallback
    subGroups:     SubGroup[]
  }
  interface PadreGroup {
    padreCode:    string
    padreTitulo:  string
    bloques:      BloqueGroup[]
  }

  const padreMap = new Map<string, Map<string, Map<string, SubGroup>>>()
  for (const q of filtered) {
    const cls = classifyCodigoTema(q.codigoTema)
    const padreCode  = cls?.padreCode  ?? "?"
    const bloqueCode = cls?.bloqueCode ?? `${padreCode}.0`
    const subKey     = cls?.subCode    ?? "__general__"

    if (!padreMap.has(padreCode)) padreMap.set(padreCode, new Map())
    const bloqueLevel = padreMap.get(padreCode)!
    if (!bloqueLevel.has(bloqueCode)) bloqueLevel.set(bloqueCode, new Map())
    const subLevel = bloqueLevel.get(bloqueCode)!

    if (!subLevel.has(subKey)) {
      const subInfo = cls?.subCode ? getSubBloqueInfo(cls.subCode) : null
      subLevel.set(subKey, {
        subCode:   cls?.subCode ?? null,
        subTitulo: subInfo?.titulo ?? (cls?.subCode ?? "General"),
        questions: [],
      })
    }
    subLevel.get(subKey)!.questions.push(q)
  }

  // Aplanar a array ordenado
  const grouped: PadreGroup[] = []
  for (const [padreCode, bloqueLevel] of padreMap) {
    const bloques: BloqueGroup[] = []
    for (const [bloqueCode, subLevel] of bloqueLevel) {
      const subGroups: SubGroup[] = Array.from(subLevel.values())
        .sort((a, b) => {
          if (!a.subCode) return 1
          if (!b.subCode) return -1
          return a.subCode.localeCompare(b.subCode, undefined, { numeric: true })
        })
      bloques.push({
        bloqueCode,
        bloqueTitulo: getTemaName(`TC ${bloqueCode}`),
        subGroups,
      })
    }
    bloques.sort((a, b) =>
      a.bloqueCode.localeCompare(b.bloqueCode, undefined, { numeric: true })
    )
    grouped.push({
      padreCode,
      padreTitulo: getTemaPadreName(`TC ${padreCode}`),
      bloques,
    })
  }
  grouped.sort((a, b) => compareTemaCodes(`TC ${a.padreCode}`, `TC ${b.padreCode}`))

  return (
    <div>
      <Link href="/admin" className="back-link" style={{ marginBottom: 14 }}>
        <ChevronLeft className="h-4 w-4" />
        Admin
      </Link>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles className="h-5 w-5" style={{ color: "rgb(34, 197, 94)" }} />
        Preguntas IA aprobadas
      </h2>
      <p style={{ color: "var(--slate-500)", fontSize: 13.5, marginBottom: 18, marginTop: 0 }}>
        Estas preguntas las generó IA y un admin las aprobó — ya circulan en exámenes,
        tests por tema, /test-errores y modo competir. Filtra por tema para auditarlas
        o descarta las que detectes que estaban mal aprobadas.
      </p>

      {/* Métrica global */}
      <div style={{ display: "flex", gap: 12, marginBottom: 22, flexWrap: "wrap", alignItems: "center" }}>
        <div
          className="card-soft"
          style={{
            padding:    "14px 18px",
            minWidth:   160,
            background: "rgba(34, 197, 94, 0.10)",
            border:     "1px solid rgba(34, 197, 94, 0.30)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <ListChecks className="inline h-3 w-3" style={{ marginRight: 4 }} />
            Total aprobadas
          </div>
          <div className="font-mono-tabular" style={{ fontSize: 28, fontWeight: 900, color: "var(--green-d)", marginTop: 4 }}>
            {all.length}
          </div>
        </div>
        {temaFiltro && (
          <div style={{ fontSize: 13, color: "var(--slate-600)" }}>
            <Filter className="inline h-3.5 w-3.5" style={{ marginRight: 4, verticalAlign: "-2px" }} />
            Mostrando <b>{filtered.length}</b> de <b>{all.length}</b> · filtrado por
            tema <b className="font-mono-tabular">TC {temaFiltro}</b>
            <Link href="/admin/ai-questions" style={{ marginLeft: 10, fontSize: 12, color: "var(--orange-600)" }}>
              quitar filtro
            </Link>
          </div>
        )}
      </div>

      {/* Pills de filtro por tema padre */}
      {padresOrdenados.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Filtrar por tema
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <FilterPill
              href="/admin/ai-questions"
              label="Todos"
              count={all.length}
              active={!temaFiltro}
            />
            {padresOrdenados.map((padreCode) => (
              <FilterPill
                key={padreCode}
                href={`/admin/ai-questions?tema=${encodeURIComponent(padreCode)}`}
                label={`TC ${padreCode} · ${getTemaPadreName(`TC ${padreCode}`)}`}
                count={countByPadre.get(padreCode) ?? 0}
                active={temaFiltro === padreCode}
              />
            ))}
          </div>
        </div>
      )}

      {/* Listado agrupado */}
      {all.length === 0 ? (
        <div className="card-soft" style={{ padding: 28, textAlign: "center", color: "var(--slate-500)", border: "1px dashed var(--slate-200)" }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            Aún no hay ninguna pregunta IA aprobada.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12 }}>
            Genera nuevas con <code style={{ background: "var(--slate-100)", padding: "1px 6px", borderRadius: 4 }}>npm run questions:generate</code>
            {" "}y apruébalas en{" "}
            <Link href="/admin/review-questions" style={{ color: "var(--orange-600)" }}>
              /admin/review-questions
            </Link>.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-soft" style={{ padding: 28, textAlign: "center", color: "var(--slate-500)", border: "1px dashed var(--slate-200)" }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            No hay preguntas aprobadas en el tema seleccionado.
          </p>
        </div>
      ) : (
        grouped.map((padre) => (
          <section key={padre.padreCode} style={{ marginBottom: 30 }}>
            <h3 style={{
              fontSize:   17,
              fontWeight: 800,
              margin:     "0 0 12px",
              paddingBottom: 6,
              borderBottom: "2px solid var(--orange-600)",
              display:    "flex",
              alignItems: "baseline",
              gap:        8,
            }}>
              <span className="font-mono-tabular" style={{ color: "var(--orange-600)" }}>
                TC {padre.padreCode}
              </span>
              <span>{padre.padreTitulo}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--slate-500)" }}>
                {padre.bloques.reduce((sum, b) => sum + b.subGroups.reduce((s, sg) => s + sg.questions.length, 0), 0)} preguntas
              </span>
            </h3>

            {padre.bloques.map((bloque) => (
              <div key={bloque.bloqueCode} style={{ marginBottom: 18 }}>
                <h4 style={{
                  fontSize:   14,
                  fontWeight: 700,
                  margin:     "0 0 10px",
                  color:      "var(--slate-700)",
                  display:    "flex",
                  alignItems: "baseline",
                  gap:        8,
                }}>
                  <span className="font-mono-tabular" style={{
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: "var(--slate-100)",
                    color: "var(--slate-600)",
                    fontSize: 12,
                  }}>
                    TC {bloque.bloqueCode}
                  </span>
                  <span>{bloque.bloqueTitulo}</span>
                </h4>

                {bloque.subGroups.map((sub) => (
                  <div key={sub.subCode ?? "general"} style={{ marginBottom: 14, paddingLeft: 14, borderLeft: "2px solid var(--slate-100)" }}>
                    {sub.subCode ? (
                      <div style={{
                        fontSize:   12,
                        color:      "var(--slate-500)",
                        margin:     "0 0 8px",
                        display:    "flex",
                        alignItems: "baseline",
                        gap:        6,
                      }}>
                        <span className="font-mono-tabular" style={{ color: "var(--slate-400)" }}>
                          {sub.subCode}
                        </span>
                        <span style={{ fontWeight: 600, color: "var(--slate-600)" }}>
                          {sub.subTitulo}
                        </span>
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--slate-400)" }}>
                          {sub.questions.length}
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--slate-400)", margin: "0 0 8px", fontStyle: "italic" }}>
                        Sin sub-bloque · {sub.questions.length}
                      </div>
                    )}

                    {sub.questions.map((q) => (
                      <ApprovedQuestionCard
                        key={q.id}
                        questionId={q.id}
                        codigoTema={q.codigoTema}
                        enunciado={q.enunciado}
                        explicacion={q.explicacion}
                        options={q.options.map((o) => ({
                          letra:     o.letra,
                          texto:     o.texto,
                          isCorrect: o.isCorrect,
                        }))}
                        aiModel={q.aiModel}
                        reviewedAt={q.aiReviewedAt}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  )
}

function FilterPill({ href, label, count, active }: {
  href:   string
  label:  string
  count:  number
  active: boolean
}) {
  return (
    <Link
      href={href}
      /* min-h-[44px] en mobile para tap target accesible. En sm+ vuelve
         al alto natural ~32px (desktop intacto). */
      className="min-h-[44px] sm:min-h-0"
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            6,
        padding:        "5px 11px",
        borderRadius:   999,
        border:         active ? "1.5px solid var(--orange-600)" : "1.5px solid var(--slate-200)",
        background:     active ? "var(--orange-600)" : "#fff",
        color:          active ? "white" : "var(--slate-700)",
        textDecoration: "none",
        fontSize:       12.5,
        fontWeight:     600,
      }}
    >
      <span>{label}</span>
      <span
        className="font-mono-tabular"
        style={{
          padding:      "0 7px",
          borderRadius: 999,
          background:   active ? "rgba(255,255,255,0.25)" : "var(--slate-100)",
          color:        active ? "white" : "var(--slate-600)",
          fontSize:     11,
          fontWeight:   800,
        }}
      >
        {count}
      </span>
    </Link>
  )
}
