import Link from "next/link"
import type { RecursoMeta } from "./_registry"

export const meta: RecursoMeta = {
  slug:           "cuanto-cuesta-carne-2026",
  title:          "Cuánto cuesta sacarse el carné de conducir en 2026",
  description:    "Desglose real del coste del Permiso B en España en 2026: matrícula, tasas DGT, reconocimiento médico y clases prácticas. Entre 700€ y 1.300€ según comunidad y autoescuela.",
  excerpt:        "Entre 700€ y 1.300€ según comunidad y autoescuela. Te enseño en qué se va el dinero y cómo bajar la factura sin trampas.",
  publishedAt:    "2026-05-24",
  updatedAt:      "2026-05-24",
  readingMinutes: 7,
  topic:          "coste",
}

/**
 * Cuerpo del artículo. SIN <h1> — el layout de /recursos/[slug] lo
 * inyecta desde meta.title para garantizar SEO (un solo H1 por página).
 */
export default function Cuerpo() {
  return (
    <>
      <p>
        Te has decidido a sacarte el carné y la primera pregunta es siempre
        la misma: cuánto me va a costar esto realmente. La respuesta corta
        es que en España puedes sacarte el Permiso B por entre{" "}
        <b>700€ y 1.300€</b> en 2026. Lo que pasa es que ese rango es enorme
        — y la diferencia entre pagar lo de abajo o lo de arriba no depende
        tanto de la suerte como de cómo gestiones el proceso.
      </p>
      <p>
        Aquí te dejo el desglose real, sin el &ldquo;tarifa plana, todo
        incluido&rdquo; que te suelta el comercial de la autoescuela.
        Saber qué pagas en cada paso te permite negociar mejor y, sobre
        todo, anticipar lo que NO te cuentan al firmar la matrícula.
      </p>

      <h2>El desglose real (no el que te cuenta la autoescuela)</h2>
      <p>
        Cualquier autoescuela tiene cuatro fuentes de ingresos contigo.
        Sumadas, esto es lo que vas a pagar:
      </p>
      <ul>
        <li>
          <b>Matrícula de la autoescuela (250-400€)</b>: la inscripción
          que cobran al darte de alta. Incluye el manual de teoría, acceso
          a su plataforma de tests internos y, en algunos casos, alguna
          clase teórica presencial. <b>Esta cuota es 100% beneficio para
          la autoescuela</b> — no se la pagan a nadie. Es donde más se
          mueven los precios entre centros.
        </li>
        <li>
          <b>Tasas DGT (~95€)</b>: el coste oficial que paga Tráfico por
          procesar tu examen. Modelo 791 a abonar antes de cada
          convocatoria. Si suspendes y tienes que volver,{" "}
          <b>pagas las tasas otra vez</b>.
        </li>
        <li>
          <b>Reconocimiento médico (35-50€)</b>: el psicotécnico
          obligatorio. Se hace en un centro homologado, no en tu
          autoescuela (pero ellos suelen tener acuerdos). El certificado
          tiene 90 días de validez, así que conviene hacérselo justo
          antes del examen teórico.
        </li>
        <li>
          <b>Clases prácticas (28-35€ cada clase, mínimo 10-15)</b>: aquí
          está la mayor parte del coste. La hora dura 45 minutos efectivos
          y aprender bien requiere por lo bajo 10 horas. La mayoría de
          gente necesita 15-25. Si te suspenden la práctica una vez,
          suma 5-8 clases extra para preparar la segunda convocatoria.
        </li>
      </ul>
      <p>
        Si haces la cuenta con los mínimos: 250 + 95 + 40 + (28 × 10) ={" "}
        <b>665€</b>. Con un escenario realista (matrícula media, 15 clases,
        un suspenso intermedio en la práctica): 320 + 190 (tasas dos veces)
        + 40 + (32 × 20) = <b>1.190€</b>. La media nacional cae en torno a
        los <b>950€</b>.
      </p>

      <h2>Cuánto cuesta por comunidad autónoma</h2>
      <p>El precio varía bastante por geografía:</p>
      <ul>
        <li>
          <b>Madrid, Barcelona, País Vasco, Baleares</b>: las clases
          prácticas rondan los 32-35€/hora. La matrícula suele ser de
          300-400€. Total realista: <b>1.000-1.400€</b>.
        </li>
        <li>
          <b>Valencia, Sevilla, Zaragoza, Málaga</b>: clases entre
          28-32€, matrícula 250-350€. Total: <b>800-1.100€</b>.
        </li>
        <li>
          <b>Galicia, Castilla-La Mancha, Extremadura, comunidades
          pequeñas</b>: clases desde 25-28€, matrícula 200-300€. Total:{" "}
          <b>650-900€</b>.
        </li>
      </ul>
      <p>
        La diferencia es real, pero <b>no mudes tu domicilio para sacarte
        el carné más barato</b>: el ahorro de 150-300€ no compensa los
        trámites. Si vives en una comunidad cara, lo que sí merece la
        pena es comparar autoescuelas dentro de tu ciudad: en Madrid
        puede haber 100€ de diferencia entre dos centros que están en
        barrios distintos.
      </p>

      <h2>Cómo abaratar el proceso (sin trampas)</h2>
      <p>Las palancas reales para gastar menos:</p>
      <ol>
        <li>
          <b>Aprueba el teórico a la primera</b>. Cada suspenso son ~95€
          de tasas + tiempo perdido + clases prácticas que no estás
          aprovechando aún. La forma más barata de prepararlo es
          practicando con tests online — son gratis, ilimitados y se
          parecen mucho más al examen real que lo que te dan en clase.
          Tienes <Link href="/">los 7 primeros tests del Permiso B
          gratis aquí</Link>.
        </li>
        <li>
          <b>Haz un mínimo de 50 tests</b> antes de presentarte. La
          estadística sitúa el aprobado en primera convocatoria por
          debajo del 60% — pero quienes hacen más de 40 tests completos
          antes del examen suben esa cifra al 85%+.
        </li>
        <li>
          <b>No contrates &ldquo;tarifa plana&rdquo; sin letra
          pequeña</b>. Muchas autoescuelas venden packs &ldquo;todo
          incluido por 800€&rdquo; que luego excluyen examen práctico
          suspenso, clases extra, o tienen un máximo de prácticas.
          Lee SIEMPRE qué cubre y qué no.
        </li>
        <li>
          <b>Reserva las prácticas en horario flojo</b>. Algunas
          autoescuelas hacen descuentos del 10-15% en las clases de
          9-13h entre semana (cuando la mayoría no puede acudir). Si
          tienes flexibilidad, aprovéchalo.
        </li>
        <li>
          <b>Niega la &ldquo;ampliación obligatoria&rdquo;</b>. Si tu
          profesor de prácticas dice que necesitas 10 clases más antes
          del examen, escucha — pero pide una segunda opinión. Algunas
          escuelas alargan el proceso para facturar más.
        </li>
      </ol>

      <h2>Lo que NO te cuentan</h2>
      <p>Tres detalles que la matrícula no menciona:</p>
      <ul>
        <li>
          <b>Las clases empiezan a contar antes de aprobar el teórico</b>.
          Algunas autoescuelas dejan que empieces a coger horas de
          prácticas antes de tener el teórico, pero hasta que no lo
          apruebes no puedes presentarte al práctico, y las clases
          tomadas con muchos meses de antelación se &ldquo;olvidan&rdquo;.
          Mejor enfoque: teórico primero, después prácticas seguidas.
        </li>
        <li>
          <b>El reconocimiento médico caduca</b>. Tiene 90 días de
          validez. Si te lo haces y tardas más en presentarte al
          teórico, tienes que repetirlo. Hazlo justo antes del examen,
          no al matricularte.
        </li>
        <li>
          <b>Tras aprobar el teórico tienes 2 años para sacar el
          práctico</b>. Si dejas pasar el tiempo y caduca, vuelves a
          hacer ambos. No es raro que pase si dejas el proceso a medias
          durante un par de años.
        </li>
      </ul>

      <h2>Resumen rápido</h2>
      <ul>
        <li>Coste medio: <b>700-1.300€</b> en 2026 (España)</li>
        <li>Ahorra: aprueba teórico a la primera, compara autoescuelas, lee la letra pequeña</li>
        <li>Tasas que sí o sí: ~95€ DGT + 40€ médico</li>
        <li>El grueso del coste son las clases prácticas — sube si suspendes</li>
      </ul>
      <p>
        Si todavía no has empezado y quieres ver cómo es el teórico antes
        de matricularte,{" "}
        <Link href="/">practica con un test gratis aquí</Link> — es lo
        más barato que vas a hacer en todo el proceso.
      </p>
      <p>
        Para más dudas sobre plazos, tasas y trámites, mira{" "}
        <Link href="/faq">las preguntas frecuentes</Link>.
      </p>
    </>
  )
}
