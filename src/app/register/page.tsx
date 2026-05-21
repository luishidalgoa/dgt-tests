import { Suspense } from "react"
import { AuthForm } from "@/components/AuthForm"

export const dynamic = "force-dynamic"

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="register" />
    </Suspense>
  )
}
