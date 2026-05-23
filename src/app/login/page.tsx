import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthForm } from "@/components/AuthForm"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title:       "Iniciar sesión",
  description: "Accede a tu cuenta de DGT Tests para retomar tus exámenes, ver tu historial y seguir practicando para el carné de conducir.",
  alternates:  { canonical: "/login" },
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="login" />
    </Suspense>
  )
}
