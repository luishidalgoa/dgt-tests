import type { Metadata } from "next"
import Link from "next/link"
import { Inter, JetBrains_Mono } from "next/font/google"
import { getCurrentUser } from "@/lib/auth"
import { getQuotaStatus } from "@/lib/aiQuota"
import { planLabel } from "@/lib/permissions"
import { firstPendingNotification } from "@/lib/notifications"
import { Navbar } from "@/components/Navbar"
import { UserNotifications } from "@/components/UserNotifications"
import { CookieConsent } from "@/components/CookieConsent"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

export const metadata: Metadata = {
  title: {
    default:  "DGT Tests · Examen de conducir",
    template: "%s · DGT Tests",
  },
  description:
    "Practica los tests del examen teórico del carné de conducir. Permiso B, repaso final, test ADAS, test de errores y manual del temario.",
  applicationName: "DGT Tests",
  authors: [{ name: "Luis Hidalgo" }],
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser()
  const quota = user ? await getQuotaStatus(user.id) : null
  const plan  = planLabel(user) ?? undefined
  // Primera notificación one-time pendiente para este usuario (welcome, etc.)
  const pendingNotif = user ? firstPendingNotification(user) : null

  return (
    <html
      lang="es"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Navbar
          user={
            user ? { username: user.username, displayName: user.displayName } : null
          }
          aiTokensRemaining={quota?.remaining}
          aiTokensMax={quota?.max}
          plan={plan}
        />
        <main className="flex-1 mx-auto w-full max-w-[1200px] px-6 py-7">
          {children}
        </main>
        {user && (
          <UserNotifications
            pendingId={pendingNotif?.id ?? null}
            username={user.displayName ?? user.username}
          />
        )}
        <footer
          style={{
            marginTop: 32,
            padding: "18px 24px",
            borderTop: "1px solid var(--slate-200)",
            background: "rgba(255,255,255,0.55)",
            textAlign: "center",
            fontSize: 12.5,
            color: "var(--slate-500)",
          }}
        >
          Hecho por{" "}
          <Link
            href="/sobre"
            style={{ color: "var(--orange-600)", fontWeight: 700, textDecoration: "none" }}
          >
            Luis Hidalgo
          </Link>
          {" · "}
          <a
            href="https://luishidalgoa.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--slate-500)", textDecoration: "none" }}
          >
            portfolio →
          </a>
          {" · "}
          <Link
            href="/privacidad"
            style={{ color: "var(--slate-500)", textDecoration: "none" }}
          >
            Privacidad y cookies
          </Link>
        </footer>
        <CookieConsent />
      </body>
    </html>
  )
}
