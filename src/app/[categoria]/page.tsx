import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import {
  canAccessTest,
  hasFullAccess,
  FREE_CATEGORY_SLUG,
  FREE_TEST_LIMIT,
} from "@/lib/permissions"
import { PRO_PRICE_PER_MONTH } from "@/lib/pricing"
import { ChevronLeft, CheckCircle2, Lock } from "lucide-react"
import { StructuredDataBreadcrumb } from "@/components/StructuredData"
import { RandomExamButton } from "@/components/RandomExamButton"

export const dynamic = "force-dynamic"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.vercel.app"

interface PageProps {
  params: Promise<{ categoria: string }>
}

/**
 * Metadata dinámico para SEO: cada categoría tiene su title/description
 * únicos basados en el nombre real desde la BBDD. Si la categoría no existe,
 * dejamos que el page principal devuelva notFound y herede metadata
 * genérica del layout.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { categoria } = await params
  const cat = await db.category.findUnique({
    where:  { slug: categoria },
    select: { name: true, description: true, _count: { select: { tests: true } } },
  })
  if (!cat) return {}
  const testsLabel = cat._count.tests === 1 ? "test" : "tests"
  return {
    title:       `Tests ${cat.name}`,
    description: cat.description
      ? `${cat._count.tests} ${testsLabel} oficiales de ${cat.name}: ${cat.description}`
      : `${cat._count.tests} ${testsLabel} oficiales de ${cat.name} con feedback y explicaciones. Practica para el examen teórico DGT.`,
    alternates:  { canonical: `/${categoria}` },
  }
}

export default async function CategoryPage({ params }: PageProps) {
  const user = await getCurrentUser()
  const { categoria } = await params

  const category = await db.category.findUnique({
    where: { slug: categoria },
    include: {
      tests: {
        orderBy: { testNumber: "asc" },
        include: {
          _count: { select: { testQuestions: true } },
          attempts: user
            ? {
                where: { userId: user.id, finishedAt: { not: null } },
                orderBy: { startedAt: "desc" },
                take: 1,
                select: { score: true, total: true },
              }
            : {
                where: { id: -1 },
                take: 0,
                select: { score: true, total: true },
              },
        },
      },
    },
  })

  if (!category) notFound()

  const passThreshold = 0.9
  const fullAccess = hasFullAccess(user)
  const isGuest = !user

  // ¿Hay al menos un test (con preguntas) que este usuario pueda abrir?
  // Solo entonces tiene sentido el botón "Examen aleatorio" del header —
  // en una categoría completamente bloqueada para free no lo mostramos.
  const hasAccessibleTest = category.tests.some(
    (t) => t._count.testQuestions > 0 && canAccessTest(user, category.slug, t.testNumber),
  )

  // Banner explicativo: cuántos tests están desbloqueados
  let banner: React.ReactNode = null
  if (!fullAccess) {
    if (categoria === FREE_CATEGORY_SLUG) {
      banner = (
        <div
          className="card-soft"
          style={{
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13.5,
            color: "var(--slate-600)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>
            {isGuest ? "Como invitado" : "En el plan gratuito"} tienes acceso a los{" "}
            <b>{FREE_TEST_LIMIT} primeros tests</b>. El resto requiere suscripción.
          </span>
          <Link
            href={isGuest ? "/register" : "/upgrade"}
            className="btn-secondary"
            style={{ fontSize: 13 }}
          >
            {isGuest ? "Crear cuenta" : "Desbloquear todo"}
          </Link>
        </div>
      )
    } else {
      // Categoría que para free está completamente bloqueada
      banner = (
        <div
          className="card-soft warm"
          style={{
            padding: "16px 18px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            borderColor: "rgba(249, 115, 22, 0.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Lock className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
            <span style={{ fontSize: 14 }}>
              Esta categoría está disponible <b>solo en el plan PRO</b>. Suscríbete por
              {PRO_PRICE_PER_MONTH} para acceder a todo el contenido.
            </span>
          </div>
          <Link
            href={isGuest ? "/register" : "/upgrade"}
            className="btn-primary"
            style={{ fontSize: 13 }}
          >
            {isGuest ? "Crear cuenta gratis" : `Suscribirme · ${PRO_PRICE_PER_MONTH}`}
          </Link>
        </div>
      )
    }
  }

  return (
    <div>
      {/* Breadcrumb JSON-LD: rich result en SERPs muestra
          "dgt-tests.vercel.app › Permiso B" en vez de la URL cruda. */}
      <StructuredDataBreadcrumb
        appUrl={APP_URL}
        items={[
          { name: "Inicio",       url: "/" },
          { name: category.name,  url: `/${category.slug}` },
        ]}
      />

      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1>{category.name}</h1>
          {category.description && <p className="lead">{category.description}</p>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {hasAccessibleTest && (
            <RandomExamButton categoria={category.slug} label="Aleatorio" />
          )}
          <span className="badge">[{category.code}]</span>
        </div>
      </header>

      {banner}

      <div className="tile-grid">
        {category.tests.map((t) => {
          const lastAttempt = t.attempts[0]
          const score  = lastAttempt?.score ?? null
          const total  = lastAttempt?.total ?? t._count.testQuestions
          const passed = score !== null && score >= Math.ceil(total * passThreshold)
          const failed = score !== null && !passed
          const locked = !canAccessTest(user, category.slug, t.testNumber)

          if (locked) {
            return (
              <Link
                key={t.id}
                href={isGuest ? "/register" : "/upgrade"}
                className="tile"
                style={{
                  opacity: 0.62,
                  borderStyle: "dashed",
                  background: "rgba(148, 163, 184, 0.06)",
                  filter: "grayscale(0.4)",
                }}
                title={isGuest ? "Regístrate para desbloquear" : "Suscríbete para desbloquear"}
              >
                <div
                  className="tile-label"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Lock className="h-3 w-3" />
                  Test
                </div>
                <div className="tile-num">{t.testNumber}</div>
                <div className="tile-pending">
                  {isGuest ? "Crea cuenta" : "Plan PRO"}
                </div>
              </Link>
            )
          }

          return (
            <Link
              key={t.id}
              href={`/${category.slug}/${t.testNumber}`}
              className={`tile ${passed ? "passed" : failed ? "failed" : ""}`}
            >
              <div className="tile-label">Test</div>
              <div className="tile-num">{t.testNumber}</div>
              {lastAttempt ? (
                <div className="tile-score">
                  {passed && <CheckCircle2 className="h-3.5 w-3.5" />}
                  {score}/{total}
                </div>
              ) : (
                <div className="tile-pending">
                  {user ? "Sin hacer" : `${t._count.testQuestions} preguntas`}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
