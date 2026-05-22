import Link from "next/link"
import type { Metadata } from "next"
import { ChevronLeft, Cookie, Shield, Database, ExternalLink } from "lucide-react"

export const metadata: Metadata = {
  title:       "Privacidad y cookies",
  description: "Política de cookies, almacenamiento y privacidad de DGT Tests.",
}

const LAST_UPDATED = "21 de mayo de 2026"

export default function PrivacidadPage() {
  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Shield className="h-7 w-7" />
            Privacidad y cookies
          </h1>
          <p className="lead">
            Cómo tratamos tus datos, qué cookies usamos y qué guardamos en tu navegador.
          </p>
        </div>
      </header>

      <p
        style={{
          fontSize: 12,
          color: "var(--slate-500)",
          marginBottom: 24,
        }}
      >
        Última actualización: {LAST_UPDATED}
      </p>

      {/* COOKIES */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 18 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 800 }}>
          <Cookie className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
          Cookies
        </h2>

        <h3 style={{ fontSize: 14, fontWeight: 800, marginTop: 14, marginBottom: 4 }}>
          Cookies estrictamente necesarias
        </h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.65, color: "var(--slate-700)" }}>
          <li>
            <b>dgt_tests_session</b> · cookie HTTP-only encriptada que mantiene tu sesión
            iniciada (iron-session). Caduca a los 60 días si marcas &ldquo;Recordarme&rdquo;,
            o al cerrar el navegador si no.
          </li>
        </ul>
        <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 6, marginBottom: 0 }}>
          Estas cookies son imprescindibles para la autenticación y no requieren consentimiento
          según la normativa española (LSSI-CE art. 22.2).
        </p>

        <h3 style={{ fontSize: 14, fontWeight: 800, marginTop: 18, marginBottom: 4 }}>
          Cookies de terceros
        </h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.65, color: "var(--slate-700)" }}>
          <li>
            <b>Stripe</b> (pasarela de pago) · cuando inicias el flujo de suscripción se te
            redirige a checkout.stripe.com, que establece sus propias cookies para evitar
            fraude. Más info en{" "}
            <a
              href="https://stripe.com/es/privacy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--orange-600)", textDecoration: "underline" }}
            >
              stripe.com/privacy
            </a>
            .
          </li>
        </ul>
      </section>

      {/* LOCALSTORAGE */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 18 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 800 }}>
          <Database className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
          Almacenamiento del navegador
        </h2>
        <p style={{ margin: 0, marginBottom: 12, fontSize: 13.5, color: "var(--slate-700)" }}>
          Usamos <code>localStorage</code> y <code>sessionStorage</code> para guardar
          información funcional en tu propio navegador. Estos datos <b>no se envían a nuestro
          servidor</b> y los puedes borrar tú mismo en cualquier momento desde las
          herramientas del navegador.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: "var(--slate-700)" }}>
          <li>
            <b>dgt:current-exam</b> · guarda el progreso del examen en curso (respuestas,
            pregunta actual, temporizador). Te permite recargar la página sin perderlo.
          </li>
          <li>
            <b>dgt:guest-result</b> · sessionStorage. Resultado de un test hecho como
            invitado. Se borra al cerrar la pestaña.
          </li>
          <li>
            <b>dgt:ai-quota-results-&lt;id&gt;</b> · sessionStorage. Sincroniza el contador
            de IA entre las distintas preguntas de un mismo intento.
          </li>
          <li>
            <b>dgt:cookie-consent</b> · guarda tu decisión sobre este banner para no volver
            a preguntar.
          </li>
        </ul>
      </section>

      {/* DATOS PERSONALES */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 18 }}>
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 800 }}>
          Datos personales que tratamos
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: "var(--slate-700)" }}>
          <li>
            <b>Nombre de usuario y nombre visible</b> · necesarios para la cuenta.
          </li>
          <li>
            <b>Contraseña</b> · guardamos solo el hash (bcrypt), nunca la contraseña en
            claro.
          </li>
          <li>
            <b>Tu progreso</b> · intentos, respuestas, estadísticas. Asociados a tu
            usuario.
          </li>
          <li>
            <b>Suscripción</b> · si te suscribes, guardamos el id de cliente y de
            suscripción de Stripe (<code>cus_*</code>, <code>sub_*</code>) para gestionar
            tu acceso. No guardamos datos de tarjeta — eso lo gestiona Stripe directamente.
          </li>
        </ul>
      </section>

      {/* DERECHOS */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 18 }}>
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 800 }}>
          Tus derechos (RGPD)
        </h2>
        <p style={{ margin: 0, marginBottom: 8, fontSize: 13.5, color: "var(--slate-700)", lineHeight: 1.6 }}>
          Conforme al Reglamento General de Protección de Datos (UE) 2016/679, tienes derecho
          a:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: "var(--slate-700)" }}>
          <li>Acceder a los datos que tenemos sobre ti.</li>
          <li>Rectificarlos (puedes editar usuario y nombre visible en <Link href="/settings" style={{ color: "var(--orange-600)", textDecoration: "underline" }}>/settings</Link>).</li>
          <li>Suprimir tu cuenta — escríbenos al email indicado abajo.</li>
          <li>Portar tus datos.</li>
          <li>Oponerte al tratamiento.</li>
        </ul>
        <p style={{ margin: 0, marginTop: 12, fontSize: 12.5, color: "var(--slate-500)" }}>
          Responsable: Luis Hidalgo · proyecto personal sin ánimo de lucro · contacto a través
          del{" "}
          <Link href="/sobre-mi" style={{ color: "var(--orange-600)", textDecoration: "underline" }}>
            sobre mí
          </Link>
          .
        </p>
      </section>

      {/* CONTACTO */}
      <p style={{ fontSize: 12, color: "var(--slate-500)", textAlign: "center", marginTop: 22 }}>
        ¿Dudas? Escríbeme desde{" "}
        <a
          href="https://luishidalgoa.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--orange-600)", textDecoration: "underline" }}
        >
          luishidalgoa.vercel.app
          <ExternalLink className="h-3 w-3 inline ml-0.5" />
        </a>
        .
      </p>
    </div>
  )
}
