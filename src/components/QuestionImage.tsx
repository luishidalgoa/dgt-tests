"use client"

import { useState } from "react"
import Image from "next/image"
import { imageUrl } from "@/lib/imageUrl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ZoomIn } from "lucide-react"

interface Props {
  src:    string | null
  alt:    string
  title?: string
  size?:  number // px del lado de la miniatura
}

/**
 * Imagen de una pregunta con apertura en modal a pantalla casi completa.
 * Mantiene proporción del viewport (max 94vw, 90vh).
 *
 * `unoptimized` en ambos <Image>: sirve la URL del CDN R2 tal cual, sin
 * pasar por `/_next/image`. Decisión deliberada por dos razones:
 *   1. Las imgs DGT ya son pequeñas (~50KB PNG fijo) y se sirven desde
 *      Cloudflare R2 con Cache-Control immutable max-age=1y — el opt
 *      de Vercel no añade valor real aquí.
 *   2. La URL queda ESTABLE (mismo string para preload y para render),
 *      lo que permite que `useImagePreloader` precargue durante el examen
 *      y los resultados renderen instantáneos desde cache. Si pasaran por
 *      `/_next/image?url=...&w=...&q=...`, el width que Next pide depende
 *      del DPR del device y es difícil de replicar en el preload.
 * Bonus: ahorra cuota de Vercel Image Optimization.
 */
export function QuestionImage({ src, alt, title, size = 300 }: Props) {
  const [open, setOpen] = useState(false)

  if (!src) {
    return (
      <div
        className="aspect-square rounded-xl flex items-center justify-center text-sm"
        style={{ background: "var(--slate-100)", color: "var(--slate-300)" }}
      >
        sin imagen
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group relative aspect-square rounded-xl overflow-hidden w-full cursor-zoom-in"
          style={{ background: "var(--slate-100)", border: 0, padding: 0 }}
          aria-label="Ampliar imagen"
        >
          <Image
            src={imageUrl(src)}
            alt={alt}
            fill
            unoptimized
            className="object-contain transition-transform group-hover:scale-[1.02]"
            sizes={`${size}px`}
          />
          <span
            className="absolute right-2 bottom-2 inline-flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              width: 30,
              height: 30,
              background: "rgba(15, 23, 42, 0.78)",
              color: "#fff",
            }}
          >
            <ZoomIn className="h-4 w-4" />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="!max-w-[min(94vw,1100px)] !w-[min(94vw,1100px)] !p-3 sm:!p-4"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{title ?? alt}</DialogTitle>
          <DialogDescription className="sr-only">
            Vista ampliada de la imagen de la pregunta.
          </DialogDescription>
        </DialogHeader>
        <div
          className="relative w-full"
          style={{
            maxHeight: "calc(90vh - 80px)",
            aspectRatio: "1 / 1",
            background: "var(--slate-100)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <Image
            src={imageUrl(src)}
            alt={`${alt} (ampliada)`}
            fill
            unoptimized
            className="object-contain"
            sizes="(max-width: 1100px) 94vw, 1100px"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
