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
  History,
} from "lucide-react"
import { AI_QUOTA_CHANGED_EVENT, type MonthlyQuota } from "@/components/AIExplainPanel"

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
  const [showOlder, setShowOlder]      = useState(false)

  const latest        = items[0] ?? null
  const older         = items.slice(1)
  const hasPrevious   = latest !== null
  const newAnswers    = hasPrevious ? totalAnswers - latest.snapshotAnswers : 0

  const enoughTokens     = quotaRemaining >= COST
  const enoughInitial    = totalAnswers  >= MIN_ANSWERS
  const enoughForRefresh = !hasPrevious || newAnswers >= MIN_NEW_FOR_REFRESH
  const enoughData       = hasPrevious ? enoughForRefresh : enoughInitial
  const disabled         = !enoughData || !enoughTokens || isPending

  function handleGenerate() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/ai/stats-analysis", { method: "POST" })
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
        // body = { result, quota, cached, generatedAt, analysisId }
        const newItem: AnalysisHistoryItem = {
          id:               body.analysisId ?? Date.now(),
          result:           body.result,
          generatedAt:      body.generatedAt,
          snapshotAnswers:  totalAnswers,
          snapshotAttempts: 0,  // no nos lo devuelve el endpoint, no se usa en UI
          snapshotCorrect:  0,
          model:            null,
        }

        if (body.cached) {
          // No insertar duplicado: el más reciente ya es éste.
          toast.info("Sin nuevos datos: mostrando el último análisis (gratis)")
        } else {
          // Prepend + mantener tope local de MAX_HISTORY_ITEMS
          setItems((prev) => [newItem, ...prev].slice(0, 5))
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

  // ── No hay análisis previo → CTA inicial ──────────────────────────
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

  // ── Hay historial: el más reciente expandido + acordeón anteriores ──
  return (
    <div className="dash-stats-analysis">
      <div className="dash-stats-analysis__head">
        <Sparkles className="h-4 w-4" />
        <span>Análisis IA · {formatDate(latest.generatedAt)}</span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={disabled}
          className="dash-stats-analysis__refresh"
          title={refreshHint({ enoughTokens, enoughForRefresh, hasPrevious, newAnswers, quotaRemaining })}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span>Actualizar</span>
        </button>
      </div>

      {hasPrevious && !enoughForRefresh && (
        <div className="dash-stats-analysis__hint" style={{ marginTop: 0, marginBottom: 10 }}>
          {newAnswers === 0
            ? `Aún no tienes respuestas nuevas desde el último análisis.`
            : `Llevas ${newAnswers} respuesta${newAnswers === 1 ? "" : "s"} nueva${newAnswers === 1 ? "" : "s"}. Necesitas ${MIN_NEW_FOR_REFRESH} para actualizar.`}
        </div>
      )}

      <AnalysisBody item={latest} />

      {older.length > 0 && (
        <div className="dash-stats-analysis__history">
          <button
            type="button"
            onClick={() => setShowOlder((v) => !v)}
            className="dash-stats-analysis__history-toggle"
            aria-expanded={showOlder}
          >
            {showOlder ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <History className="h-3.5 w-3.5" />
            <span>
              {showOlder ? "Ocultar" : "Ver"} anteriores ({older.length})
            </span>
          </button>
          {showOlder && (
            <div className="dash-stats-analysis__history-list">
              {older.map((item) => (
                <details key={item.id} className="dash-stats-analysis__history-item">
                  <summary>
                    <span className="dash-stats-analysis__history-date">
                      {formatDate(item.generatedAt)}
                    </span>
                    <span className="dash-stats-analysis__history-summary">
                      {truncate(item.result.valoracion, 90)}
                    </span>
                  </summary>
                  <AnalysisBody item={item} compact />
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Subcomponente que pinta el cuerpo de UN análisis ─────────────────────

function AnalysisBody({ item, compact = false }: { item: AnalysisHistoryItem; compact?: boolean }) {
  const { result, id } = item
  return (
    <div className={compact ? "dash-stats-analysis__body dash-stats-analysis__body--compact" : "dash-stats-analysis__body"}>
      <p className="dash-stats-analysis__valoracion">{result.valoracion}</p>

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
            {result.debilidades.map((w, i) => (
              <div key={i} className="dash-stats-analysis__weakness">
                <div className="dash-stats-analysis__weakness-head">
                  <span className="dash-stats-analysis__weakness-name">{w.tema}</span>
                  <span className="dash-stats-analysis__weakness-count">
                    {w.fallos} {w.fallos === 1 ? "fallo" : "fallos"}
                  </span>
                </div>
                <p>{w.comentario}</p>
              </div>
            ))}
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

      {/* CTA: test personalizado basado en ESTE análisis */}
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
