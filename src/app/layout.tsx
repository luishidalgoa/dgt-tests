import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import Link from "next/link"
import { getCurrentUser } from "@/lib/auth"
import { HeaderUser } from "@/components/HeaderUser"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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

  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b bg-white sticky top-0 z-10">
          <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-4">
            <Link href="/" className="text-xl font-bold tracking-tight">
              DGT&nbsp;Tests
            </Link>
            {user && (
              <nav className="flex gap-6 text-sm flex-1 justify-center">
                <Link href="/" className="hover:text-slate-700">
                  Inicio
                </Link>
                <Link href="/temas" className="hover:text-slate-700">
                  Por temas
                </Link>
                <Link href="/stats" className="hover:text-slate-700">
                  Stats
                </Link>
                <Link href="/historial" className="hover:text-slate-700">
                  Historial
                </Link>
                <Link href="/test-errores" className="hover:text-slate-700 font-medium text-amber-600">
                  Test de errores
                </Link>
              </nav>
            )}
            {user ? (
              <HeaderUser username={user.displayName ?? user.username} />
            ) : (
              <Link href="/login" className="text-sm font-medium hover:text-slate-700">
                Iniciar sesión
              </Link>
            )}
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">
          {children}
        </main>
        <footer className="border-t bg-white">
          <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500">
            DGT Tests · Local · {new Date().getFullYear()}
          </div>
        </footer>
      </body>
    </html>
  )
}
