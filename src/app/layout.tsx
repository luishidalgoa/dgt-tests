import type { Metadata, Viewport } from "next"
import Link from "next/link"
import { Inter, JetBrains_Mono } from "next/font/google"
import { getCurrentUser } from "@/lib/auth"
import { getQuotaStatus } from "@/lib/aiQuota"
import { planLabel, isAdmin } from "@/lib/permissions"
import { isMaintenanceMode } from "@/lib/configCatalog"
import { firstPendingNotification } from "@/lib/notifications"
import { Navbar } from "@/components/Navbar"
import { BottomTabs } from "@/components/BottomTabs"
import { UserNotifications } from "@/components/UserNotifications"
import { CookieConsent } from "@/components/CookieConsent"
import { AnalyticsScript } from "@/components/AnalyticsScript"
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker"
import { MaintenancePage } from "@/components/MaintenancePage"
import { hasFullAccess } from "@/lib/permissions"
import { Toaster } from "sonner"
import { XpGainBubble } from "@/components/XpGainBubble"
import { StreakDebugPanel } from "@/components/StreakDebugPanel"
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

// metadataBase resuelve URLs relativas (OG image, canonical) a absolutas.
// En prod = dominio público; en dev = localhost. Fallback hardcoded por si
// arrancan el server sin .env (raro pero defensivo).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.hdglabs.com"

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),

  title: {
    default:  "DGT Tests · Aprueba el examen teórico a la primera",
    template: "%s · DGT Tests",
  },
  description:
    "Practica los tests del examen teórico del carné de conducir (DGT). Permiso B, repaso final, test ADAS, test de errores y manual del temario — gratis para empezar.",
  applicationName: "DGT Tests",
  authors:         [{ name: "Luis Hidalgo", url: "https://portfolio.hdglabs.com/" }],
  creator:         "Luis Hidalgo",
  publisher:       "DGT Tests",
  keywords: [
    "tests dgt",
    "examen teórico dgt",
    "test permiso b",
    "test conducir",
    "carné de conducir",
    "examen tráfico",
    "test online dgt",
    "preguntas examen conducir",
  ],

  // Canonical para el root. Por-página, cada page.tsx puede sobreescribir
  // alternates.canonical si quiere (p.ej. cuando hay paginación).
  alternates: {
    canonical: "/",
  },

  // OpenGraph para previews al compartir (WhatsApp, Slack, Telegram, etc.).
  // La imagen la AUTODETECTA Next.js desde src/app/opengraph-image.tsx,
  // así que no la especificamos aquí — al cambiar el fichero, el OG se
  // actualiza solo en el próximo build.
  openGraph: {
    type:        "website",
    locale:      "es_ES",
    url:         APP_URL,
    siteName:    "DGT Tests",
    title:       "DGT Tests · Aprueba el examen teórico a la primera",
    description: "Practica los tests del examen teórico del carné de conducir. Permiso B, repaso final, test ADAS y test de errores.",
  },

  // Twitter Cards para previews en X/Twitter. summary_large_image = banner
  // grande horizontal (1200×630). Igual que OG, imagen autodetectada.
  twitter: {
    card:        "summary_large_image",
    title:       "DGT Tests · Aprueba el examen teórico a la primera",
    description: "Practica los tests del examen teórico del carné de conducir (DGT).",
  },

  // Para que los crawlers serios (Google, Bing) entiendan que SÍ queremos
  // que indexen todo lo público. /admin/* y /api/* se bloquean en robots.ts.
  robots: {
    index:    true,
    follow:   true,
    nocache:  false,
    googleBot: {
      index:             true,
      follow:            true,
      "max-image-preview": "large",
      "max-snippet":       -1,
    },
  },

  // Desactivar la auto-detección de teléfonos de iOS Safari — sin esto,
  // números que aparecen en /privacidad o footer se convierten en links
  // clicables con tinte azul que rompen el diseño.
  formatDetection: {
    telephone: false,
  },

  // ── PWA / "Add to home screen" ──────────────────────────────────────
  // iOS Safari ignora manifest.webmanifest casi entero — necesita estos
  // meta tags propios para que la app se instale bien en home screen y
  // se abra en modo standalone (sin la barra del navegador).
  appleWebApp: {
    capable:    true,
    statusBarStyle: "default",
    title:      "DGT Tests",
    // Splash screens iOS: Apple requiere un <link> por device exacto, con
    // un media query que matchee (device-width, device-height, dpi). Si
    // ninguno coincide → iOS muestra una pantalla blanca al abrir la PWA
    // instalada. Aquí cubrimos los iPhones/iPads más comunes (2017→2024).
    // Los splashes se generan on-demand vía /apple-splash/[device]/route.tsx
    // (misma paleta que el icon + título "DGT Tests").
    startupImage: [
      // iPhone 14/15/16 Pro Max — 430×932pt @3x
      { url: "/apple-splash/iphone-pro-max",  media: "screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone 14/15/16 Pro — 393×852pt @3x
      { url: "/apple-splash/iphone-pro",      media: "screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone 12/13/14, 12/13 Pro — 390×844pt @3x
      { url: "/apple-splash/iphone-standard", media: "screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone X/XS/11 Pro — 375×812pt @3x
      { url: "/apple-splash/iphone-x",        media: "screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone 8/7/6 Plus — 414×736pt @3x
      { url: "/apple-splash/iphone-8-plus",   media: "screen and (device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone 8/7/6/SE2/SE3 — 375×667pt @2x
      { url: "/apple-splash/iphone-8",        media: "screen and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
      // iPad Pro 12.9" — 1024×1366pt @2x
      { url: "/apple-splash/ipad-pro-12",     media: "screen and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" },
      // iPad Pro 11" — 834×1194pt @2x
      { url: "/apple-splash/ipad-pro-11",     media: "screen and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)" },
      // iPad Air — 820×1180pt @2x
      { url: "/apple-splash/ipad-air",        media: "screen and (device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2)" },
      // iPad mini — 744×1133pt @2x
      { url: "/apple-splash/ipad-mini",       media: "screen and (device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
}

// Next 14+ separa viewport de metadata. Aquí ponemos el theme-color (color
// de la barra del navegador en mobile) y el viewport estándar.
export const viewport: Viewport = {
  width:        "device-width",
  initialScale: 1,
  themeColor:   "#ea580c", // orange-600, color principal de marca
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser()

  // Modo mantenimiento: si está activo y el user NO es admin, mostramos
  // página "volvemos en breve" en lugar del contenido normal. El admin
  // sigue viendo todo para poder hacer la migración.
  const maintenance = await isMaintenanceMode()
  const showMaintenance = maintenance && !isAdmin(user)

  const quota = user ? await getQuotaStatus(user.id) : null
  const plan  = planLabel(user) ?? undefined
  // Primera notificación one-time pendiente para este usuario (welcome, etc.)
  const pendingNotif = user ? firstPendingNotification(user) : null

  // BottomTabs sólo cuando hay user logueado y no estamos en mantenimiento.
  // El cliente añade `has-bottom-tabs` al <body> sólo cuando aplica para que
  // el padding-bottom (necesario para no ocultar contenido en mobile) no se
  // aplique a páginas anónimas (donde no hay tabs).
  const showBottomTabs    = !!user && !showMaintenance
  const userHasFullAccess = hasFullAccess(user)

  return (
    <html
      lang="es"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        // translate="no" desactiva la traducción automática de Chrome / Google
        // Translate, que inyecta atributos en nodos de texto antes de que React
        // hidrate y dispara "A tree hydrated but some attributes of the server
        // rendered HTML didn't match the client properties" en Chrome mobile.
        translate="no"
        className={`min-h-full flex flex-col ${showBottomTabs ? "has-bottom-tabs" : ""}`}
      >
        <Navbar
          user={
            user ? { username: user.username, displayName: user.displayName } : null
          }
          aiTokensRemaining={quota?.remaining}
          aiTokensMax={quota?.max}
          plan={plan}
        />
        <main className="flex-1 mx-auto w-full max-w-[1200px] px-6 py-7">
          {showMaintenance ? <MaintenancePage /> : children}
        </main>
        <BottomTabs visible={showBottomTabs} hasFullAccess={userHasFullAccess} />
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
            href="/sobre-mi"
            style={{ color: "var(--orange-600)", fontWeight: 700, textDecoration: "none" }}
          >
            Luis Hidalgo
          </Link>
          {" · "}
          <a
            href="https://portfolio.hdglabs.com/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--slate-500)", textDecoration: "underline", textDecorationColor: "var(--slate-300)", textUnderlineOffset: 3 }}
          >
            portfolio →
          </a>
          {" · "}
          <Link
            href="/preguntas"
            style={{ color: "var(--slate-500)", textDecoration: "underline", textDecorationColor: "var(--slate-300)", textUnderlineOffset: 3 }}
          >
            Preguntas
          </Link>
          {" · "}
          <Link
            href="/recursos"
            style={{ color: "var(--slate-500)", textDecoration: "underline", textDecorationColor: "var(--slate-300)", textUnderlineOffset: 3 }}
          >
            Guías
          </Link>
          {" · "}
          <Link
            href="/faq"
            style={{ color: "var(--slate-500)", textDecoration: "underline", textDecorationColor: "var(--slate-300)", textUnderlineOffset: 3 }}
          >
            Preguntas frecuentes
          </Link>
          {" · "}
          <Link
            href="/privacidad"
            style={{ color: "var(--slate-500)", textDecoration: "underline", textDecorationColor: "var(--slate-300)", textUnderlineOffset: 3 }}
          >
            Privacidad y cookies
          </Link>
          {" · "}
          <Link
            href="/return-policy"
            style={{ color: "var(--slate-500)", textDecoration: "underline", textDecorationColor: "var(--slate-300)", textUnderlineOffset: 3 }}
          >
            Devoluciones
          </Link>
        </footer>
        <CookieConsent />
        <AnalyticsScript />
        <RegisterServiceWorker />
        {/* Toaster global de sonner — los componentes cliente disparan
            toasts con `import { toast } from "sonner"` y se muestran aquí. */}
        <Toaster richColors position="top-right" closeButton />
        {/* Bubble efímera de XP gained tras un examen real. Lee
            sessionStorage en cada cambio de ruta y se autodisparara. */}
        <XpGainBubble />
        {/* Debug-only: panel flotante para inspeccionar todos los iconos
            de racha en sus 3 estados. Solo admin + solo desktop (CSS
            @media en el propio componente). */}
        {isAdmin(user) && <StreakDebugPanel />}
      </body>
    </html>
  )
}
