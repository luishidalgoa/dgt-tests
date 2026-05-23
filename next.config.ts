import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite acceder al dev server desde el móvil por IP de LAN. Sin esto,
  // Next 15+ bloquea /_next/webpack-hmr → HMR no engancha → React no
  // hidrata → el submit del form cae al handler nativo (recarga la página)
  // y el :active del botón eye se queda pegado.
  allowedDevOrigins: ["192.168.0.19"],

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
