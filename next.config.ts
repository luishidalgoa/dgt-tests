import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Redirects 301 permanentes.
   *
   * /sobre → /sobre-mi  (renombrado el 2026-05-22; mantenemos el redirect
   * porque la URL antigua puede estar enlazada desde notificaciones,
   * histórico del navegador o indexada por buscadores).
   */
  async redirects() {
    return [
      {
        source:      "/sobre",
        destination: "/sobre-mi",
        permanent:   true,
      },
    ]
  },
};

export default nextConfig;
