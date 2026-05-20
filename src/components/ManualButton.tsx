"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { BookOpen, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ManualSectionData } from "@/lib/manual"

// PDF.js requiere APIs del DOM (DOMMatrix, etc.) que no existen en el servidor,
// así que cargamos el visor solo en cliente.
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

interface ManualButtonProps {
  section: ManualSectionData
}

export function ManualButton({ section }: ManualButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <BookOpen className="h-4 w-4" />
        Ver manual ({section.subtemaCode})
      </Button>

      {open && (
        <FlipbookViewer section={section} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
