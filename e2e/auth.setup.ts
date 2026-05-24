/**
 * Setup project de Playwright: loguea al test user UNA SOLA VEZ y
 * persiste la cookie iron-session en `e2e/.auth/user.json`. El resto de
 * specs hereda ese storageState (ver `playwright.config.ts → projects`).
 *
 * Credenciales: las del script `npm run dev:prepare-test-user`
 * (username=test, password=test1234). Para regenerar el user si lo has
 * borrado:
 *
 *     npm run dev:prepare-test-user
 *
 * Si ese user no existe, esta setup fallará con 401 y todos los specs
 * quedan bloqueados — exactamente lo que queremos (no correr E2E contra
 * un entorno mal preparado).
 */
import { test as setup, expect } from "@playwright/test"
import path from "node:path"
import fs from "node:fs"

const AUTH_FILE = path.join(__dirname, ".auth", "user.json")

setup("login como test user", async ({ page }) => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })

  // Importante: usamos `page.request` (no el fixture top-level
  // `request`) porque ese sí comparte cookies con el BrowserContext de
  // la página. El fixture `request` global vive en un APIRequestContext
  // separado y la cookie iron-session quedaría en el limbo.
  const res = await page.request.post("/api/auth/login", {
    data: {
      identifier: "test",
      password:   "test1234",
      remember:   true,
    },
  })

  // Si falla, lo más probable es que no exista el user. Mensaje claro
  // para que sepas qué correr.
  expect(
    res.ok(),
    `Login devolvió ${res.status()}. ¿Has corrido 'npm run dev:prepare-test-user'?`,
  ).toBeTruthy()

  await page.context().storageState({ path: AUTH_FILE })
})
