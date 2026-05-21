import Link from "next/link"
import { requireUser } from "@/lib/auth"
import { ChevronLeft, Settings, Sparkles, Crown, Shield, ArrowRight } from "lucide-react"
import { SettingsForm } from "@/components/SettingsForm"
import { BillingPortalButton } from "@/components/BillingPortalButton"
import { AdminRefillTokensButton } from "@/components/AdminRefillTokensButton"
import { getQuotaStatus } from "@/lib/aiQuota"
import { hasFullAccess, isAdmin, planLabel } from "@/lib/permissions"
import { PRO_PRICE_PER_MONTH } from "@/lib/pricing"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const user = await requireUser()
  const quota = await getQuotaStatus(user.id)
  const plan = planLabel(user)
  const admin = isAdmin(user)
  const full  = hasFullAccess(user)
  const periodEnd = user.subscriptionCurrentPeriodEnd
    ? new Date(user.subscriptionCurrentPeriodEnd).toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null

  const percent = Math.round((quota.used / quota.max) * 100)
  const resetDate = new Date(quota.resetsAt).toLocaleDateString("es-ES", {
    day:   "numeric",
    month: "long",
    year:  "numeric",
  })
  const lowQuota = quota.remaining <= 5

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Settings className="h-7 w-7" />
            Configuración
          </h1>
          <p className="lead">Edita tu nombre de usuario y cómo apareces en la app.</p>
        </div>
      </header>

      <SettingsForm
        initialUsername={user.username}
        initialDisplayName={user.displayName ?? user.username}
        initialEmail={user.email ?? ""}
      />

      {/* Suscripción / plan */}
      <div
        className="card-soft"
        style={{
          padding: 24,
          maxWidth: 520,
          marginTop: 22,
          ...(admin
            ? {
                background:
                  "linear-gradient(120deg, rgba(250, 204, 21, 0.10), rgba(234, 88, 12, 0.06))",
                borderColor: "rgba(234, 88, 12, 0.30)",
              }
            : full
            ? {
                background:
                  "linear-gradient(120deg, rgba(168, 85, 247, 0.08), rgba(236, 72, 153, 0.05))",
                borderColor: "rgba(168, 85, 247, 0.30)",
              }
            : {}),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div
            className="flex items-center justify-center rounded-xl"
            style={{
              width: 42,
              height: 42,
              background: admin
                ? "linear-gradient(135deg, #facc15, #ea580c)"
                : full
                ? "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))"
                : "var(--slate-200)",
              color: full || admin ? "#fff" : "var(--slate-500)",
              boxShadow: full || admin
                ? "0 8px 16px -10px rgba(0,0,0,0.35)"
                : "none",
            }}
          >
            {admin ? <Shield className="h-5 w-5" /> : <Crown className="h-5 w-5" />}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              Plan{" "}
              <span
                className="font-mono-tabular"
                style={{
                  marginLeft: 4,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  background: admin
                    ? "rgba(234, 88, 12, 0.15)"
                    : full
                    ? "rgba(168, 85, 247, 0.15)"
                    : "var(--slate-100)",
                  color: admin
                    ? "var(--orange-600)"
                    : full
                    ? "rgb(126, 34, 206)"
                    : "var(--slate-500)",
                  letterSpacing: "0.05em",
                }}
              >
                {plan}
              </span>
            </h2>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--slate-500)" }}>
              {admin
                ? "Acceso total sin facturación"
                : full
                ? "Suscripción activa · acceso total a la plataforma"
                : "Plan gratuito · acceso limitado"}
            </p>
          </div>
        </div>

        {/* Detalles de la suscripción */}
        {full && !admin && (() => {
          const willRenew = !user.subscriptionCancelAtPeriodEnd
          const accent = willRenew ? "var(--green-d)" : "var(--amber-d)"
          const accentBg = willRenew ? "rgba(34, 197, 94, 0.06)" : "rgba(245, 158, 11, 0.08)"
          const accentBorder = willRenew ? "rgba(34, 197, 94, 0.20)" : "rgba(245, 158, 11, 0.25)"
          return (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: accentBg,
                border: `1px solid ${accentBorder}`,
                fontSize: 13,
                color: "var(--slate-700)",
                marginBottom: 14,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div>
                Estado:{" "}
                <b style={{ color: user.subscriptionStatus === "active" ? "var(--green-d)" : "var(--amber-d)" }}>
                  {user.subscriptionStatus ?? "—"}
                </b>
              </div>
              <div>
                Renovación automática:{" "}
                <b style={{ color: accent }}>
                  {willRenew ? "✓ Activada" : "✗ Desactivada"}
                </b>
              </div>
              {periodEnd && (
                <div>
                  {willRenew ? "Próxima renovación" : "Termina"}: <b>{periodEnd}</b>
                </div>
              )}
              {!willRenew && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    color: "var(--amber-d)",
                    fontStyle: "italic",
                  }}
                >
                  Has cancelado la suscripción. Mantienes el acceso PRO hasta la fecha
                  indicada. Si cambias de opinión, puedes reactivarla desde el portal
                  de gestión sin perder nada.
                </div>
              )}
            </div>
          )
        })()}

        {/* CTAs */}
        {admin ? (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--slate-500)", fontStyle: "italic" }}>
            Tu rol de administrador te da acceso completo. Las suscripciones no aplican a este tipo de cuenta.
          </p>
        ) : full ? (
          <BillingPortalButton />
        ) : (
          <Link
            href="/upgrade"
            className="btn-primary"
            style={{
              width: "100%",
              justifyContent: "center",
              background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
              boxShadow: "0 10px 22px -10px rgba(168, 85, 247, 0.55)",
            }}
          >
            <Crown className="h-4 w-4" />
            Mejorar a PRO · {PRO_PRICE_PER_MONTH}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* Quota IA */}
      <div
        className="card-soft"
        style={{
          padding: 24,
          maxWidth: 520,
          marginTop: 22,
          borderColor: lowQuota ? "rgba(239, 68, 68, 0.35)" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div
            className="flex items-center justify-center rounded-xl"
            style={{
              width: 42,
              height: 42,
              background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
              color: "#fff",
              boxShadow: "0 8px 16px -10px rgba(168, 85, 247, 0.6)",
            }}
          >
            <Sparkles className="h-5 w-5" />
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Tokens IA este mes</h2>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--slate-500)" }}>
              Mes {quota.month} · se resetea el {resetDate}
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div
            className="font-mono-tabular"
            style={{
              fontSize: 36,
              fontWeight: 900,
              letterSpacing: "-0.02em",
              color: lowQuota ? "var(--red-600)" : "rgb(126, 34, 206)",
            }}
          >
            {quota.remaining}
          </div>
          <div style={{ fontSize: 16, color: "var(--slate-500)", fontWeight: 700 }}>/ {quota.max}</div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--slate-500)", fontWeight: 600 }}>
            consumiste <b style={{ color: "var(--ink)" }}>{quota.used}</b>
          </div>
        </div>

        {/* Barra de progreso: representa los tokens restantes (baja al consumir) */}
        <div
          style={{
            height: 10,
            borderRadius: 8,
            background: "var(--slate-100)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.max(0, 100 - percent)}%`,
              height: "100%",
              background: lowQuota
                ? "linear-gradient(90deg, var(--red-500), var(--red-600))"
                : "linear-gradient(90deg, rgb(168, 85, 247), rgb(236, 72, 153))",
              transition: "width 0.4s ease",
            }}
          />
        </div>

        <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>
          Cada análisis cuesta <b>1 token</b>.
        </p>

        {/* Admin: botón para recargarse tokens manualmente */}
        {admin && <AdminRefillTokensButton />}
      </div>
    </div>
  )
}
