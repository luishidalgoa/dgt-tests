import Link from "next/link"
import type { Metadata } from "next"
import {
  ChevronLeft,
  ExternalLink,
  Mail,
  Code2,
  Database,
  Sparkles,
  Heart,
  ArrowRight,
} from "lucide-react"

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      width="16"
      height="16"
    >
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.6-1.3-1.6-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.3 1.2.9-.3 2-.4 3-.4s2.1.1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.7 1.7.3 3 .1 3.3.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  )
}

export const metadata: Metadata = {
  title:       "Sobre el desarrollador",
  description: "Sobre Luis Hidalgo, desarrollador de DGT Tests.",
}

const PORTFOLIO_URL = "https://luishidalgoa.vercel.app/"
const GITHUB_URL    = "https://github.com/luishidalgoa"
const REPO_URL      = "https://github.com/luishidalgoa/dgt-tests"

const TECH = [
  { group: "Frontend",  items: ["Next.js 16 (App Router + Turbopack)", "React 19", "TypeScript", "Tailwind CSS 4", "Radix UI"] },
  { group: "Backend",   items: ["Next.js Route Handlers", "iron-session (auth)", "Zod (validación)", "bcryptjs"] },
  { group: "Base de datos", items: ["Prisma ORM 6", "SQLite local + Turso (libSQL) en producción"] },
  { group: "IA",        items: ["Google Gemini Flash (multimodal: texto + imagen)", "Cache propio en Prisma"] },
  { group: "Infra",     items: ["Vercel (deploy + edge)", "Resend (alertas email)"] },
  { group: "Extra",     items: ["react-pageflip (manual)", "PDF.js (pre-rasterizado)", "Playwright + Firecrawl (scraping de fuentes)"] },
] as const

export default function SobrePage() {
  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      {/* HERO */}
      <header
        className="card-soft warm"
        style={{
          padding: 32,
          marginBottom: 22,
          background:
            "linear-gradient(120deg, rgba(249, 115, 22, 0.10) 0%, rgba(168, 85, 247, 0.08) 65%, #fff 100%)",
          borderColor: "rgba(249, 115, 22, 0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div
            aria-hidden="true"
            style={{
              width: 84,
              height: 84,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--orange-500), var(--red-600))",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              fontWeight: 900,
              letterSpacing: "-0.02em",
              boxShadow: "0 14px 28px -12px rgba(220, 38, 38, 0.5)",
              flexShrink: 0,
            }}
          >
            LH
          </div>
          <div style={{ flex: 1, minWidth: 250 }}>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--slate-500)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Sobre el desarrollador
            </div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, letterSpacing: "-0.02em" }}>
              Luis Hidalgo
            </h1>
            <p style={{ margin: "6px 0 0", color: "var(--slate-600)", fontSize: 15, lineHeight: 1.5 }}>
              Desarrollador full-stack. Diseño y construyo productos web de principio a fin —
              de la base de datos a la interfaz, pasando por integraciones con IA, infra y diseño.
              DGT Tests es uno de esos productos.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
          <a
            href={PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Ver mi portfolio
            <ExternalLink className="h-4 w-4" />
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            <GithubIcon className="h-4 w-4" />
            GitHub
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            <Code2 className="h-4 w-4" />
            Código de este proyecto
          </a>
        </div>
      </header>

      {/* GRID 2 COL */}
      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          marginBottom: 22,
        }}
      >
        {/* QUÉ ES ESTE PROYECTO */}
        <section className="card-soft" style={{ padding: 22 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", fontSize: 17, fontWeight: 800 }}>
            <Sparkles className="h-5 w-5" style={{ color: "var(--amber)" }} />
            Sobre DGT Tests
          </h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--slate-700)" }}>
            Una plataforma para practicar el examen teórico del carné de conducir. Reúne las
            preguntas oficiales con explicación, manual del temario, modo competición
            multijugador, persistencia del examen en curso y un asistente IA que justifica
            cada respuesta con análisis y subrayado de las frases clave.
          </p>
          <ul style={{ margin: "12px 0 0 18px", padding: 0, fontSize: 13, color: "var(--slate-600)", lineHeight: 1.6 }}>
            <li>Tests por permiso, temas y modo errores</li>
            <li>Modo examen real con cronómetro</li>
            <li>Competición hasta 4 jugadores con invitados</li>
            <li>Chatbot IA Gemini con cache propio</li>
            <li>Visor flipbook del manual</li>
          </ul>
        </section>

        {/* CONTACTO */}
        <section className="card-soft" style={{ padding: 22 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", fontSize: 17, fontWeight: 800 }}>
            <Mail className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
            ¿Hablamos?
          </h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--slate-700)" }}>
            Si quieres colaborar, contratarme o simplemente preguntarme algo sobre cómo
            está hecho esto, mi portfolio tiene todos los detalles (enlaces, experiencia,
            otros proyectos y formas de contacto).
          </p>
          <a
            href={PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2"
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 10,
              background: "linear-gradient(135deg, var(--orange-500), var(--red-600))",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13.5,
              textDecoration: "none",
              boxShadow: "0 8px 18px -10px rgba(220, 38, 38, 0.45)",
            }}
          >
            Abrir luishidalgoa.vercel.app
            <ArrowRight className="h-4 w-4" />
          </a>
        </section>
      </div>

      {/* TECH STACK */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 22 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 14px", fontSize: 17, fontWeight: 800 }}>
          <Database className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
          Stack técnico de DGT Tests
        </h2>
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {TECH.map((group) => (
            <div key={group.group}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--orange-600)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                {group.group}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {group.items.map((item) => (
                  <li
                    key={item}
                    style={{
                      fontSize: 12.5,
                      color: "var(--slate-700)",
                      lineHeight: 1.45,
                      padding: "3px 0",
                    }}
                  >
                    · {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* PIE */}
      <p
        style={{
          textAlign: "center",
          fontSize: 12.5,
          color: "var(--slate-500)",
          marginTop: 22,
          marginBottom: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          justifyContent: "center",
        }}
      >
        Hecho con <Heart className="h-3.5 w-3.5" style={{ color: "var(--red-500)" }} /> por{" "}
        <a
          href={PORTFOLIO_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--orange-600)", fontWeight: 700, textDecoration: "none" }}
        >
          Luis Hidalgo
        </a>
      </p>
    </div>
  )
}
