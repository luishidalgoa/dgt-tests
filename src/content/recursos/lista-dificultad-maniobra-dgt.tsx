import Link from "next/link"
import type { RecursoMeta } from "./_registry"

export const meta: RecursoMeta = {
  slug:           "lista-dificultad-maniobra-dgt",
  title:          "Lista de dificultad de maniobra de los vehículos — orden DGT explicado",
  description:    "El orden oficial de la DGT que clasifica los vehículos según su dificultad para maniobrar. Lista completa de 11 categorías y cómo se aplica en estrechamientos, cruces y vías sin señalizar.",
  excerpt:        "Bicicleta, turismo, camión, articulado, especial… Quién cede a quién en un estrechamiento sin más señales. El orden oficial DGT explicado con ejemplos prácticos.",
  publishedAt:    "2026-05-25",
  updatedAt:      "2026-05-25",
  readingMinutes: 6,
  topic:          "examen",
}

export default function Article() {
  return (
    <>
      <p>
        En el examen teórico DGT cae con frecuencia una pregunta tipo
        &laquo;te encuentras de frente con un camión en una calle estrecha, ¿quién
        cede el paso?&raquo;. La respuesta sale de un orden oficial llamado{" "}
        <b>lista de dificultad de maniobra</b>, definido en el Reglamento
        General de Circulación. Conocerlo de memoria asegura entre 1 y 3
        aciertos en el examen.
      </p>

      <h2>Qué es la lista de dificultad de maniobra</h2>
      <p>
        Es un orden establecido oficialmente que clasifica los vehículos
        de <b>menor a mayor dificultad para maniobrar</b>. Sirve como
        criterio de preferencia cuando dos vehículos coinciden en una vía
        donde no caben simultáneamente y <b>ninguna otra norma resuelve</b>{" "}
        la situación (no hay semáforo, señal de ceda, prioridad por la
        derecha aplicable, etc.).
      </p>
      <p>
        La regla es simple: <b>el vehículo con mayor dificultad de maniobra
        tiene preferencia</b>, y el de menor dificultad debe apartarse,
        retroceder o ceder. Es lógico desde la realidad física: maniobrar
        un camión articulado en marcha atrás 50 metros es muy complicado;
        hacerlo con una bicicleta, trivial. La norma asume esa asimetría.
      </p>

      <h2>El orden oficial, de menos a más dificultad</h2>
      <p>
        Las 11 categorías que conviene memorizar, en orden ascendente:
      </p>
      <ol>
        <li>
          <b>Bicicletas y ciclos</b> — ágiles, pequeños, ligeros, fáciles
          de mover en cualquier dirección.
        </li>
        <li>
          <b>Motocicletas y ciclomotores</b> — más anchos que la bici, con
          motor, pero todavía muy maniobrables.
        </li>
        <li>
          <b>Turismos</b> — coches de pasajeros estándar (hasta 9 plazas
          incluido el conductor).
        </li>
        <li>
          <b>Vehículos mixtos</b> — turismos adaptados también para
          transporte de carga (todoterrenos, monovolúmenes con espacio
          de carga, etc.).
        </li>
        <li>
          <b>Furgonetas</b> — vehículos de transporte de mercancías de{" "}
          <b>hasta 3.500 kg de masa máxima autorizada (MMA)</b>.
        </li>
        <li>
          <b>Camiones</b> — vehículos de transporte de mercancías de{" "}
          <b>más de 3.500 kg de MMA</b>. Tamaño, peso y radio de giro
          notablemente mayores que la furgoneta.
        </li>
        <li>
          <b>Autobuses</b> — vehículos diseñados para el transporte
          colectivo de personas (más de 9 plazas).
        </li>
        <li>
          <b>Vehículos articulados</b> — cabeza tractora + semirremolque,
          unidos por un punto de articulación. Maniobran como una pieza
          única pero con mucho más radio de giro.
        </li>
        <li>
          <b>Trenes turísticos</b> — varios vagones articulados como una
          sola unidad. Casi imposibles de marcha atrás.
        </li>
        <li>
          <b>Conjuntos de vehículos</b> — vehículo principal + remolque
          independiente (camión con remolque, coche con caravana, etc.).
          La articulación los hace muy difíciles de maniobrar marcha atrás.
        </li>
        <li>
          <b>Vehículos especiales</b> — agrícolas (tractores, cosechadoras),
          de obras públicas, maquinaria autopropulsada. Los más complicados
          de la lista por tamaño, geometría inusual y velocidades reducidas.
        </li>
      </ol>

      <h2>Ejemplos prácticos del examen</h2>
      <p>
        Tres situaciones típicas que aparecen en el examen DGT:
      </p>
      <h3>1. Calle estrecha donde solo cabe un vehículo</h3>
      <p>
        Te cruzas con un camión en sentido contrario. Tú vas en turismo.
        ¿Quién cede? Tú. El camión está más arriba en la lista (posición
        6 vs 3), tiene mayor dificultad de maniobra → tiene preferencia.
        Buscas un hueco para apartarte (entrada de garaje, ensanchamiento)
        y le dejas pasar.
      </p>
      <h3>2. Camino rural con tractor</h3>
      <p>
        Vas en moto y te encuentras de frente con un tractor agrícola
        en un camino sin asfaltar. ¿Quién cede? Tú. El tractor es un
        vehículo especial (posición 11 — el TOP) y tú vas en motocicleta
        (posición 2). La diferencia es máxima → cedes sin dudar.
      </p>
      <h3>3. Misma categoría, sin diferencia de dificultad</h3>
      <p>
        Dos turismos coinciden en un estrechamiento sin señalización. La
        lista no decide (ambos en posición 3). En ese caso entran otras
        reglas: prioridad por la derecha, quien tenga ya el estrechamiento
        ocupado, o el conductor más cercano a una zona apta para apartarse.
      </p>

      <h2>Excepciones importantes</h2>
      <p>
        La lista de dificultad de maniobra solo se aplica cuando{" "}
        <b>NO hay otra norma específica</b>. Pierden contra ella, entre
        otras situaciones:
      </p>
      <ul>
        <li>
          <b>Vehículos en servicio de urgencia</b> con señales acústicas
          y luminosas (ambulancia, bomberos, policía en emergencia) —
          tienen preferencia absoluta, da igual su categoría.
        </li>
        <li>
          <b>Transportes especiales</b> con autorización (cargas anchas,
          maquinaria escoltada) — tienen prioridad sobre el tráfico
          ordinario.
        </li>
        <li>
          <b>Pendientes</b> — en una rampa estrecha, el que sube tiene
          preferencia sobre el que baja (cuesta más arrancar cuesta arriba
          parado). Esto sobrescribe la lista de maniobra.
        </li>
        <li>
          <b>Señales</b> — ceda el paso, stop, prioridad expresada,
          semáforos. Cualquier señal explícita resuelve la situación
          antes que esta lista.
        </li>
      </ul>

      <h2>Truco para memorizar el orden</h2>
      <p>
        Piensa en el orden <b>por tamaño y articulación</b>. De menos a
        más: lo que cabe entre tus brazos (bici, moto), lo que cabe en un
        garaje normal (turismo, mixto, furgo), lo que necesita aparcamiento
        de camión (camión, autobús), lo que tiene varias piezas unidas
        (articulado, tren, conjunto) y, por último, lo especial (tractores).
        Si tienes dudas en el examen, ordénalos mentalmente por tamaño y
        número de &laquo;trozos&raquo; — coincide en casi todos los casos.
      </p>

      <h2>Resumen rápido</h2>
      <ul>
        <li>Quien tiene <b>mayor dificultad de maniobra</b> tiene preferencia.</li>
        <li>Orden: bici → moto → turismo → mixto → furgoneta → camión → autobús → articulado → tren turístico → conjunto → especial.</li>
        <li>Solo aplica si NO hay señal, semáforo, prioridad por la derecha, urgencia, pendiente u otra norma.</li>
        <li>Si ambos están en la misma categoría → otras reglas resuelven (derecha, ocupación previa, espacio para apartarse).</li>
      </ul>
      <p>
        Practica preguntas concretas sobre esto en{" "}
        <Link href="/permiso-b">los tests de Permiso B</Link> o en el{" "}
        <Link href="/repaso-final">repaso final</Link>. Si tienes otras
        dudas sobre el examen, mira las{" "}
        <Link href="/faq">preguntas frecuentes</Link>.
      </p>
    </>
  )
}
