/**
 * Setup global de Vitest.
 *
 * Se ejecuta ANTES de cualquier test (definido en vitest.config.ts).
 * Aquí forzamos que los tests no usen credenciales de producción ni
 * configuración real, y dejamos el entorno limpio para que cada test
 * mockee lo que necesite.
 *
 * Si un test necesita `@/lib/db` real, lo mockea explícitamente con
 * `vi.mock("@/lib/db", () => ({ db: ... }))`. Por defecto NO toca BBDD.
 */

// Quitar cualquier credencial real que pueda haberse colado vía .env
delete process.env.TURSO_DATABASE_URL
delete process.env.TURSO_AUTH_TOKEN
delete process.env.STRIPE_SECRET_KEY
delete process.env.STRIPE_WEBHOOK_SECRET
delete process.env.STRIPE_PRICE_ID
delete process.env.GEMINI_API_KEY
delete process.env.RESEND_API_KEY
delete process.env.GMAIL_USER
delete process.env.GMAIL_APP_PASSWORD
delete process.env.GMAIL_FROM
delete process.env.APP_MASTER_KEY

// SESSION_SECRET es necesario para que iron-session no se queje al
// importarse (aunque los tests mockeen la sesión).
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-32chars"
