import Link from "next/link"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { hasFullAccess, planLabel, AI_TOKENS_FREE, AI_TOKENS_PRO } from "@/lib/permissions"
import { CheckoutButton } from "@/components/CheckoutButton"
import { PRO_PRICE_LABEL } from "@/lib/pricing"

export const metadata: Metadata = {
  title:       `Plan PRO · ${PRO_PRICE_LABEL}`,
  description: "Acceso completo a DGT Tests: todos los tests del Permiso B, ADAS, análisis IA ilimitados, modo competir y test personalizado. Sin permanencia.",
  alternates:  { canonical: "/upgrade" },
}
import {
  ChevronLeft,
  Check,
  X,
  Sparkles,
  Zap,
  Trophy,
  BookOpen,
  Crown,
} from "lucide-react"

export const dynamic = "force-dynamic"

const FREE_FEATURES = [
  { label: "7 primeros tests de Permiso B",      included: true },
  { label: "Modo práctica con feedback",         included: true },
  { label: "Modo competición con tests gratuitos", included: true },
  { label: "Historial y estadísticas",           included: true },
  { label: `${AI_TOKENS_FREE} análisis IA al mes`, included: true },
  { label: "Modo examen real (30 min)",          included: false },
  { label: "Todas las categorías (+100 tests)",  included: false },
  { label: "Tests por temas",                    included: false },
  { label: "Test de errores (repite fallos)",    included: false },
  { label: "Manual completo (flipbook)",         included: false },
  { label: `${AI_TOKENS_PRO} análisis IA al mes`, included: false },
] as const

const PRO_FEATURES = [
  { label: "Todo lo del plan gratuito",          included: true },
  { label: "Modo examen real (30 min)",          included: true },
  { label: "Todas las categorías (+100 tests)",  included: true },
  { label: "Tests por temas concretos",          included: true },
  { label: "Test de errores ilimitado",          included: true },
  { label: "Manual completo en flipbook",        included: true },
  { label: `${AI_TOKENS_PRO} análisis IA al mes`, included: true },
  { label: "Cancela cuando quieras",             included: true },
] as const

export default async function UpgradePage() {
  const user = await getCurrentUser()

  // Si ya tiene acceso completo, no le mostramos la página de pago
  if (user && hasFullAccess(user)) redirect("/settings")

  const plan = planLabel(user)

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header" style={{ alignItems: "center", textAlign: "center" }}>
        <div style={{ width: "100%" }}>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--slate-500)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 6,
            }}
          >
            {plan === "FREE" ? `Plan actual: ${plan}` : "Elige tu plan"}
          </div>
          <h1 style={{ margin: 0, fontSize: 32 }}>Desbloquea todo el contenido</h1>
          <p className="lead" style={{ marginTop: 8 }}>
            Aprueba a la primera con todos los tests, el manual, modo competición y la IA.
          </p>
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          marginTop: 14,
          maxWidth: 880,
          marginInline: "auto",
        }}
      >
        {/* PLAN FREE */}
        <section
          className="card-soft"
          style={{
            padding: 26,
            position: "relative",
            opacity: 0.92,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Sparkles className="h-5 w-5" style={{ color: "var(--slate-500)" }} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Gratis</h2>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--slate-500)" }}>
            Lo que tienes ahora
          </p>
          <div style={{ marginTop: 14, marginBottom: 18 }}>
            <span
              className="font-mono-tabular"
              style={{ fontSize: 38, fontWeight: 900, letterSpacing: "-0.03em" }}
            >
              0€
            </span>
            <span style={{ color: "var(--slate-500)", fontSize: 14, marginLeft: 6 }}>/ mes</span>
          </div>
          {/* flex:1 hace que la lista consuma el espacio disponible y el
              bloque [botón + footer] quede pegado al fondo. Combinado con
              el grid (que iguala alturas de hermanas en horizontal), el
              botón cae exactamente a la misma altura que el de PRO. */}
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            {FREE_FEATURES.map((f, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 13.5,
                  color: f.included ? "var(--slate-700)" : "var(--slate-400)",
                  textDecoration: f.included ? "none" : "line-through",
                }}
              >
                {f.included ? (
                  <Check className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "var(--green)" }} />
                ) : (
                  <X className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "var(--slate-300)" }} />
                )}
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled
            style={{
              marginTop: 22,
              width: "100%",
              padding: "12px",
              borderRadius: 10,
              border: "1.5px solid var(--slate-200)",
              background: "var(--slate-100)",
              color: "var(--slate-500)",
              fontSize: 13.5,
              fontWeight: 700,
              cursor: "not-allowed",
            }}
          >
            Tu plan actual
          </button>
          {/* Footer simétrico al "Pago seguro" de PRO — sin esta línea,
              el botón de PRO quedaría más arriba que el de FREE porque
              el p de PRO añade ~32px al fondo. */}
          <p
            style={{
              fontSize: 11.5,
              color: "var(--slate-500)",
              marginTop: 12,
              marginBottom: 0,
              textAlign: "center",
            }}
          >
            Sin tarjeta · Empieza sin compromiso
          </p>
        </section>

        {/* PLAN PRO */}
        <section
          className="card-soft warm"
          style={{
            padding: 26,
            position: "relative",
            background:
              "linear-gradient(135deg, rgba(168, 85, 247, 0.06), rgba(249, 115, 22, 0.05))",
            borderColor: "rgba(168, 85, 247, 0.35)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -12,
              right: 18,
              padding: "4px 10px",
              borderRadius: 999,
              background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
              color: "#fff",
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              boxShadow: "0 8px 16px -8px rgba(168, 85, 247, 0.6)",
            }}
          >
            Recomendado
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Crown className="h-5 w-5" style={{ color: "rgb(168, 85, 247)" }} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              PRO
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--slate-500)" }}>
            Acceso total a la plataforma
          </p>
          <div style={{ marginTop: 14, marginBottom: 18 }}>
            <span
              className="font-mono-tabular"
              style={{
                fontSize: 38,
                fontWeight: 900,
                letterSpacing: "-0.03em",
                background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {PRO_PRICE_LABEL}
            </span>
            <span style={{ color: "var(--slate-500)", fontSize: 14, marginLeft: 6 }}>/ mes</span>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            {PRO_FEATURES.map((f, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 13.5,
                  color: "var(--slate-700)",
                }}
              >
                <Check className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "var(--green)" }} />
                <span>{f.label}</span>
              </li>
            ))}
          </ul>

          {user ? (
            <CheckoutButton />
          ) : (
            <Link
              href="/register?redirect=/upgrade"
              className="btn-primary"
              style={{
                marginTop: 22,
                width: "100%",
                padding: "12px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 800,
                justifyContent: "center",
                background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
                boxShadow: "0 10px 22px -10px rgba(168, 85, 247, 0.55)",
              }}
            >
              Crea tu cuenta y suscríbete
            </Link>
          )}

          <p
            style={{
              fontSize: 11.5,
              color: "var(--slate-500)",
              marginTop: 12,
              marginBottom: 0,
              textAlign: "center",
            }}
          >
            Pago seguro con Stripe · Cancela cuando quieras
          </p>
        </section>
      </div>

      {/* Trust strip */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 28,
          flexWrap: "wrap",
          marginTop: 32,
          color: "var(--slate-500)",
          fontSize: 12,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Trophy className="h-4 w-4" /> +100 tests con preguntas reales
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Zap className="h-4 w-4" /> IA Gemini para entender cada respuesta
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <BookOpen className="h-4 w-4" /> Manual completo del temario
        </span>
      </div>
    </div>
  )
}
