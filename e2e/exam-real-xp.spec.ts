/**
 * E2E happy-path del flow examen real → XP bubble.
 *
 * Recorrido:
 *   1. Visita /permiso-b/1?mode=examen (modo examen → timer 30 min,
 *      examen real).
 *   2. Click en el botón DEV · auto-finalizar (visible solo en
 *      NODE_ENV=development). Rellena 30 respuestas random y dispara
 *      handleFinish.
 *   3. Intercepta la response del POST /api/attempts y valida la shape
 *      del payload xp.
 *   4. Tras el redirect a /historial/[id], si awarded>0 verifica que
 *      <XpGainBubble> aparece. La bubble se monta en el layout y lee
 *      sessionStorage tras el cambio de ruta.
 *
 * Por qué no exigimos awarded fijo: el score sale de respuestas
 * aleatorias (~25% aciertos) → base XP variable. Y el bonus diario
 * depende de si ya cobraste hoy. El test sobrevive a ambos estados
 * comprobando solo que la mecánica funciona end-to-end.
 *
 * Pre-requisitos:
 *   - dev server corriendo en :4321 (NODE_ENV=development, si no el
 *     botón DEV no renderiza).
 *   - test user existe: `npm run dev:prepare-test-user`.
 */
import { test, expect } from "@playwright/test"
import type { SubmitAttemptResponse } from "@/types/exam"

test("examen real con botón DEV cierra el flujo y dispara la bubble si hay XP", async ({ page }) => {
  // Capturamos la response del POST que dispara handleFinish. La promesa
  // se resuelve al recibirla — la usamos para inspeccionar el body sin
  // depender de la UI post-redirect.
  const attemptResponsePromise = page.waitForResponse(
    (res) => res.url().endsWith("/api/attempts") && res.request().method() === "POST",
  )

  await page.goto("/permiso-b/1?mode=examen")

  // El botón DEV solo existe en NODE_ENV=development. Si no aparece, el
  // dev server está corriendo en prod o el build de Next podó la rama.
  const devBtn = page.getByRole("button", { name: /auto-finalizar/i })
  await expect(devBtn).toBeVisible({ timeout: 10_000 })
  await devBtn.click()

  const attemptRes = await attemptResponsePromise
  expect(attemptRes.status()).toBe(200)

  const body = (await attemptRes.json()) as SubmitAttemptResponse
  expect(body).toMatchObject({
    attemptId:   expect.any(Number),
    score:       expect.any(Number),
    total:       30,
    redirectUrl: expect.any(String),
    xp: {
      awarded:   expect.any(Number),
      breakdown: expect.any(Array),
      newLevel:  expect.any(Number),
    },
  })

  // Esperamos a aterrizar en historial (o resultado — ambos válidos).
  // El router.push del runner navega tras el setItem en sessionStorage.
  await page.waitForURL(/\/(historial|resultado)\//, { timeout: 10_000 })

  // Si awarded>0, la bubble debe aparecer (la monta layout.tsx y se
  // dispara al cambiar pathname leyendo sessionStorage["dgt:xp-gain"]).
  // Si awarded===0, el helper triggerXpGainAnimation devuelve false y
  // la bubble no debe aparecer — tampoco la queremos fantasma.
  const bubble = page.locator(".xp-gain-bubble")
  if (body.xp.awarded > 0) {
    await expect(bubble).toBeVisible({ timeout: 4_000 })
    // El texto del delta debe corresponder con el awarded del body.
    await expect(bubble).toContainText(`+${body.xp.awarded} XP`)
  } else {
    // awarded=0 → no bubble. Damos un margen pequeño y verificamos
    // que NO aparece.
    await expect(bubble).toHaveCount(0)
  }
})
