"use client"

import { useEffect, useState, useCallback } from "react"
import { AIExplainPanel, type AIResult } from "@/components/AIExplainPanel"
import { ExplanationWithHighlights } from "@/components/ExplanationWithHighlights"

const MAX_PER_REVIEW = 5
const SYNC_EVENT = "dgt:ai-quota-sync"

interface Props {
  attemptId:    number
  questionId:   number
  explicacion:  string
  hasImage:     boolean
  options:      { letra: string; texto: string }[]
  correctLetra: string | undefined
  /** Pre-cargado server-side: este (questionId, withImage) ya está pagado en
   *  este attempt → mostrar el botón como "gratis" sin esperar a que se
   *  abra el modal. */
  initiallyPaid?: boolean
}

/**
 * Wrapper de <AIExplainPanel> para la página de resultados.
 *
 * - La quota (X/5) se comparte entre TODAS las preguntas del mismo attempt
 *   vía sessionStorage (`dgt:ai-quota-results-<attemptId>`).
 * - Si una respuesta viene cacheada del servidor, NO descuenta quota.
 * - Cuando una pregunta consume quota, notifica al resto vía un
 *   CustomEvent para que actualicen su contador en pantalla.
 * - Si la IA devuelve resultado, se renderiza la explicación oficial con
 *   las keyPhrases subrayadas (efecto rotulador).
 */
export function ResultsAIButton({ attemptId, questionId, explicacion, hasImage, options, correctLetra, initiallyPaid = false }: Props) {
  const key = `dgt:ai-quota-results-${attemptId}`
  const [remaining, setRemaining] = useState(MAX_PER_REVIEW)
  const [aiResult,  setAiResult]  = useState<AIResult | null>(null)

  // Cargar quota al montar — patrón estándar de hidratación desde
  // sessionStorage. El setState aquí es intencional (sync inicial), no
  // un anti-pattern como avisa react-hooks/set-state-in-effect.
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(key)
      if (stored !== null) {
        const n = parseInt(stored, 10)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!Number.isNaN(n)) setRemaining(n)
      }
    } catch {
      // ignore
    }
  }, [key])

  // Escuchar sincronizaciones de otras preguntas
  useEffect(() => {
    function onSync(e: Event) {
      const { detail } = e as CustomEvent<{ key: string; value: number }>
      if (detail.key === key) setRemaining(detail.value)
    }
    window.addEventListener(SYNC_EVENT, onSync)
    return () => window.removeEventListener(SYNC_EVENT, onSync)
  }, [key])

  const sync = useCallback(
    (next: number) => {
      setRemaining(next)
      try {
        window.sessionStorage.setItem(key, String(next))
      } catch {
        // ignore
      }
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { key, value: next } }))
    },
    [key]
  )

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <AIExplainPanel
          questionId={questionId}
          attemptId={attemptId}
          explicacion={explicacion}
          hasImage={hasImage}
          remaining={remaining}
          maxAllowed={MAX_PER_REVIEW}
          options={options}
          correctLetra={correctLetra}
          initiallyPaid={initiallyPaid}
          onConsume={() => {
            // Tanto cache hit como miss descuentan en server
            sync(Math.max(0, remaining - 1))
          }}
          onResult={(res) => setAiResult(res)}
        />
      </div>

      {/* Si la IA devolvió resultado, mostrar la explicación oficial con
          el subrayador amarillo encima de las keyPhrases. */}
      {aiResult && aiResult.keyPhrases.length > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: "rgba(245, 158, 11, 0.08)",
            borderRadius: 10,
            border: "1px solid rgba(245, 158, 11, 0.25)",
          }}
        >
          <div
            style={{
              margin: "0 0 6px",
              fontSize: 11.5,
              fontWeight: 800,
              color: "var(--amber-d)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Subrayado por la IA
          </div>
          <ExplanationWithHighlights text={explicacion} highlights={aiResult.keyPhrases} />
        </div>
      )}
    </div>
  )
}
