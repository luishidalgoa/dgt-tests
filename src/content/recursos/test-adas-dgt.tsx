import Link from "next/link"
import type { RecursoMeta } from "./_registry"

export const meta: RecursoMeta = {
  slug:           "test-adas-dgt",
  title:          "Test ADAS DGT: qué entra en el examen y cómo prepararlo",
  description:    "ADAS son los sistemas avanzados de asistencia a la conducción. Entraron en el examen DGT en 2022 y aparecen 2-4 preguntas por convocatoria. Las 10 siglas que tienes que dominar.",
  excerpt:        "Desde 2022 entran 2-4 preguntas de sistemas ADAS por examen. Las 10 siglas que tienes que dominar y las trampas más fallables.",
  publishedAt:    "2026-05-24",
  updatedAt:      "2026-05-24",
  readingMinutes: 7,
  topic:          "adas",
}

export default function Cuerpo() {
  return (
    <>
      <p>
        En 2022 la DGT amplió el temario oficial con un bloque nuevo: los
        sistemas avanzados de asistencia a la conducción, conocidos por
        su acrónimo <b>ADAS</b> (del inglés <i>Advanced Driver Assistance
        Systems</i>). Desde entonces aparecen preguntas sobre estos
        sistemas en todos los exámenes teóricos del Permiso B.
      </p>
      <p>
        El problema es que la mayoría de manuales en circulación se
        actualizaron poco o mal — y muchos aspirantes llegan al examen
        con el bloque ADAS apenas tocado. Es el bloque que más sorpresas
        y suspensos genera. Vamos a verlo bien: qué es exactamente, qué
        entra y cómo prepararlo.
      </p>

      <h2>Qué es ADAS exactamente</h2>
      <p>
        ADAS es el conjunto de tecnologías electrónicas que{" "}
        <b>asisten al conductor</b> durante la conducción — sin
        sustituirlo. No son sistemas autónomos. La diferencia es
        importante: un coche con ADAS sigue requiriendo un conductor
        atento y responsable; un coche autónomo (que no son legales aún
        para circulación normal en España) conduciría solo.
      </p>
      <p>Los ADAS se dividen en dos generaciones:</p>
      <ul>
        <li>
          <b>Sistemas básicos</b>: ABS (antibloqueo de frenos), ESC
          (control de estabilidad), TPMS (presión de neumáticos). Llevan
          décadas en los coches y la mayoría son obligatorios desde
          principios de los 2000.
        </li>
        <li>
          <b>Sistemas avanzados</b> (los &ldquo;ADAS modernos&rdquo;):
          control de crucero adaptativo, frenada de emergencia,
          mantenimiento de carril, detección de ángulo muerto, etc. Se
          han popularizado en la última década y son los que el bloque
          DGT cubre con más detalle.
        </li>
      </ul>
      <p>
        Desde julio de 2022, <b>muchos sistemas ADAS avanzados son de
        instalación obligatoria</b> en coches nuevos vendidos en la UE
        (Reglamento 2019/2144).
      </p>

      <h2>Qué entra exactamente en el examen DGT</h2>
      <p>
        Las preguntas ADAS que aparecen en el examen cubren tres ejes:
      </p>
      <ol>
        <li>
          <b>Identificación</b>: te ponen una imagen con un símbolo del
          cuadro de mandos o una situación de conducción, y tienes que
          reconocer qué sistema interviene.
        </li>
        <li>
          <b>Función</b>: te describen una situación y preguntan qué
          sistema te ayudaría, o qué hace concretamente cierto sistema
          (p. ej. &ldquo;el AEB, ¿en qué situación actúa?&rdquo;).
        </li>
        <li>
          <b>Limitaciones</b>: el más importante y el más fallado. Te
          preguntan <b>cuándo NO funcionan o cuándo dan falsa
          seguridad</b> los sistemas ADAS. Por ejemplo: el control de
          crucero adaptativo no detecta vehículos parados en condiciones
          específicas; el LKA puede fallar con marcas viales borradas;
          los sensores de aparcamiento no detectan objetos bajos.
        </li>
      </ol>
      <p>
        Frecuencia: en 30 preguntas suele haber <b>2-4 sobre ADAS</b>.
        Si las fallas todas, ya tienes 2-4 fallos de los 3 permitidos.
        Por eso es <b>crítico</b> prepararlas bien.
      </p>

      <h2>Los sistemas que necesitas conocer</h2>
      <p>Las 10 siglas que tienes que dominar:</p>
      <div style={{ overflowX: "auto", margin: "12px 0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "rgba(148, 163, 184, 0.08)", textAlign: "left" }}>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>Sigla</th>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>Función</th>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>Trampa típica</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>ABS</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Antibloqueo de frenos — evita que las ruedas se bloqueen al frenar de golpe</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>NO reduce la distancia de frenado; lo que hace es mantener la dirección</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>ESC / ESP</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Control electrónico de estabilidad — corrige derrapes interviniendo en frenos y motor</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>Requiere ABS para funcionar; no evita pérdidas en hielo</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>ACC</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Control de crucero adaptativo — mantiene velocidad y distancia con el coche de delante</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>Puede no detectar vehículos parados en algunas situaciones</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>AEB</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Frenada autónoma de emergencia — frena automáticamente si detecta colisión inminente</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>No es infalible — el conductor sigue siendo responsable</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>LKA / LDW</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Mantenimiento / aviso de carril — te avisa o corrige si te sales del carril</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>Falla con marcas viales borradas o ausentes</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>BSM</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Detección de ángulo muerto — te avisa de vehículos no visibles por el retrovisor</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>No detecta motos pequeñas en todos los casos</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>TSR</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Reconocimiento de señales — lee señales con la cámara y te las muestra</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>Puede confundirse con señales de otras vías</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>HSA</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Asistente de arranque en pendiente — mantiene el freno unos segundos al arrancar</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>Solo dura ~2 segundos</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", fontWeight: 700 }}>DAM</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)" }}>Detección de fatiga — analiza patrones de dirección y te avisa</td>
              <td style={{ padding: "10px", borderBottom: "1px solid var(--slate-200)", color: "var(--slate-600)" }}>Falsos positivos con conducción deportiva</td>
            </tr>
            <tr>
              <td style={{ padding: "10px", fontWeight: 700 }}>TPMS</td>
              <td style={{ padding: "10px" }}>Monitoreo de presión de neumáticos — avisa si uno pierde presión</td>
              <td style={{ padding: "10px", color: "var(--slate-600)" }}>Necesita calibración al cambiar neumáticos</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Hay más sistemas (ISA, eCall, AEBS para mercancías…) pero estos
        10 cubren el 95% de las preguntas del examen.
      </p>

      <h2>Cómo preparar el bloque ADAS</h2>
      <p>Tres pasos concretos:</p>
      <ol>
        <li>
          <b>Memoriza las siglas con su nombre completo y función</b>.
          La tabla de arriba te vale — léela 3-4 veces seguidas y luego
          intenta recitar cada sistema cubriendo la columna
          &ldquo;función&rdquo;.
        </li>
        <li>
          <b>Haz tests específicos del bloque</b>. En DGT Tests tienes
          una categoría dedicada solo a ADAS —{" "}
          <Link href="/adas">aquí los tests</Link>. Si haces 5-10 tests
          completos centrados en ADAS, las trampas más típicas se te
          quedan grabadas.
        </li>
        <li>
          <b>Lee preguntas con foto despacio</b>. Si te ponen una imagen
          del cuadro de mandos con varias luces encendidas, lee la
          pregunta primero, identifica qué SISTEMA está preguntando, y
          luego mira la imagen. Si miras la imagen sin contexto, te
          confundes con luces que no son relevantes.
        </li>
      </ol>

      <h2>Resumen rápido</h2>
      <ul>
        <li>ADAS = Sistemas avanzados de asistencia a la conducción</li>
        <li>En el examen aparecen 2-4 preguntas → críticas no fallar</li>
        <li>Las preguntas cubren: identificación, función y limitaciones (lo más fallado)</li>
        <li>Las 10 siglas a dominar: ABS, ESC, ACC, AEB, LKA, BSM, TSR, HSA, DAM, TPMS</li>
      </ul>
      <p>
        Practica el bloque con{" "}
        <Link href="/adas">los tests específicos de ADAS</Link> y revisa
        las dudas concretas en{" "}
        <Link href="/faq">preguntas frecuentes</Link>. Si quieres ver el
        panorama general del examen (cuántos fallos puedes tener, cómo
        contar el tiempo), mira{" "}
        <Link href="/recursos/cuantos-fallos-teorico-dgt">esta guía
        de aprobado a la primera</Link>.
      </p>
    </>
  )
}
