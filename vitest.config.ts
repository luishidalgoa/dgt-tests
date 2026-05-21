import { defineConfig } from "vitest/config"

export default defineConfig({
  // Path resolution nativo de Vite 6+ (lee paths del tsconfig.json).
  // Sustituye al plugin vite-tsconfig-paths.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Globals (describe/it/expect) sin necesidad de importar.
    globals: true,
    // node por defecto (sin DOM); los tests que necesiten React/jsdom
    // ya lo declararán per-file con `// @vitest-environment jsdom`.
    environment: "node",
    // Buscamos *.test.ts en src/ y tests/ a la vez.
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // Excluir lo de Next/Prisma generados.
    exclude: ["node_modules", ".next", "**/node_modules/**"],
    // Limpia mocks entre tests automáticamente.
    clearMocks: true,
    // Si un test no termina en 10s lo matamos (defensa contra colgar CI).
    testTimeout: 10_000,
    setupFiles: ["./tests/setup.ts"],
  },
})
