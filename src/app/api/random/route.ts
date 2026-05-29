import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { randomAccessibleHref, type TestRef } from "@/lib/randomExam"

/**
 * GET /api/random[?categoria=slug]
 *
 * Devuelve `{ href }` apuntando a un test ALEATORIO que el usuario puede
 * abrir:
 *   - sin `categoria`  → cualquier test de cualquier categoría (global).
 *   - con `categoria`  → solo tests de esa categoría.
 *
 * Respeta los permisos (free/guest solo ven permiso-b 1..7) filtrando en
 * el servidor vía `randomAccessibleHref`, de modo que el cliente nunca
 * recibe un destino bloqueado. Si no hay ninguno accesible devuelve
 * `{ href: null }` (200) y el botón hace su propio fallback.
 *
 * Excluimos tests sin preguntas (`testQuestions: { some: {} }`) para no
 * mandar al usuario a un examen vacío.
 */
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await getCurrentUser()

  const { searchParams } = new URL(req.url)
  const categoria = searchParams.get("categoria")?.trim() || undefined

  const tests = await db.test.findMany({
    where: {
      testQuestions: { some: {} },
      ...(categoria ? { category: { slug: categoria } } : {}),
    },
    select: {
      testNumber: true,
      category:   { select: { slug: true } },
    },
  })

  const refs: TestRef[] = tests.map((t) => ({
    slug:       t.category.slug,
    testNumber: t.testNumber,
  }))

  const href = randomAccessibleHref(refs, user)
  return NextResponse.json({ href })
}
