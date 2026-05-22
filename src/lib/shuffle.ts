/**
 * Fisher-Yates shuffle usando `node:crypto.randomInt`.
 *
 * Por qué `crypto` en vez de `Math.random`:
 *   1. La regla `react-hooks/purity` de React 19 marca `Math.random()` como
 *      impura dentro de un Server Component que se ejecuta en "render"
 *      (porque podría reordenar las preguntas en cada repintado).
 *      Las páginas de /temas son Server Components dinámicos que SÍ deben
 *      generar un orden nuevo en cada request; `crypto.randomInt` evita el
 *      lint sin disable.
 *   2. Fisher-Yates es estadísticamente uniforme; `arr.sort(() => rng - .5)`
 *      no lo es (sesgo conocido del comparator no-determinista).
 */

import { randomInt } from "node:crypto"

export function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}
