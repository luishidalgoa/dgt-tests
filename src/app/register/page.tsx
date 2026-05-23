import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthForm } from "@/components/AuthForm"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title:       "Crear cuenta gratis",
  description: "Crea tu cuenta gratis en DGT Tests y desbloquea historial, estadísticas, examen real con cronómetro, chatbot IA y modo competir.",
  alternates:  { canonical: "/register" },
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="register" />
    </Suspense>
  )
}
