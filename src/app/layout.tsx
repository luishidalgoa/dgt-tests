import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { getCurrentUser } from "@/lib/auth"
import { Navbar } from "@/components/Navbar"
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
        />
        <main className="flex-1 mx-auto w-full max-w-[1200px] px-6 py-7">
          {children}
        </main>
      </body>
    </html>
  )
}
