"use client"

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
} from "react"
import HTMLFlipBook from "react-pageflip"
import { pdfjs } from "react-pdf"
import {
  ChevronLeft,
  ChevronRight,
  X,
  Maximize2,
  Minimize2,
  Loader2,
  Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { ManualSectionData } from "@/lib/manual"

pdfjs.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface FlipbookViewerProps {
  section: ManualSectionData
  onClose: () => void
}

// ── react-pageflip exige hijos con forwardRef ────────────────────────────
interface BookPageProps {
  src:        string
  pageNumber: number
  width:      number
  height:     number
}

const BookPage = forwardRef<HTMLDivElement, BookPageProps>(function BookPage(
  { src, pageNumber, width, height }, ref
) {
  return (
    <div ref={ref} className="book-page" style={{ width, height }}>
      <img
        src={src}
        alt={`Página ${pageNumber}`}
        draggable={false}
        loading="eager"
      />
      <div className="book-page-num">{pageNumber}</div>
    </div>
  )
})


// ── Componente principal ─────────────────────────────────────────────────
export function FlipbookViewer({ section, onClose }: FlipbookViewerProps) {
  const pdfUrl = section.pdfFilename
    ? `/manual/pdfs/${encodeURIComponent(section.pdfFilename)}`
    : null

  const [pageUrls, setPageUrls]       = useState<string[]>([])
  const [loading, setLoading]         = useState(true)
  const [progress, setProgress]       = useState(0)     // 0..1
  const [error, setError]             = useState<string | null>(null)
  const [fullscreen, setFullscreen]   = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [dims, setDims] = useState({ width: 500, height: 707 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookRef = useRef<any>(null)
  const blobUrlsRef = useRef<string[]>([])

  // ── Pre-renderizar todas las páginas del PDF como imágenes ────────────
  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false

    // Liberar URLs anteriores si hubiera
    for (const url of blobUrlsRef.current) URL.revokeObjectURL(url)
    blobUrlsRef.current = []

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
     
    setProgress(0)
     
    setError(null)
     
    setPageUrls([])

    const renderAll = async () => {
      try {
        const task = pdfjs.getDocument({
          url:        pdfUrl,
          cMapUrl:    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
          cMapPacked: true,
        })
        const pdf = await task.promise
        if (cancelled) { pdf.destroy(); return }

        const numPages = pdf.numPages
        const scale = 2          // alta resolución para que el texto sea legible
        const urls: string[] = []

        // Renderizar todas las páginas SIN actualizar el estado intermedio
        // (eso causaba que HTMLFlipBook se reconstruyera en cada iteración).
        for (let i = 1; i <= numPages; i++) {
          if (cancelled) break
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement("canvas")
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext("2d")!
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (page.render as any)({ canvasContext: ctx, viewport, canvas }).promise

          const blob: Blob | null = await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), "image/jpeg", 0.88)
          })
          if (cancelled) {
            page.cleanup()
            break
          }
          if (blob) {
            const url = URL.createObjectURL(blob)
            urls.push(url)
            blobUrlsRef.current.push(url)
            setProgress(i / numPages)   // solo el progreso, no las URLs
          }
          page.cleanup()
        }

        if (!cancelled) {
          // Pre-cargar todas las imágenes ANTES de mostrar el flipbook
          await Promise.all(urls.map((u) => new Promise<void>((resolve) => {
            const img = new Image()
            img.onload = img.onerror = () => resolve()
            img.src = u
          })))

          if (!cancelled) {
            setPageUrls(urls)     // ahora sí, una sola vez
            setLoading(false)
          }
        }
        pdf.destroy()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    }

    renderAll()

    return () => {
      cancelled = true
    }
  }, [pdfUrl])

  // Liberar todas las blob URLs cuando el componente se desmonta
  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url)
      blobUrlsRef.current = []
    }
  }, [])

  // ── Dimensiones responsivas (ratio ≈ A4) ──────────────────────────────
  useEffect(() => {
    function recalc() {
      const vw = window.innerWidth
      const vh = window.innerHeight
      // Espacio reservado para header + controles + padding
      const reserveV = fullscreen ?  90 : 170
      const reserveH = fullscreen ?  40 :  80
      const availH = Math.max(300, vh - reserveV)
      const availW = Math.max(400, vw - reserveH)
      const pageWFromH = availH / 1.414
      const pageWFromW = availW / 2
      const w = Math.floor(Math.min(pageWFromW, pageWFromH))
      const h = Math.floor(w * 1.414)
      setDims({ width: w, height: h })
    }
    recalc()
    window.addEventListener("resize", recalc)
    return () => window.removeEventListener("resize", recalc)
  }, [fullscreen])

  // Simple toggle de tamaño dentro del modal (sin fullscreen del navegador)
  const toggleFullscreen = useCallback(() => {
    setFullscreen((v) => !v)
  }, [])

  // ── Navegación programática ───────────────────────────────────────────
  const goNext = useCallback(() => {
    bookRef.current?.pageFlip?.()?.flipNext?.()
  }, [])
  const goPrev = useCallback(() => {
    bookRef.current?.pageFlip?.()?.flipPrev?.()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") { e.preventDefault(); goNext() }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev() }
      else if (e.key === "Escape") { e.preventDefault(); onClose() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [goNext, goPrev, onClose])

  if (!pdfUrl) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/90 flex items-center justify-center text-white">
        <div className="text-center space-y-3">
          <p>No hay PDF disponible para este subtema.</p>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    )
  }

  const numPages = pageUrls.length

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 text-white">
        <div className="min-w-0">
          <div className="text-xs text-slate-300">Manual del temario</div>
          <div className="font-semibold truncate">
            <span className="text-amber-300 font-mono mr-2">{section.subtemaCode}</span>
            {section.subtemaName}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-sm text-slate-300 font-mono">
            {numPages > 0 ? `${Math.min(currentPage + 1, numPages)} / ${numPages}` : "…"}
          </span>
          <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/20" title="Descargar PDF">
            <a href={pdfUrl} download><Download className="h-4 w-4" /></a>
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={toggleFullscreen} title="Pantalla completa">
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={onClose} title="Cerrar">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Flipbook */}
      <div className="flex-1 flex items-center justify-center px-4 pb-4 overflow-hidden">
        {error ? (
          <div className="text-red-200 text-center">
            <p>{error}</p>
          </div>
        ) : numPages === 0 ? (
          <div className="text-white flex flex-col items-center gap-3 w-64">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Renderizando manual...</span>
            </div>
            <Progress value={progress * 100} className="h-2 bg-slate-700" />
            <span className="text-xs text-slate-400">{Math.round(progress * 100)}%</span>
          </div>
        ) : (
          <HTMLFlipBook
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={bookRef as any}
            key={numPages}     /* recrear cuando cambia el número de páginas */
            width={dims.width}
            height={dims.height}
            size="fixed"
            minWidth={200}
            maxWidth={2000}
            minHeight={300}
            maxHeight={2800}
            drawShadow
            maxShadowOpacity={0.5}
            showCover={false}
            mobileScrollSupport={false}
            flippingTime={700}
            usePortrait={false}
            autoSize={false}
            clickEventForward={false}
            useMouseEvents
            swipeDistance={30}
            showPageCorners
            disableFlipByClick={false}
            className="book"
            style={{}}
            startPage={0}
            startZIndex={0}
            onFlip={(e: { data: number }) => setCurrentPage(e.data)}
          >
            {pageUrls.map((src, i) => (
              <BookPage
                key={i}
                src={src}
                pageNumber={i + 1}
                width={dims.width}
                height={dims.height}
              />
            ))}
          </HTMLFlipBook>
        )}
      </div>

      {/* Controles */}
      <div className="flex items-center justify-center gap-3 pb-6 select-none">
        <Button variant="secondary" onClick={goPrev} disabled={currentPage === 0 || numPages === 0}>
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </Button>
        <span className="text-sm text-slate-300 font-mono min-w-[100px] text-center">
          Pág {numPages > 0 ? `${currentPage + 1} / ${numPages}` : "—"}
        </span>
        <Button variant="secondary" onClick={goNext} disabled={currentPage >= numPages - 1 || numPages === 0}>
          Siguiente
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
