"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Sparkles,
  Loader2,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Brain,
  Target,
  ChevronDown,
  ChevronRight,
  Eye,
  LineChart,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { AI_QUOTA_CHANGED_EVENT, type MonthlyQuota } from "@/components/AIExplainPanel"
import { apiFetch } from "@/lib/apiClient"

// ── Tipos ────────────────────────────────────────────────────────────────

export interface AnalysisWeakness {
  tema:        string
  fallos:      number
  comentario:  string
}

export interface StatsAnalysisResult {
  valoracion:   string
  fortalezas:   string[]
  debilidades:  AnalysisWeakness[]
  consejos:     string[]
  /** Comparación con el análisis anterior (solo a partir del 2º). */
  progreso?:    string
}

/** Una entrada del historial cargada server-side. */
export interface AnalysisHistoryItem {
  id:               number
  result:           StatsAnalysisResult
  generatedAt:      string
  snapshotAnswers:  number
  snapshotAttempts: number
  snapshotCorrect:  number
  model:            string | null
}

interface Props {
  /** Historial cargado server-side, más reciente primero. Hasta 5 items. */
  history: AnalysisHistoryItem[]
  /** Stats actuales del usuario (para decidir disabled del botón generar). */
  totalAnswers: number
  /** Tokens IA disponibles del usuario. */
  aiQuotaRemaining: number
}

const COST = 5
/** Deben coincidir con las constantes en src/lib/aiStatsAnalysis.ts. */
const MIN_ANSWERS         = 90
const MIN_NEW_FOR_REFRESH = 30

const AI_ERROR_TOASTS: Record<string, { title: string; description: string }> = {
  ai_unavailable: {
    title:       "Análisis IA no disponible ahora mismo",
    description: "Estamos saturados temporalmente. Inténtalo en unos minutos.",
  },
  ai_misconfigured: {
    title:       "Servicio de IA no disponible",
    description: "Hay un problema de configuración en el servidor. Avisa al administrador.",
  },
  ai_bad_request: {
    title:       "La IA no pudo procesar tus stats",
    description: "Inténtalo más tarde.",
  },
  ai_server_error: {
    title:       "Error temporal del modelo de IA",
    description: "Inténtalo en unos minutos, el proveedor está fallando.",
  },
  ai_error: {
    title:       "No se pudo generar el análisis",
    description: "Algo ha fallado. Inténtalo más tarde.",
  },
}

function emitQuotaChange(quota: MonthlyQuota) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(AI_QUOTA_CHANGED_EVENT, { detail: quota }))
}

export function DashStatsAnalysis({ history, totalAnswers, aiQuotaRemaining }: Props) {
  const [items, setItems]              = useState<AnalysisHistoryItem[]>(history)
  const [quotaRemaining, setQuotaRem]  = useState<number>(aiQuotaRemaining)
  const [isPending, startTransition]   = useTransition()
  const [open, setOpen]                = useState(false)
  // IDs expandidos dentro del modal. El más reciente se expande por defecto.
  const [expandedIds, setExpandedIds]  = useState<Set<number>>(() => {
    return history[0] ? new Set([history[0].id]) : new Set()
  })

  const latest        = items[0] ?? null
  const hasPrevious   = latest !== null
  const newAnswers    = hasPrevious ? totalAnswers - latest.snapshotAnswers : 0

  const enoughTokens     = quotaRemaining >= COST
  const enoughInitial    = totalAnswers  >= MIN_ANSWERS
  const enoughForRefresh = !hasPrevious || newAnswers >= MIN_NEW_FOR_REFRESH
  const enoughData       = hasPrevious ? enoughForRefresh : enoughInitial
  const disabled         = !enoughData || !enoughTokens || isPending

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function handleGenerate() {
    startTransition(async () => {
      try {
        const res = await apiFetch("/api/ai/stats-analysis", {
          method: "POST",
          // 400 cubre el set de errores "esperados" del endpoint:
          // not_enough_tokens, not_enough_data, not_enough_new_data —
          // todos flujos normales del UI, no bugs. Los errores ai_* (5xx
          // del proveedor) siguen reportándose normalmente.
          ignoreStatus: [400],
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (body.code && AI_ERROR_TOASTS[body.code]) {
            const t = AI_ERROR_TOASTS[body.code]
            toast.error(t.title, { description: t.description })
          } else if (body.code === "not_enough_tokens") {
            toast.error("No tienes suficientes tokens", { description: body.error })
          } else if (body.code === "not_enough_data") {
            toast.error("Aún no hay datos suficientes", { description: body.error })
          } else if (body.code === "not_enough_new_data") {
            toast.error("Pocos datos nuevos para actualizar", { description: body.error })
          } else {
            toast.error(body.error ?? "No se pudo generar el análisis")
          }
          return
        }
        const newItem: AnalysisHistoryItem = {
          id:               body.analysisId ?? Date.now(),
          result:           body.result,
          generatedAt:      body.generatedAt,
          snapshotAnswers:  totalAnswers,
          snapshotAttempts: 0,
          snapshotCorrect:  0,
          model:            null,
        }

        if (body.cached) {
          toast.info("Sin nuevos datos: mostrando el último análisis (gratis)")
        } else {
          setItems((prev) => [newItem, ...prev].slice(0, 5))
          // Expandir el recién generado automáticamente en el modal
          setExpandedIds((prev) => {
            const next = new Set(prev)
            next.add(newItem.id)
            return next
          })
          // Abrir el modal automáticamente al generar uno nuevo
          setOpen(true)
          toast.success(`Análisis generado · -${COST} tokens`)
        }

        if (body.quota) {
          setQuotaRem(body.quota.remaining)
          emitQuotaChange(body.quota as MonthlyQuota)
        }
      } catch (err) {
        toast.error("Error de red al pedir el análisis", { description: (err as Error).message })
      }
    })
  }

  // ─── Caso sin análisis: CTA inicial igual que antes ────────────────
  if (!latest) {
    return (
      <div className="dash-stats-analysis dash-stats-analysis--cta">
        <div className="dash-stats-analysis__head">
          <Sparkles className="h-4 w-4" />
          <span>Análisis IA de tu progreso</span>
        </div>
        <p className="dash-stats-analysis__desc">
          {enoughInitial
            ? "Pide a la IA que analice tus stats y te diga qué temas reforzar."
            : `Practica al menos ${MIN_ANSWERS} preguntas para desbloquear el análisis IA. Llevas ${totalAnswers}.`}
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={disabled}
          className="dash-stats-analysis__btn"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analizando…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generar análisis IA
              <span className="dash-stats-analysis__cost">· {COST} tokens</span>
            </>
          )}
        </button>
        {!enoughTokens && enoughData && (
          <small className="dash-stats-analysis__hint">
            Te faltan tokens: tienes {quotaRemaining} y este análisis cuesta {COST}.
          </small>
        )}
      </div>
    )
  }

  // ─── Caso con análisis: preview + botón abrir modal ─────────────────
  return (
    <div className="dash-stats-analysis dash-stats-analysis--preview">
      <div className="dash-stats-analysis__head">
        <Sparkles className="h-4 w-4" />
        <span>Análisis IA · {formatDate(latest.generatedAt)}</span>
        <span className="dash-stats-analysis__count-pill">
          {items.length} {items.length === 1 ? "análisis" : "análisis"}
        </span>
      </div>

      {/* Preview corto de la valoración más reciente (truncado, 3 líneas) */}
      <p className="dash-stats-analysis__preview-text">{latest.result.valoracion}</p>

      <div className="dash-stats-analysis__preview-actions">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button type="button" className="dash-stats-analysis__btn-secondary">
              <Eye className="h-4 w-4" />
              Ver análisis IA
            </button>
          </DialogTrigger>
          <DialogContent
            className="!max-w-[min(96vw,820px)] !w-[min(96vw,820px)] !max-h-[90vh] overflow-y-auto"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
                Análisis IA de tu progreso
              </DialogTitle>
              <DialogDescription>
                {items.length === 1
                  ? "1 análisis en tu historial."
                  : `${items.length} análisis en tu historial · más reciente arriba.`}
              </DialogDescription>
            </DialogHeader>

            {/* Acción global: actualizar */}
            <div className="dash-stats-modal__actions">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={disabled}
                className="dash-stats-analysis__btn"
                title={refreshHint({ enoughTokens, enoughForRefresh, hasPrevious, newAnswers, quotaRemaining })}
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analizando…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Actualizar análisis
                    <span className="dash-stats-analysis__cost">· {COST} tokens</span>
                  </>
                )}
              </button>
              {hasPrevious && !enoughForRefresh && (
                <small className="dash-stats-analysis__hint" style={{ margin: 0 }}>
                  {newAnswers === 0
                    ? `Aún no tienes respuestas nuevas desde el último análisis.`
                    : `Llevas ${newAnswers} respuesta${newAnswers === 1 ? "" : "s"} nueva${newAnswers === 1 ? "" : "s"}. Necesitas ${MIN_NEW_FOR_REFRESH} para actualizar.`}
                </small>
              )}
              {!enoughTokens && enoughData && (
                <small className="dash-stats-analysis__hint" style={{ margin: 0 }}>
                  Te faltan tokens: tienes {quotaRemaining}, este análisis cuesta {COST}.
                </small>
              )}
            </div>

            {/* Lista de análisis */}
            <div className="dash-stats-modal__list">
              {items.map((item, idx) => {
                const isLatest = idx === 0
                const isOpen   = expandedIds.has(item.id)
                return (
                  <article
                    key={item.id}
                    className={`dash-stats-modal__item${isOpen ? " dash-stats-modal__item--open" : ""}${isLatest ? " dash-stats-modal__item--latest" : ""}`}
                  >
                    <button
                      type="button"
                      className="dash-stats-modal__item-header"
                      onClick={() => toggleExpanded(item.id)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="dash-stats-modal__item-date">{formatDate(item.generatedAt)}</span>
                      {isLatest && (
                        <span className="dash-stats-modal__item-badge">Más reciente</span>
                      )}
                      <span className="dash-stats-modal__item-summary">
                        {truncate(item.result.valoracion, 80)}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="dash-stats-modal__item-body">
                        <AnalysisBody item={item} />
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

// ── Subcomponente que pinta el cuerpo de UN análisis ─────────────────────

function AnalysisBody({ item }: { item: AnalysisHistoryItem }) {
  const { result, id } = item
  return (
    <div className="dash-stats-analysis__body">
      <p className="dash-stats-analysis__valoracion">{result.valoracion}</p>

      {result.progreso && result.progreso.trim().length > 0 && (
        <div className="dash-stats-analysis__progreso">
          <div className="dash-stats-analysis__progreso-title">
            <LineChart className="h-3.5 w-3.5" />
            Progreso desde el último análisis
          </div>
          <p>{result.progreso}</p>
        </div>
      )}

      {result.fortalezas.length > 0 && (
        <div className="dash-stats-analysis__section">
          <div className="dash-stats-analysis__section-title">
            <TrendingUp className="h-3.5 w-3.5" style={{ color: "var(--green-d)" }} />
            Fortalezas
          </div>
          <ul>
            {result.fortalezas.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      {result.debilidades.length > 0 && (
        <div className="dash-stats-analysis__section">
          <div className="dash-stats-analysis__section-title">
            <AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--red-500)" }} />
            Áreas a reforzar
          </div>
          <div className="dash-stats-analysis__weakness-list">
            {result.debilidades.map((w, i) => {
              // Parsear jerarquía: el tema viene como
              // "Tema 3: foo · Bloque 3.2: bar · Sub-bloque 3.2.1: baz"
              // → contexto "Tema 3 · Bloque 3.2" arriba, "Sub-bloque 3.2.1: baz"
              // como nombre principal. Si no hay " · " (formato distinto),
              // se renderiza todo el string como nombre.
              const parts = w.tema.split(" · ")
              const last  = parts[parts.length - 1]
              const ctx   = parts.slice(0, -1)
                .map((p) => p.split(":")[0].trim())
                .join(" · ")
              return (
                <div key={i} className="dash-stats-analysis__weakness">
                  {ctx && <div className="dash-stats-analysis__weakness-context">{ctx}</div>}
                  <div className="dash-stats-analysis__weakness-head">
                    <span className="dash-stats-analysis__weakness-name">{last}</span>
                    <span className="dash-stats-analysis__weakness-count">
                      {w.fallos} {w.fallos === 1 ? "fallo" : "fallos"}
                    </span>
                  </div>
                  <p>{w.comentario}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {result.consejos.length > 0 && (
        <div className="dash-stats-analysis__section">
          <div className="dash-stats-analysis__section-title">
            <Lightbulb className="h-3.5 w-3.5" style={{ color: "var(--amber)" }} />
            Consejos
          </div>
          <ul>
            {result.consejos.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      <div className="dash-stats-analysis__cta-row">
        <Link
          href={`/test-personalizado?analysisId=${id}`}
          className="dash-stats-analysis__cta-link"
        >
          <Target className="h-4 w-4" />
          <span>Hacer test personalizado</span>
          <span className="dash-stats-analysis__cta-badge">gratis</span>
        </Link>
      </div>

      <small className="dash-stats-analysis__foot">
        <Brain className="h-3 w-3" /> Análisis generado por IA · puede contener imprecisiones
      </small>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

function refreshHint(opts: {
  enoughTokens:    boolean
  enoughForRefresh: boolean
  hasPrevious:     boolean
  newAnswers:      number
  quotaRemaining:  number
}): string {
  if (!opts.enoughTokens) return `Necesitas ${COST} tokens, tienes ${opts.quotaRemaining}`
  if (opts.hasPrevious && !opts.enoughForRefresh) {
    const remaining = MIN_NEW_FOR_REFRESH - opts.newAnswers
    return `Practica ${remaining} respuesta${remaining === 1 ? "" : "s"} más para poder actualizar`
  }
  return `Regenerar análisis (cuesta ${COST} tokens)`
}
