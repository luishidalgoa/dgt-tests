import Link from "next/link"
import { requireUser } from "@/lib/auth"
import { ChevronLeft, Settings, Sparkles } from "lucide-react"
import { SettingsForm } from "@/components/SettingsForm"
import { getQuotaStatus } from "@/lib/aiQuota"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const user = await requireUser()
  const quota = await getQuotaStatus(user.id)

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
      />

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
            {quota.used}
          </div>
          <div style={{ fontSize: 16, color: "var(--slate-500)", fontWeight: 700 }}>/ {quota.max}</div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--slate-500)", fontWeight: 600 }}>
            quedan <b style={{ color: lowQuota ? "var(--red-600)" : "var(--ink)" }}>{quota.remaining}</b>
          </div>
        </div>

        {/* Barra de progreso */}
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
              width: `${Math.min(100, percent)}%`,
              height: "100%",
              background: lowQuota
                ? "linear-gradient(90deg, var(--red-500), var(--red-600))"
                : "linear-gradient(90deg, rgb(168, 85, 247), rgb(236, 72, 153))",
              transition: "width 0.4s ease",
            }}
          />
        </div>

        <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>
          Cada vez que pides un análisis nuevo a la IA gastas 1 token. Las respuestas que ya están
          cacheadas (porque otro usuario o tú mismo las analizaste antes) <b>no consumen quota</b>.
        </p>
      </div>
    </div>
  )
}
