/**
 * Genera (o regenera) src/data/manualIndice.json con la jerarquía completa
 * del temario del permiso B AEOL, asignando títulos automáticamente desde
 * el índice oficial del manual cuando los conoce.
 *
 * Uso:  npm run manual:extract-skeleton
 *
 * Comportamiento:
 *   1. Lee todos los codigoTema de BBDD y los normaliza a 3 niveles
 *      Tema > Bloque > SubBloque. Los temas que NO tienen subtema decimal
 *      en BBDD (TC 4, TC 5, TC 6, TC 8, TC 9, TC 10, TC Def) se reagrupan
 *      usando el PRIMER dígito del inner como bloque (ej: "TC 4-1.1.1"
 *      → bloque "4.1", sub-bloque "4.1.1.1") para coincidir con el manual.
 *   2. Aplica los títulos hardcoded del manual AEOL para los códigos que
 *      conoce (ver MANUAL_TITLES más abajo).
 *   3. Si el JSON ya existe, hace MERGE: respeta los títulos que ya
 *      estuvieran rellenados (no los pisa, aunque el catálogo de
 *      MANUAL_TITLES los conozca también — manda lo que rellenaste).
 *   4. Recalcula siempre los conteos `_preguntas` desde BBDD.
 *
 * Después de rellenar/editar a mano cualquier título, vuelves a ejecutar
 * el script y NO perderás tu trabajo: solo se añaden códigos nuevos que
 * hayan aparecido en BBDD y se actualizan los conteos.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { db } from "@/lib/db"
import {
  compareTemaCodes,
  classifyCodigoTema,
} from "@/lib/temas"

// ─────────────────────────────────────────────────────────────────────────
// Títulos del manual oficial AEOL Permiso B, extraídos del PDF "ÍNDICE.pdf"
// (4 páginas escaneadas). Indexado por código jerárquico SIN el prefijo "TC ".
//
// Cobertura: niveles 1-3 (Tema, Bloque, SubBloque-de-1-decimal). El nivel 4
// (1.2.5.3, 7.2.1.3…) NO está en el manual; queda vacío para rellenar con
// IA o a mano más adelante.
// ─────────────────────────────────────────────────────────────────────────

const MANUAL_TITLES: Record<string, string> = {
  // ── Definiciones ───────────────────────────────────────────────────────
  "Def":     "Definiciones",
  "Def.1":   "Definiciones generales",
  "Def.2":   "Clasificación de vehículos",
  "Def.3":   "Definiciones relativas a la masa de los vehículos",
  "Def.4":   "Categorías de los vehículos",

  // ── Tema 1: El uso de las vías ─────────────────────────────────────────
  "1":       "El uso de las vías",
  "1.1":     "El uso compartido de las vías públicas",
  "1.1.1":   "La vía, un espacio de convivencia y respeto",
  "1.1.2":   "Normas generales de comportamiento",
  "1.2":     "Los vehículos en la vía",
  "1.2.1":   "Partes de la vía",
  "1.2.2":   "Tipos de vías",
  "1.2.3":   "Normas de circulación",
  "1.2.4":   "Otras normas de circulación",
  "1.2.5":   "Tipos de carriles",
  "1.2.6":   "Vehículos que pueden utilizar el arcén",
  "1.2.7":   "Distancia de seguridad entre vehículos",
  "1.2.8":   "Circulación en vías saturadas",
  "1.2.9":   "Ordenación especial del tráfico",
  "1.3":     "Los peatones y animales en la vía",
  "1.3.1":   "La circulación de los peatones",
  "1.3.2":   "La circulación de los animales",
  "1.4":     "La velocidad",
  "1.4.1":   "Velocidades máximas y mínimas genéricas",
  "1.4.2":   "Velocidades prevalentes",
  "1.4.3":   "Velocidad adecuada a las circunstancias",
  "1.4.4":   "Precauciones para reducir la velocidad",
  "1.4.5":   "Competiciones de velocidad",
  "1.5":     "La prioridad",
  "1.5.1":   "¿Qué es la prioridad?",
  "1.5.2":   "Prioridad en las intersecciones",
  "1.5.3":   "Otras prioridades",
  "1.5.4":   "La prioridad de los vehículos en servicio de urgencia",
  "1.5.5":   "Prioridad en los estrechamientos de la calzada",

  // ── Tema 2: Las maniobras ──────────────────────────────────────────────
  "2":       "Las maniobras",
  "2.1":     "Normas generales",
  "2.1.1":   "¿Qué son las maniobras?",
  "2.1.2":   "¿Cómo se hacen las maniobras?",
  "2.2":     "Incorporación a la circulación",
  "2.2.1":   "¿Qué es esta maniobra?",
  "2.2.2":   "¿Cómo se realiza esta maniobra?",
  "2.2.3":   "Obligación de facilitar la maniobra",
  "2.3":     "Desplazamiento lateral",
  "2.3.1":   "¿Qué es esta maniobra?",
  "2.3.2":   "¿Para qué se hacen desplazamientos laterales?",
  "2.3.3":   "¿Cómo se realiza?",
  "2.4":     "Adelantamiento",
  "2.4.1":   "¿Qué es un adelantamiento?",
  "2.4.2":   "¿Qué no se considera adelantamiento?",
  "2.4.3":   "¿Cómo se debe adelantar?",
  "2.4.4":   "¿Qué debe hacer el conductor del vehículo adelantado?",
  "2.4.5":   "¿Dónde está prohibido adelantar?",
  "2.4.6":   "Casos especiales",
  "2.5":     "Cambio de dirección",
  "2.5.1":   "¿Qué es esta maniobra?",
  "2.5.2":   "¿Cómo se realiza?",
  "2.5.3":   "Casos especiales",
  "2.5.4":   "¿Dónde está prohibido cambiar de dirección?",
  "2.6":     "Cambio de sentido",
  "2.6.1":   "¿Qué es esta maniobra?",
  "2.6.2":   "¿Cómo se realiza?",
  "2.6.3":   "¿Dónde está prohibido cambiar el sentido de la marcha?",
  "2.6.4":   "Lugares recomendados",
  "2.7":     "Marcha atrás",
  "2.7.1":   "¿Se puede circular marcha atrás?",
  "2.7.2":   "¿Dónde se puede realizar marcha atrás?",
  "2.7.3":   "¿Cómo se realiza?",
  "2.8":     "Inmovilizaciones",
  "2.8.1":   "Detención",
  "2.8.2":   "Parada y estacionamiento",

  // ── Tema 3: La señalización ────────────────────────────────────────────
  "3":       "La señalización",
  "3.1":     "Las señales (normas generales)",
  "3.1.1":   "¿Qué son y cuántos tipos hay?",
  "3.1.2":   "¿Qué señal debo obedecer?",
  "3.1.3":   "Aplicación de las señales",
  "3.1.4":   "Señalización de tramos con obras o tareas de conservación",
  "3.2":     "Señales y órdenes de los agentes",
  "3.2.1":   "Señales realizadas con los brazos",
  "3.2.2":   "Señales realizadas con el silbato",
  "3.2.3":   "Señales realizadas desde el vehículo",
  "3.2.4":   "Otras señales",
  "3.2.5":   "¿Quién puede auxiliar a los agentes de la circulación?",
  "3.3":     "Señales circunstanciales, elementos de balizamiento y sistemas de contención",
  "3.3.1":   "Señalización circunstancial",
  "3.3.2":   "Elementos de balizamiento",
  "3.3.3":   "Sistemas de contención de vehículos",
  "3.4":     "Semáforos",
  "3.4.1":   "Semáforos reservados para peatones",
  "3.4.2":   "Semáforos circulares para vehículos",
  "3.4.3":   "Semáforos cuadrados para vehículos o de carril",
  "3.4.4":   "Semáforos reservados a determinados vehículos",
  "3.5":     "Señales de advertencia de peligro",
  "3.5.1":   "¿Cómo son?",
  "3.5.2":   "¿Para qué sirven?",
  "3.5.3":   "¿Cuál es su significado?",
  "3.6":     "Señales de reglamentación",
  "3.6.1":   "¿En qué lugar debo empezar a respetarlas?",
  "3.6.2":   "Señales de prioridad",
  "3.6.3":   "Señales de prohibición de entrada",
  "3.6.4":   "Señales de restricción de paso",
  "3.6.5":   "Otras señales de prohibición o restricción",
  "3.6.6":   "Señales de obligación",
  "3.6.7":   "Señales de fin de prohibición o restricción",
  "3.7":     "Señales de indicación",
  "3.7.1":   "Señales de indicaciones generales",
  "3.7.2":   "Señales de carriles",
  "3.7.3":   "Señales de servicio",
  "3.7.4":   "Señales de orientación",
  "3.7.5":   "Paneles complementarios",
  "3.7.6":   "Otras señales",
  "3.8":     "Marcas viales",
  "3.8.1":   "Significado de las marcas viales",
  "3.8.2":   "Marcas de otros colores",

  // ── Tema 4: Las luces del vehículo (sin subtema decimal en BBDD) ───────
  "4":       "Las luces del vehículo",
  "4.1":     "Dispositivos para indicar la presencia del vehículo",
  "4.2":     "Luces destinadas a iluminar la vía",
  "4.3":     "Luces destinadas a avisar a los demás usuarios",
  "4.4":     "Otras luces",
  "4.5":     "Condiciones que deben reunir los dispositivos luminosos",

  // ── Tema 5: El uso del vehículo ────────────────────────────────────────
  "5":       "El uso del vehículo",
  "5.1":     "Transporte de personas",
  "5.2":     "Transporte de mercancías o cosas",
  "5.3":     "Las puertas",
  "5.4":     "Señales en los vehículos",

  // ── Tema 6: La documentación ───────────────────────────────────────────
  "6":       "La documentación",
  "6.1":     "Documentación del conductor",
  "6.2":     "Documentación del vehículo",
  "6.3":     "Permiso y licencia de conducción por puntos",
  "6.4":     "Responsabilidad de las infracciones",

  // ── Tema 7: Accidentes y factores que intervienen ──────────────────────
  "7":       "Accidentes y factores que intervienen",
  "7.1":     "El grave problema de los accidentes",
  "7.1.1":   "Una verdadera tragedia",
  "7.1.2":   "Causas de los accidentes",
  "7.1.3":   "¿Dónde y cuándo se producen?",
  "7.1.4":   "Los grupos más vulnerables del tráfico",
  "7.1.5":   "La siniestralidad de las furgonetas",
  "7.2":     "El factor humano",
  "7.2.1":   "La velocidad",
  "7.2.2":   "La fatiga y el sueño",
  "7.2.3":   "Enfermedades y medicamentos",
  "7.2.4":   "El calor",
  "7.2.5":   "Las distracciones",
  "7.2.6":   "El alcohol",
  "7.2.7":   "Las drogas de abuso",
  "7.2.8":   "Tratamiento legal sobre alcohol y drogas",
  "7.2.9":   "Delitos contra la seguridad vial",
  "7.3":     "El factor vehículo",
  "7.3.1":   "Acomodación y reglajes del puesto del conductor",
  "7.3.2":   "Mandos",
  "7.3.3":   "Dispositivos de seguridad en el vehículo",
  "7.4":     "La vía y su entorno",
  "7.4.1":   "La adherencia",
  "7.4.2":   "Las curvas",
  "7.4.3":   "El derrape",
  "7.4.4":   "Las condiciones adversas",

  // ── Tema 8: Comportamiento en caso de accidente ────────────────────────
  "8":       "Comportamiento en caso de accidente",
  "8.1":     "El deber de ayudar a los demás",
  "8.2":     "Comportamiento en accidente (PAS)",
  "8.3":     "Técnicas de primeros auxilios (SOCORRER)",
  "8.4":     "Medidas en relación con la autoridad o sus agentes",
  "8.5":     "Proporcionar los datos",
  "8.6":     "Movilización y traslado de los heridos",
  "8.7":     "El botiquín de primeros auxilios",

  // ── Tema 9: Información básica del vehículo ────────────────────────────
  "9":       "Información básica del vehículo",
  "9.1":     "El motor",
  "9.2":     "Sistemas necesarios para el motor",
  "9.3":     "El equipo eléctrico",
  "9.4":     "El sistema de transmisión",
  "9.5":     "Accesorios, repuestos y herramientas",

  // ── Tema 10: Técnicas de conducción ────────────────────────────────────
  "10":      "Técnicas de conducción",
  "10.1":    "Técnicas de conducción preventiva",
  "10.2":    "Técnicas de conducción eficiente",
  "10.3":    "Regulación de acceso a vehículos en áreas urbanas (UVAR)",
}

// ─────────────────────────────────────────────────────────────────────────
// Tipos de salida
// ─────────────────────────────────────────────────────────────────────────

interface SubBloqueOut {
  codigo:     string
  titulo:     string
  _preguntas: number
}

interface BloqueOut {
  codigo:     string
  titulo:     string
  _preguntas: number
  subBloques: SubBloqueOut[]
}

interface TemaOut {
  codigo:     string
  titulo:     string
  _preguntas: number
  bloques:    BloqueOut[]
}

// ─────────────────────────────────────────────────────────────────────────
// Lógica principal
// ─────────────────────────────────────────────────────────────────────────

/** Lee el JSON existente para hacer merge de títulos no vacíos. */
function loadExistingTitles(outputPath: string): Map<string, string> {
  const titles = new Map<string, string>()
  if (!existsSync(outputPath)) return titles
  try {
    const data = JSON.parse(readFileSync(outputPath, "utf8")) as TemaOut[]
    for (const tema of data) {
      if (tema.titulo) titles.set(tema.codigo, tema.titulo)
      for (const bloque of tema.bloques) {
        if (bloque.titulo) titles.set(bloque.codigo, bloque.titulo)
        for (const sub of bloque.subBloques) {
          if (sub.titulo) titles.set(sub.codigo, sub.titulo)
        }
      }
    }
  } catch (e) {
    console.warn(`⚠ No se pudo leer el JSON existente (${outputPath}):`, e)
  }
  return titles
}

async function main() {
  const all = await db.question.findMany({
    select: { codigoTema: true },
    where:  { codigoTema: { not: null } },
  })

  type SubMid = { codigo: string; preguntas: number }
  type BloqueMid = {
    codigo:     string
    preguntas:  number
    subBloques: Map<string, SubMid>
  }
  type TemaMid = {
    codigo:    string
    preguntas: number
    bloques:   Map<string, BloqueMid>
  }
  const temas    = new Map<string, TemaMid>()
  const huerfanos: string[] = []

  for (const { codigoTema } of all) {
    if (!codigoTema) continue
    const cls = classifyCodigoTema(codigoTema)
    if (!cls) {
      huerfanos.push(codigoTema)
      continue
    }
    const { padreCode, bloqueCode, subCode } = cls

    if (!temas.has(padreCode)) {
      temas.set(padreCode, { codigo: padreCode, preguntas: 0, bloques: new Map() })
    }
    const tema = temas.get(padreCode)!
    tema.preguntas++

    if (!tema.bloques.has(bloqueCode)) {
      tema.bloques.set(bloqueCode, {
        codigo:     bloqueCode,
        preguntas:  0,
        subBloques: new Map(),
      })
    }
    const bloque = tema.bloques.get(bloqueCode)!
    bloque.preguntas++

    if (subCode) {
      if (!bloque.subBloques.has(subCode)) {
        bloque.subBloques.set(subCode, { codigo: subCode, preguntas: 0 })
      }
      bloque.subBloques.get(subCode)!.preguntas++
    }
  }

  // Cargar títulos previos (merge) y catálogo del manual
  const outputPath = resolve(process.cwd(), "src/data/manualIndice.json")
  const existing   = loadExistingTitles(outputPath)

  /**
   * Resolución de título para un código:
   *   1. Si el JSON ya tenía un título no vacío → respeta el del usuario
   *   2. Si no, mira el catálogo MANUAL_TITLES
   *   3. Si tampoco está, devuelve cadena vacía
   */
  function resolveTitle(codigo: string): string {
    return existing.get(codigo) ?? MANUAL_TITLES[codigo] ?? ""
  }

  // Convertir a salida ordenada
  const output: TemaOut[] = [...temas.values()]
    .sort((a, b) => compareTemaCodes(`TC ${a.codigo}`, `TC ${b.codigo}`))
    .map((t) => ({
      codigo:     t.codigo,
      titulo:     resolveTitle(t.codigo),
      _preguntas: t.preguntas,
      bloques:    [...t.bloques.values()]
        .sort((a, b) =>
          a.codigo.localeCompare(b.codigo, undefined, { numeric: true })
        )
        .map((b) => ({
          codigo:     b.codigo,
          titulo:     resolveTitle(b.codigo),
          _preguntas: b.preguntas,
          subBloques: [...b.subBloques.values()]
            .sort((x, y) =>
              x.codigo.localeCompare(y.codigo, undefined, { numeric: true })
            )
            .map((s) => ({
              codigo:     s.codigo,
              titulo:     resolveTitle(s.codigo),
              _preguntas: s.preguntas,
            })),
        })),
    }))

  if (!existsSync(dirname(outputPath))) mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8")

  // Resumen
  const nTemas = output.length
  const nBloq  = output.reduce((s, t) => s + t.bloques.length, 0)
  const nSub   = output.reduce(
    (s, t) => s + t.bloques.reduce((sb, b) => sb + b.subBloques.length, 0),
    0
  )
  const totalQ = output.reduce((s, t) => s + t._preguntas, 0)

  let filled = 0
  let empty  = 0
  for (const t of output) {
    if (t.titulo) filled++; else empty++
    for (const b of t.bloques) {
      if (b.titulo) filled++; else empty++
      for (const s of b.subBloques) {
        if (s.titulo) filled++; else empty++
      }
    }
  }

  console.log(`\n✅ Skeleton generado en ${outputPath}`)
  console.log(`   ${nTemas} temas · ${nBloq} bloques · ${nSub} sub-bloques`)
  console.log(`   ${totalQ} preguntas cubiertas (de ${all.length} totales)`)
  console.log(`   Títulos: ${filled} con título · ${empty} vacíos`)
  if (huerfanos.length > 0) {
    const uniq = [...new Set(huerfanos)]
    console.log(`\n⚠ ${huerfanos.length} preguntas excluidas (codigoTema no parseable):`)
    for (const c of uniq) console.log(`   · ${JSON.stringify(c)}`)
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
