import { defineConfig, devices } from "@playwright/test"

/**
 * Config E2E mínima.
 *
 * Estrategia:
 *  - Asumimos que el dev server local (npm run dev → :4321) ya está
 *    corriendo. Si no, Playwright lo levanta (ver `webServer` abajo).
 *    `reuseExistingServer` evita pisar tu instancia si la tienes abierta.
 *  - Proyecto "setup" loguea una vez vía POST /api/auth/login y persiste
 *    la cookie iron-session en `e2e/.auth/user.json`. El resto de tests
 *    parten de ese storageState — no toca el flow de login en cada spec.
 *  - Solo Chromium para minimizar tiempo de instalación. Si hace falta
 *    Firefox/WebKit luego, añadimos proyectos.
 */
export default defineConfig({
  testDir:   "./e2e",
  timeout:   30_000,
  fullyParallel: false, // BBDD compartida → tests secuenciales evitan races
  forbidOnly:    !!process.env.CI,
  retries:       process.env.CI ? 1 : 0,
  workers:       1,
  reporter:      [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4321",
    trace:   "retain-on-failure",
    video:   "retain-on-failure",
  },
  projects: [
    {
      name:    "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name:    "chromium",
      use:     {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
      testIgnore:   /.*\.setup\.ts/,
    },
  ],
  webServer: {
    command:              "npm run dev",
    url:                  "http://localhost:4321",
    reuseExistingServer:  true,
    timeout:              120_000,
    stdout:               "ignore",
    stderr:               "pipe",
  },
})
