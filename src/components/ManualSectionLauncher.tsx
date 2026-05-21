"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { BookOpen, Loader2, ArrowRight } from "lucide-react"
import type { ManualSectionData } from "@/lib/manual"

const FlipbookViewer = dynamic(
  () => import("@/components/FlipbookViewer").then((m) => m.FlipbookViewer),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 bg-slate-900/90 flex items-center justify-center text-white">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando visor del manual...
        </div>
      </div>
    ),
  }
)

interface Props {
  section: ManualSectionData
}

export function ManualSectionLauncher({ section }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="card-soft"
        style={{
          padding: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          textAlign: "left",
          background: "#fff",
          cursor: "pointer",
          width: "100%",
          border: "1.5px solid var(--slate-200)",
          transition: "transform 0.15s, border-color 0.15s, box-shadow 0.15s",
        }}
      >
        <span
          className="flex-shrink-0 flex items-center justify-center rounded-lg"
          style={{
            width: 42,
            height: 42,
            background: "linear-gradient(135deg, var(--orange-400), var(--orange-600))",
            color: "#fff",
            boxShadow: "0 6px 14px -8px rgba(234, 88, 12, 0.55)",
          }}
        >
          <BookOpen className="h-5 w-5" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="font-mono-tabular"
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: "var(--orange-600)",
              letterSpacing: "0.04em",
            }}
          >
            {section.subtemaCode}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              marginTop: 2,
              lineHeight: 1.3,
              color: "var(--ink)",
            }}
          >
            {section.subtemaName}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--slate-500)", marginTop: 4 }}>
            {section.totalPages} {section.totalPages === 1 ? "página" : "páginas"}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--slate-400)" }} />
      </button>

      {open && <FlipbookViewer section={section} onClose={() => setOpen(false)} />}
    </>
  )
}
