/**
 * Selección de un examen aleatorio respetando los permisos del usuario.
 *
 * Lógica pura (sin BBDD, sin `Math.random` acoplado) para que el endpoint
 * `/api/random` sea un wrapper fino y los edge cases sean testeables:
 *   - free/guest → solo entran los tests realmente accesibles
 *     (permiso-b 1..7, ver canAccessTest).
 *   - el rng es inyectable → tests deterministas.
 */

import { canAccessTest, type UserForGate } from "@/lib/permissions"

/** Referencia mínima a un test: el slug de su categoría + su número. */
export interface TestRef {
  slug:       string
  testNumber: number
}

/** Filtra la lista dejando solo los tests que el usuario puede abrir. */
export function accessibleTests(tests: ReadonlyArray<TestRef>, user: UserForGate): TestRef[] {
  return tests.filter((t) => canAccessTest(user, t.slug, t.testNumber))
}

/**
 * Elige un elemento al azar. `rng` debe devolver [0, 1) (como Math.random).
 * Devuelve null si la lista está vacía — así el caller decide el fallback.
 */
export function pickRandom<T>(items: ReadonlyArray<T>, rng: () => number = Math.random): T | null {
  if (items.length === 0) return null
  const idx = Math.floor(rng() * items.length)
  // Clamp defensivo: si rng() devuelve exactamente 1 (no debería), idx
  // se saldría del array. Math.min lo mantiene en rango.
  return items[Math.min(idx, items.length - 1)] ?? null
}

/**
 * Devuelve el href (`/{slug}/{testNumber}`) de un test accesible aleatorio,
 * o null si el usuario no tiene ninguno disponible en `tests`.
 */
export function randomAccessibleHref(
  tests: ReadonlyArray<TestRef>,
  user: UserForGate,
  rng: () => number = Math.random,
): string | null {
  const pick = pickRandom(accessibleTests(tests, user), rng)
  return pick ? `/${pick.slug}/${pick.testNumber}` : null
}
