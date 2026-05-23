import Link from "next/link"
import type { RecursoMeta } from "./_registry"

export const meta: RecursoMeta = {
  slug:           "cuantos-fallos-teorico-dgt",
  title:          "Cuántos fallos puedo tener en el examen teórico DGT",
  description:    "La regla del teórico DGT: 27 aciertos sobre 30 (3 fallos máximo). Por qué se diseñó así, qué pasa si suspendes y cómo asegurarte de aprobar a la primera.",
  excerpt:        "27 aciertos sobre 30. Te explico por qué el límite es tan estricto, qué pasa si lo pasas y cómo asegurarte de no llegar nunca al filo.",
  publishedAt:    "2026-05-24",
  updatedAt:      "2026-05-24",
  readingMinutes: 6,
  topic:          "examen",
}

export default function Cuerpo() {
  return (
    <>
      <p>
        La regla del examen teórico del DGT es estricta:{" "}
        <b>fallas más de 3 preguntas y suspendes</b>. Punto. No hay
        redondeo amable, no hay &ldquo;esta media bien&rdquo;. O sacas
        27 de 30, o vuelves a casa con la fecha del próximo intento y
        los ~95€ de tasas que tienes que volver a pagar.
      </p>
      <p>
        Pero detrás de esa regla simple hay matices que conviene
        conocer: por qué se diseñó así, qué pasa si fallas exactamente
        3, cómo se cuentan las preguntas en blanco, y sobre todo, qué
        tienes que hacer para asegurarte de no superar ese límite.
      </p>

      <h2>La regla clara: 27 aciertos sobre 30</h2>
      <p>
        El examen teórico del Permiso B son 30 preguntas tipo test con
        tres opciones de respuesta cada una. <b>Solo hay una respuesta
        correcta</b> en cada pregunta — no hay parciales, no hay
        &ldquo;más correcta que la otra&rdquo;.
      </p>
      <p>Para aprobar necesitas:</p>
      <ul>
        <li><b>27 o más aciertos</b> (es decir, 3 fallos como máximo)</li>
        <li>Si fallas 4 o más, suspendes</li>
      </ul>
      <p>
        Las preguntas en blanco cuentan como falladas. Así que si vas mal
        de tiempo y dejas 3 sin contestar, ya estás al límite — un solo
        fallo más y suspendes. Conclusión: <b>contesta a todas las
        preguntas, aunque sea adivinando</b>. Una pregunta sin contestar
        tiene 0% de probabilidad de acertar; una contestada al azar
        tiene 33%.
      </p>

      <h2>Por qué solo 3 fallos</h2>
      <p>
        Otros países son más permisivos. En Francia puedes fallar 5
        sobre 40 preguntas (12,5%). En Italia 4 sobre 40 (10%). En
        Alemania 10 puntos sobre 100. <b>La DGT solo permite un 10% de
        fallos</b> — lo cual es razonable en comparación, pero la forma
        del examen (30 preguntas, no 40+) hace que cada error pese más.
      </p>
      <p>
        La cifra de 3 fallos no es arbitraria: estadísticamente,{" "}
        <b>el 50-60% de los aspirantes aprueba a la primera</b>. Si
        subieran el límite a 5 fallos, casi todo el mundo aprobaría y el
        examen perdería su función filtro. Si lo bajaran a 2, suspendería
        el 70-80% y se colapsaría el sistema con repetidores.
      </p>

      <h2>Qué pasa cuando suspendes</h2>
      <p>Si suspendes:</p>
      <ol>
        <li>
          <b>Pagas las tasas otra vez</b>. Modelo 791 → ~95€ (puede
          variar ligeramente cada año).
        </li>
        <li>
          <b>Esperas tu siguiente convocatoria</b>. El plazo mínimo
          depende de tu provincia: típicamente entre 1 y 3 semanas.
        </li>
        <li>
          <b>Si suspendes 2 veces seguidas</b>, algunas autoescuelas te
          exigen clases teóricas extra antes de la tercera convocatoria.
          La DGT no lo obliga, pero muchos centros sí — depende del
          contrato que firmaste.
        </li>
        <li>
          <b>Si suspendes 3 veces seguidas</b>, no hay ningún tope
          legal: puedes seguir presentándote. Pero llegados a este
          punto, lo razonable es replantear la estrategia: ¿estás
          estudiando bien?, ¿con material actualizado?, ¿haciendo
          suficientes tests?
        </li>
      </ol>

      <h2>Cómo asegurarte de fallar menos de 3</h2>
      <p>
        Hay 4 cosas que separan al 60% que aprueba a la primera del 40%
        que suspende:
      </p>
      <ol>
        <li>
          <b>Haz al menos 30 tests completos antes de presentarte</b>.
          No &ldquo;ojeé el manual&rdquo; — 30 simulacros enteros de 30
          preguntas con sus 30 minutos. Si en la fase final tu media de
          aciertos está consistentemente por encima de 28/30, vas listo.
          Si oscilas entre 24-26, todavía no.
        </li>
        <li>
          <b>Usa el modo examen real con cronómetro</b>. No es lo mismo
          responder 30 preguntas tranquilo en casa que con un reloj
          corriendo. La fatiga + el estrés añaden 1-2 fallos por encima
          de tu media normal. Si tu media en modo práctica es 27/30, el
          examen real será 25/30 → suspenso. Necesitas 28-29 de media
          tranquilo para asegurarte el 27 en el real. Tienes el modo
          examen disponible al iniciar cualquier{" "}
          <Link href="/permiso-b">test de Permiso B</Link>.
        </li>
        <li>
          <b>Repasa SIEMPRE tus errores</b>. Cuando una pregunta te sale
          mal, mira la explicación. Aunque el motivo te parezca obvio,
          dedícale 30 segundos. Tu cerebro guarda el patrón mucho mejor
          cuando entiende el porqué que cuando memoriza.
        </li>
        <li>
          <b>No te confíes con las preguntas de señales</b>. Es el
          bloque más fácil aparentemente, pero el que más
          confianza-fallos provoca: lees rápido, &ldquo;ah, esa la
          sé&rdquo;, y marcas mal. Lee la pregunta entera SIEMPRE,
          incluso si la señal te suena.
        </li>
      </ol>

      <h2>Errores típicos que te cuestan los 3 fallos</h2>
      <p>Las preguntas que más se fallan según el banco DGT:</p>
      <ul>
        <li>
          <b>Velocidades en zonas urbanas/interurbanas</b> con vehículos
          especiales (motos, mercancías). La trampa es que hay 4-5
          valores distintos según el tipo de vía y vehículo, y las
          opciones son muy parecidas.
        </li>
        <li>
          <b>Maniobras en glorietas múltiples</b>. Cambio de carril en
          glorietas grandes con varios carriles concéntricos: cuándo
          señalizar, qué carril elegir.
        </li>
        <li>
          <b>Alcohol y drogas en conductores noveles</b> (durante los 2
          primeros años): el límite es la mitad de un conductor
          experimentado, y muchos no lo saben.
        </li>
        <li>
          <b>Distancias y tiempos de seguridad</b> según condiciones
          atmosféricas. Las cifras varían entre seco/mojado/niebla y la
          gente las confunde.
        </li>
        <li>
          <b>Sistemas ADAS</b> — el bloque más nuevo y el menos
          preparado por la gente que estudia con material viejo. Si te
          examinas en 2026 con un manual de 2020, te pillarán aquí.
          Tienes una{" "}
          <Link href="/recursos/test-adas-dgt">guía específica del
          bloque ADAS</Link> para preparártelo bien.
        </li>
      </ul>

      <h2>Tu camino hasta el aprobado</h2>
      <p>Si tienes el examen en menos de 2 semanas:</p>
      <ol>
        <li>
          Haz <Link href="/permiso-b">un test de Permiso B</Link> y ve
          cómo vas
        </li>
        <li>Si sacas &lt;26/30: necesitas 1-2 semanas más de preparación</li>
        <li>
          Si sacas 27-28/30: estás cerca, repasa errores con el test de
          errores (disponible para usuarios registrados)
        </li>
        <li>
          Si sacas 29-30/30 consistentemente: estás listo, pero mantén
          la inercia hasta el día del examen
        </li>
      </ol>
      <p>
        Y si tienes dudas concretas sobre el examen — plazos, tasas, qué
        llevar, qué pasa si llegas tarde — mira{" "}
        <Link href="/faq">las preguntas frecuentes</Link>.
      </p>
    </>
  )
}
