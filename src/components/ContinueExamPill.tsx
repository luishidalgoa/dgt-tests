"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Play, History, X } from "lucide-react"
import {
  loadExamState,
  clearExamState,
  resumeUrl,
  countAnswered,
  remainingSeconds,
  type SavedExamState,
} from "@/lib/examState"

interface Props {
  /** URL del Link "Continuar/Empezar" si NO hay examen en curso. */
  fallbackHref:  string
  /** Texto del Link si NO hay examen en curso. */
  fallbackLabel: string
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

export function ContinueExamPill({ fallbackHref, fallbackLabel }: Props) {
  const [saved, setSaved] = useState<SavedExamState | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setSaved(loadExamState())
    // Re-comprobar al volver a la pestaña (por si se finalizó en otra)
    const onFocus = () => setSaved(loadExamState())
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  // Mientras no hayamos hidratado, mostramos el fallback (evita hydration mismatch)
  if (!mounted || !saved) {
    return (
      <Link className="dash-pill" href={fallbackHref}>
        <Play className="h-4 w-4 fill-current" />
        {fallbackLabel}
      </Link>
    )
  }

  const answered = countAnswered(saved)
  const total    = saved.totalQuestions
  const remaining = remainingSeconds(saved)
  const isExam = saved.mode === "examen"

  function handleDiscard(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (confirm("¿Descartar el examen en curso?")) {
      clearExamState()
      setSaved(null)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
      <Link
        className="dash-pill"
        href={resumeUrl(saved)}
        style={{
          background: isExam
            ? "linear-gradient(135deg, var(--amber), var(--red-500))"
            : undefined,
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 4,
          padding: "12px 18px",
          textAlign: "left",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
          <History className="h-4 w-4" />
          Continuar Test {saved.testNumber}
          <span
            className="font-mono-tabular"
            style={{
              padding: "2px 8px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.22)",
              fontSize: 12.5,
            }}
          >
            {answered}/{total}
          </span>
        </span>
        <span style={{ fontSize: 11.5, opacity: 0.85, fontWeight: 600 }}>
          {saved.categoryName} · {isExam ? "Examen real" : "Práctica"}
          {isExam && remaining !== null && ` · quedan ${fmtTime(remaining)}`}
        </span>
      </Link>
      <button
        type="button"
        onClick={handleDiscard}
        style={{
          alignSelf: "flex-end",
          fontSize: 11.5,
          color: "var(--slate-500)",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 6px",
        }}
        title="Descartar examen en curso"
      >
        <X className="h-3 w-3" />
        Descartar
      </button>
    </div>
  )
}
