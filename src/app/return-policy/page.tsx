import Link from "next/link"
import type { Metadata } from "next"
import { ChevronLeft, RotateCcw, CreditCard, Mail } from "lucide-react"

export const metadata: Metadata = {
  title:       "Política de devoluciones",
  description: "Política de reembolso y cancelación de la suscripción PRO de DGT Tests.",
}

const LAST_UPDATED = "21 de mayo de 2026"

export default function ReturnPolicyPage() {
  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <RotateCcw className="h-7 w-7" />
            Política de devoluciones
          </h1>
          <p className="lead">
            Cómo funcionan los reembolsos y la cancelación de la suscripción PRO.
          </p>
        </div>
      </header>

      <p style={{ fontSize: 12, color: "var(--slate-500)", marginBottom: 24 }}>
        Última actualización: {LAST_UPDATED}
      </p>

      {/* CANCELACIÓN */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 18 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 800 }}>
          <CreditCard className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
          Cancelación
        </h2>
        <p style={{ margin: 0, marginBottom: 8, fontSize: 14, lineHeight: 1.6, color: "var(--slate-700)" }}>
          Puedes cancelar tu suscripción PRO <b>en cualquier momento</b> sin penalización
          desde{" "}
          <Link href="/settings" style={{ color: "var(--orange-600)", textDecoration: "underline" }}>
            /settings
          </Link>{" "}
          → &ldquo;Gestionar suscripción&rdquo; (abre el Customer Portal de Stripe).
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: "var(--slate-700)" }}>
          <li>
            La cancelación es efectiva al <b>final del periodo de facturación en curso</b>.
            Es decir, mantienes acceso PRO hasta la fecha que figura en tu factura.
          </li>
          <li>
            <b>No se prorratea ni se reembolsa</b> el tiempo ya pagado del mes en curso.
          </li>
          <li>Tras la cancelación, tu cuenta vuelve automáticamente al plan gratuito.</li>
        </ul>
      </section>

      {/* REEMBOLSOS */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 18 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 800 }}>
          <RotateCcw className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
          Reembolsos
        </h2>
        <p style={{ margin: 0, marginBottom: 8, fontSize: 14, lineHeight: 1.6, color: "var(--slate-700)" }}>
          Por la naturaleza del producto (acceso digital inmediato), <b>no se realizan
          reembolsos automáticos</b> de las cuotas mensuales ya cobradas. No obstante,
          contemplamos reembolsos puntuales en estos casos:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: "var(--slate-700)" }}>
          <li>
            <b>Cargo duplicado o erróneo</b> por problema técnico de nuestro lado.
          </li>
          <li>
            <b>Cargo recurrente tras una cancelación efectiva</b> (te devolvemos esa cuota).
          </li>
          <li>
            <b>Fallo grave del servicio</b> que impida el uso normal durante más del 50%
            del periodo facturado.
          </li>
        </ul>
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: "var(--slate-600)" }}>
          Las solicitudes se atienden en un plazo máximo de <b>14 días naturales</b>. Si se
          aprueba, el reembolso se efectúa por el mismo método de pago (Stripe se encarga
          del proceso, puede tardar entre 5 y 10 días hábiles en aparecer en tu cuenta).
        </p>
      </section>

      {/* DERECHO DE DESISTIMIENTO */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 18 }}>
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 800 }}>
          Derecho de desistimiento (consumidores UE)
        </h2>
        <p style={{ margin: 0, marginBottom: 8, fontSize: 14, lineHeight: 1.6, color: "var(--slate-700)" }}>
          Conforme al art. 102 del Real Decreto Legislativo 1/2007 (Ley de Consumidores
          y Usuarios), dispones de <b>14 días naturales</b> desde la contratación para
          desistir sin justificación.
        </p>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--slate-600)" }}>
          <b>Excepción importante</b>: al ser un servicio digital de acceso inmediato,
          si has consumido contenido PRO (hecho cualquier test del bloque PRO, usado la
          IA, accedido al manual, etc.) tras suscribirte, se entiende que has aceptado
          renunciar al derecho de desistimiento conforme al art. 103.m del mismo texto
          legal. En ese caso, sigue aplicando la política de reembolsos descrita arriba.
        </p>
      </section>

      {/* CONTACTO */}
      <section className="card-soft warm" style={{ padding: 24, marginBottom: 18 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 800 }}>
          <Mail className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
          Solicitar un reembolso
        </h2>
        <p style={{ margin: 0, marginBottom: 12, fontSize: 14, lineHeight: 1.6, color: "var(--slate-700)" }}>
          Escríbenos describiendo el caso, tu nombre de usuario y la fecha del cargo.
          Responderemos lo antes posible.
        </p>
        <a
          href="mailto:contact@hdglabs.com?subject=Solicitud%20de%20reembolso%20DGT%20Tests"
          className="btn-primary"
          style={{ display: "inline-flex" }}
        >
          <Mail className="h-4 w-4" />
          Enviar email
        </a>
      </section>

      <p style={{ fontSize: 12, color: "var(--slate-400)", textAlign: "center", marginTop: 24 }}>
        Esta política se rige por la legislación española y europea aplicable. Para
        información sobre cookies y datos personales consulta nuestra{" "}
        <Link href="/privacidad" style={{ color: "var(--orange-600)", textDecoration: "underline" }}>
          política de privacidad
        </Link>
        .
      </p>
    </div>
  )
}
