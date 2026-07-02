import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, HelpCircle } from "lucide-react"
import { StructuredDataBreadcrumb } from "@/components/StructuredData"

export const metadata: Metadata = {
  title:       "Preguntas frecuentes sobre el examen teórico DGT",
  description: "Respuestas a las dudas más comunes sobre el examen teórico del carné de conducir: cuántas preguntas tiene, cuántos fallos permite, ADAS, coste y tiempos para aprobar.",
  alternates:  { canonical: "/faq" },
  openGraph: {
    type:        "article",
    title:       "Preguntas frecuentes — Examen teórico DGT",
    description: "Cuántas preguntas, cuántos fallos, qué es ADAS, cuánto cuesta… las dudas que más se preguntan sobre el examen teórico del carné de conducir.",
  },
}

/**
 * Página /faq — Preguntas frecuentes sobre el examen teórico DGT.
 *
 * Objetivo SEO: cada Question es una entrada con potencial de rich
 * result independiente. Una FAQPage bien construida puede ocupar la
 * mitad de la primera SERP para queries long-tail tipo:
 *    "cuántos fallos puedo tener en el examen teórico DGT"
 *    "cuánto cuesta sacarse el carné en 2026"
 *    "qué es ADAS en el examen de conducir"
 *
 * Implementación:
 *  - 12 FAQs como source of truth (constante FAQS).
 *  - Render con <details>/<summary> nativo: accordion sin JS, semántico,
 *    accesible por teclado y SEO-friendly por defecto.
 *  - JSON-LD FAQPage construido del mismo array → no se desincronizan.
 *
 * Cuándo añadir más FAQs: cuando una query en GSC tenga impresiones
 * pero CTR < 2%, suele ser que falta una respuesta directa en la SERP.
 * Crea la pregunta aquí y Google la indexará en horas.
 */

const FAQS: { question: string; answer: string }[] = [
  {
    question: "¿Cuántas preguntas tiene el examen teórico DGT del Permiso B?",
    answer:
      "El examen teórico del Permiso B consta de 30 preguntas tipo test con tres opciones de respuesta cada una. Solo hay una opción correcta. Se hace en un ordenador en la Jefatura Provincial de Tráfico (o centro examinador autorizado) y dura un máximo de 30 minutos.",
  },
  {
    question: "¿Cuántos fallos puedo tener para aprobar el teórico?",
    answer:
      "Para aprobar el examen teórico necesitas un mínimo de 27 aciertos sobre 30 preguntas — es decir, puedes fallar como mucho 3 preguntas. Si fallas 4 o más, suspendes y tienes que volver a presentarte (pagando de nuevo las tasas).",
  },
  {
    question: "¿Cuánto cuesta sacarse el carné de conducir en 2026?",
    answer:
      "El coste medio en España oscila entre 700€ y 1.300€ dependiendo de la comunidad autónoma, las clases prácticas necesarias y si suspendes algún examen. Esta cifra incluye: matrícula de autoescuela (~250–400€), tasas DGT (94,05€ teórico+práctico, según última actualización), clases prácticas (28–35€ cada una, mínimo 10–15) y reconocimiento médico (~40€). Si suspendes el teórico o práctico, vuelves a pagar las tasas correspondientes.",
  },
  {
    question: "¿Cuánto dura el examen teórico DGT?",
    answer:
      "30 minutos exactos para responder las 30 preguntas. Se hace en ordenador, puedes navegar entre preguntas, marcar las dudosas para revisarlas y enviar antes si terminas. El resultado se sabe en ese mismo momento al pulsar 'finalizar'.",
  },
  {
    question: "¿Qué es el bloque ADAS y desde cuándo entra en el examen DGT?",
    answer:
      "ADAS son los Sistemas Avanzados de Asistencia a la Conducción (control de crucero adaptativo, frenada de emergencia, asistente de mantenimiento de carril, detección de ángulo muerto, etc.). Entró en el banco oficial de preguntas DGT en 2022 y desde entonces aparecen preguntas sobre estos sistemas en los exámenes. En DGT Tests tienes una categoría específica 'ADAS' para practicar solo este bloque.",
  },
  {
    question: "¿Cuál es la lista de vehículos según su dificultad de maniobra?",
    answer:
      "Es un orden oficial DGT (Reglamento General de Circulación) que clasifica los vehículos de menor a mayor dificultad para maniobrar y se usa como criterio de preferencia en estrechamientos sin señalización. La regla: gana el de MAYOR dificultad de maniobra. El orden ascendente es: bicicletas → motocicletas → turismos → vehículos mixtos → furgonetas → camiones → autobuses → articulados → trenes turísticos → conjuntos de vehículos → vehículos especiales. Tienes la guía completa con ejemplos prácticos del examen y excepciones (urgencia, pendiente, señales) en /recursos/lista-dificultad-maniobra-dgt.",
  },
  {
    question: "¿Cuántas veces puedo presentarme al examen teórico?",
    answer:
      "No hay límite legal en el número de convocatorias. Cada vez que suspendes y vuelves a presentarte pagas las tasas de nuevo (~94,05€ en 2026, importe del trámite completo). Si tras dos exámenes seguidos no apruebas, la autoescuela puede pedirte clases teóricas adicionales antes de la tercera convocatoria, pero esto depende de cada centro.",
  },
  {
    question: "¿Cuánto tiempo tengo para aprobar el práctico una vez aprobado el teórico?",
    answer:
      "Tienes 2 años desde la fecha de aprobado del teórico para aprobar el examen práctico. Si pasan los 2 años sin aprobar el práctico, el teórico caduca y tienes que volver a hacerlo. Por eso conviene empezar a sacar las clases prácticas en cuanto apruebes el teórico, sin dejar pasar meses.",
  },
  {
    question: "¿Puedo presentarme al examen DGT sin ir a una autoescuela?",
    answer:
      "Sí, se llama 'presentarse por libre'. Te apuntas directamente en la Jefatura de Tráfico pagando las tasas y haces ambos exámenes (teórico y práctico). Sin embargo, para el examen práctico necesitas un vehículo con doble mando y un profesor titulado que te acompañe el día del examen — lo que en la práctica obliga a contratar al menos clases prácticas en alguna autoescuela.",
  },
  {
    question: "¿Cuál es la edad mínima para sacarse el Permiso B?",
    answer:
      "Tienes que tener 18 años cumplidos el día del examen para sacarte el Permiso B (turismos). Puedes empezar el proceso (matricularte en la autoescuela, estudiar el temario, hacer el reconocimiento médico) a partir de los 17 años y 9 meses, pero no puedes examinarte hasta cumplir 18.",
  },
  {
    question: "¿Qué documentación necesito el día del examen teórico?",
    answer:
      "DNI o pasaporte en vigor, justificante de pago de las tasas DGT (el 'Modelo 791' o equivalente sellado) y el psicotécnico/reconocimiento médico válido (vigencia de 90 días desde su realización). Si vas con autoescuela, ellos suelen llevar todos los papeles. Si vas por libre, asegúrate de tener todo encima — sin DNI o sin tasas pagadas no te dejan entrar.",
  },
  {
    question: "¿Cuánto tardan en darme el resultado del examen?",
    answer:
      "El teórico se sabe al instante: al pulsar 'finalizar' en el ordenador, te dice si has aprobado o suspendido y el número de fallos. El práctico también se sabe en el momento — el examinador te lo comunica al bajar del coche tras el recorrido (apto, no apto, o eliminatorio según el tipo de falta).",
  },
  {
    question: "¿En qué se diferencian los tests de Permiso B, Repaso final y ADAS?",
    answer:
      "Los tests de 'Permiso B' son tests estándar con preguntas del banco oficial DGT, mezclando los distintos temas del manual. 'Repaso final' son tests más exigentes que mezclan las preguntas más complejas de todos los bloques — pensados para los últimos días antes del examen. 'ADAS' agrupa preguntas específicas sobre sistemas avanzados de asistencia, el bloque que se añadió en 2022 y que la gente suele tener más flojo por ser el más reciente.",
  },
]

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.hdglabs.com"

export default function FAQPage() {
  // Schema.org FAQPage: cada Question/Answer es una entry independiente
  // que Google puede mostrar como rich result. La construyo del array
  // FAQS para que UI y schema NO PUEDAN desincronizarse.
  const faqSchema = {
    "@context": "https://schema.org",
    "@type":    "FAQPage",
    url:        `${APP_URL}/faq`,
    inLanguage: "es-ES",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name:    f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text:    f.answer,
      },
    })),
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      {/* Breadcrumb JSON-LD para la miga en SERPs. */}
      <StructuredDataBreadcrumb
        appUrl={APP_URL}
        items={[
          { name: "Inicio",               url: "/" },
          { name: "Preguntas frecuentes", url: "/faq" },
        ]}
      />

      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12, margin: 0 }}>
            <HelpCircle className="h-7 w-7" style={{ color: "var(--orange-600)" }} />
            Preguntas frecuentes
          </h1>
          <p className="lead" style={{ marginTop: 10 }}>
            Las dudas más comunes sobre el examen teórico del carné de conducir
            — cuántas preguntas tiene, cuántos fallos permite, qué entra en el
            bloque ADAS, qué cuesta el carné y plazos para aprobarlo.
          </p>
        </div>
      </header>

      <section className="card-soft" style={{ padding: 8, marginTop: 14 }}>
        {FAQS.map((f, i) => (
          <details
            key={i}
            style={{
              padding: "16px 18px",
              borderBottom: i < FAQS.length - 1 ? "1px solid var(--slate-200)" : "none",
            }}
          >
            <summary
              style={{
                cursor:       "pointer",
                listStyle:    "none",
                fontWeight:   700,
                fontSize:     15.5,
                lineHeight:   1.4,
                color:        "var(--slate-800)",
                display:      "flex",
                alignItems:   "flex-start",
                gap:          10,
                userSelect:   "none",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width:      22,
                  height:     22,
                  borderRadius: "50%",
                  background: "rgba(249, 115, 22, 0.12)",
                  color:      "var(--orange-600)",
                  fontSize:   12,
                  fontWeight: 900,
                  display:    "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop:  1,
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                }}
              >
                {i + 1}
              </span>
              <span>{f.question}</span>
            </summary>
            <p
              style={{
                margin:     "10px 0 0",
                paddingLeft: 32,
                fontSize:   14.5,
                lineHeight: 1.6,
                color:      "var(--slate-700)",
              }}
            >
              {f.answer}
            </p>
          </details>
        ))}
      </section>

      {/* Footer con CTA + links útiles */}
      <section
        className="card-soft warm"
        style={{
          padding: 20,
          marginTop: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 15.5 }}>
            ¿Sigues con alguna duda?
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--slate-600)" }}>
            La mejor forma de resolverla es practicando — pruébalo con un test
            gratis y, si necesitas explicación, pide a la IA que te aclare.
          </p>
        </div>
        <Link href="/" className="btn-primary">
          Empezar un test gratis →
        </Link>
      </section>

      <script
        type="application/ld+json"
        // Schema FAQPage — Google lo lee al crawlear y construye un rich
        // result con las preguntas como entradas plegables en SERPs.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </div>
  )
}
