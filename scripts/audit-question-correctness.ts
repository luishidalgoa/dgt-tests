/**
 * Audita el banco de preguntas comparando dos estrategias:
 *
 *   A — OFICIAL:   la opción con isCorrect=true en la tabla options.
 *   B — EMPÍRICA:  la opción que MÁS USUARIOS han seleccionado en la
 *                  tabla answers (independientemente de si la app les
 *                  marcó correcto o no).
 *
 * Si A != B con >=5 respuestas, la pregunta es sospechosa: o bien es
 * muy engañosa, o bien la "correcta" en BBDD está mal. El usuario
 * revisa una a una; este script NO modifica nada.
 *
 * Además vuelca el detalle completo de la pregunta #1583 (caso que
 * disparó la sospecha).
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/audit-question-correctness.ts
 *
 * Implementación: tres queries planas + join en memoria. Evita el
 * panic de Prisma 6.19.3 + libsql con includes anidados (ver commit
 * ec6bed5).
 */
import { db } from "@/lib/db"

const LOW_DATA = 5    // bajo este nº de respuestas, marcamos "datos insuficientes" pero NO excluimos
const TOP_N    = 20

type Question = {
  id:           number
  enunciado:    string
  explicacion:  string
  aiGenerated:  boolean
}

type Option = {
  id:         number
  questionId: number
  letra:      string
  texto:      string
  isCorrect:  boolean
}

type AnswerAgg = {
  questionId:       number
  selectedOptionId: number
  totalSelected:    number
  appMarkedCorrect: number
}

type Suspect = {
  id:              number
  enunciado:       string
  aiGenerated:     boolean
  officialLetter:  string
  officialText:    string
  empiricalLetter: string
  empiricalText:   string
  totalAnswers:    number
  empiricalCount:  number
  empiricalPct:    number
  officialCount:   number
  officialPct:     number
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

async function main() {
  const target = process.env.TURSO_DATABASE_URL && process.env.TURSO_DATABASE_URL.includes("turso.io")
    ? "🔴 PROD (Turso)"
    : "🟢 LOCAL (SQLite)"
  console.log(`→ Conexión: ${target}`)
  console.log()

  // ── 1. Preguntas planas ────────────────────────────────────────────
  console.log("→ Cargando preguntas...")
  const questions = (await db.question.findMany({
    select: { id: true, enunciado: true, explicacion: true, aiGenerated: true },
  })) as Question[]
  console.log(`   ${questions.length} preguntas`)

  // ── 2. Opciones planas ─────────────────────────────────────────────
  console.log("→ Cargando opciones...")
  const options = (await db.option.findMany({
    select: { id: true, questionId: true, letra: true, texto: true, isCorrect: true },
  })) as Option[]
  console.log(`   ${options.length} opciones`)

  // ── 3. Agregación de answers (un grupo por (pregunta, opción)) ─────
  console.log("→ Agregando answers por (questionId, selectedOptionId)...")
  const aggRows = await db.$queryRawUnsafe<
    {
      questionId:       number
      selectedOptionId: number
      totalSelected:    number | bigint
      appMarkedCorrect: number | bigint
    }[]
  >(`
    SELECT
      questionId,
      selectedOptionId,
      COUNT(*) AS totalSelected,
      SUM(CASE WHEN isCorrect = 1 THEN 1 ELSE 0 END) AS appMarkedCorrect
    FROM answers
    WHERE selectedOptionId IS NOT NULL
    GROUP BY questionId, selectedOptionId
  `)
  const aggs: AnswerAgg[] = aggRows.map((r) => ({
    questionId:       Number(r.questionId),
    selectedOptionId: Number(r.selectedOptionId),
    totalSelected:    Number(r.totalSelected),
    appMarkedCorrect: Number(r.appMarkedCorrect),
  }))
  console.log(`   ${aggs.length} grupos (pregunta × opción)`)
  console.log()

  // ── 4. Lookups en memoria ──────────────────────────────────────────
  const optionsByQ = new Map<number, Option[]>()
  for (const o of options) {
    const arr = optionsByQ.get(o.questionId)
    if (arr) arr.push(o)
    else optionsByQ.set(o.questionId, [o])
  }
  for (const arr of optionsByQ.values()) {
    arr.sort((a, b) => a.letra.localeCompare(b.letra))
  }

  const aggByKey = new Map<string, AnswerAgg>()
  for (const a of aggs) {
    aggByKey.set(`${a.questionId}|${a.selectedOptionId}`, a)
  }

  // ── 5. Calcular sospechosas ────────────────────────────────────────
  // Una "sospechosa" es cualquier pregunta donde la opción oficial NO
  // coincide con la más seleccionada por los usuarios (con al menos
  // 1 respuesta). Las que tienen < LOW_DATA respuestas se marcan
  // "datos insuficientes" pero se incluyen igual.
  const suspects: Suspect[] = []
  let withEnoughData = 0
  let withAnyData    = 0
  let missingOfficial = 0

  for (const q of questions) {
    const opts = optionsByQ.get(q.id) ?? []
    const official = opts.find((o) => o.isCorrect)
    if (!official) { missingOfficial++; continue }

    let totalAnswers = 0
    const counts = new Map<number, number>()
    for (const o of opts) {
      const a = aggByKey.get(`${q.id}|${o.id}`)
      const c = a?.totalSelected ?? 0
      counts.set(o.id, c)
      totalAnswers += c
    }
    if (totalAnswers === 0) continue
    withAnyData++
    if (totalAnswers >= LOW_DATA) withEnoughData++

    // Opción más seleccionada
    let topId = -1
    let topCount = -1
    for (const [oid, c] of counts) {
      if (c > topCount) { topCount = c; topId = oid }
    }
    if (topId === official.id) continue

    const empirical = opts.find((o) => o.id === topId)!
    const officialCount = counts.get(official.id) ?? 0
    suspects.push({
      id:              q.id,
      enunciado:       q.enunciado,
      aiGenerated:     q.aiGenerated,
      officialLetter:  official.letra,
      officialText:    official.texto,
      empiricalLetter: empirical.letra,
      empiricalText:   empirical.texto,
      totalAnswers,
      empiricalCount:  topCount,
      empiricalPct:    (topCount / totalAnswers) * 100,
      officialCount,
      officialPct:     (officialCount / totalAnswers) * 100,
    })
  }

  // Las más respondidas primero — señal más fuerte
  suspects.sort((a, b) => b.totalAnswers - a.totalAnswers)
  const suspectsWithEnough = suspects.filter((s) => s.totalAnswers >= LOW_DATA)

  // ── 6. Resumen ─────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════")
  console.log(" RESUMEN")
  console.log("═══════════════════════════════════════════════════════════")
  console.log(`Preguntas analizadas:                       ${questions.length}`)
  console.log(`Sin opción correcta marcada (skip):         ${missingOfficial}`)
  console.log(`Con al menos 1 respuesta:                   ${withAnyData}`)
  console.log(`Con datos suficientes (>=${LOW_DATA} respuestas):    ${withEnoughData}`)
  console.log(`Sospechosas TOTALES (A != B, N>=1):         ${suspects.length}`)
  console.log(`Sospechosas con datos suficientes (N>=${LOW_DATA}):   ${suspectsWithEnough.length}`)
  console.log()

  // ── 7. Top N ───────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════")
  console.log(` TOP ${TOP_N} SOSPECHOSAS (ordenadas por nº de respuestas)`)
  console.log("═══════════════════════════════════════════════════════════")
  if (suspects.length === 0) {
    console.log("✓ No hay divergencias entre oficial y empírica.")
  }
  for (const s of suspects.slice(0, TOP_N)) {
    const markers = [
      s.aiGenerated ? "📍AI" : null,
      s.totalAnswers < LOW_DATA ? "📊 datos insuficientes" : null,
    ].filter(Boolean).join(" ")
    const tag = markers ? `  [${markers}]` : ""
    console.log()
    console.log(`#${s.id} — ${s.totalAnswers} respuestas${tag}`)
    console.log(`   "${truncate(s.enunciado, 80)}"`)
    console.log(`   Oficial:  ${s.officialLetter}) ${truncate(s.officialText, 60)}`)
    console.log(`             ${s.officialCount}/${s.totalAnswers}  (${s.officialPct.toFixed(1)}%)`)
    console.log(`   Mayoría:  ${s.empiricalLetter}) ${truncate(s.empiricalText, 60)}`)
    console.log(`             ${s.empiricalCount}/${s.totalAnswers}  (${s.empiricalPct.toFixed(1)}%)`)
  }
  if (suspects.length > TOP_N) {
    console.log()
    console.log(`(... y ${suspects.length - TOP_N} más con menos respuestas)`)
  }
  console.log()

  // ── 8. Detalle 1583 ────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════")
  console.log(" DETALLE PREGUNTA #1583")
  console.log("═══════════════════════════════════════════════════════════")
  const q1583 = questions.find((q) => q.id === 1583)
  if (!q1583) {
    console.log("✗ Pregunta #1583 no encontrada en BBDD.")
  } else {
    const opts1583 = optionsByQ.get(1583) ?? []
    console.log()
    console.log(`Enunciado: "${q1583.enunciado}"`)
    if (q1583.aiGenerated) console.log("📍 aiGenerated=true")
    console.log()
    console.log("Explicación oficial DGT:")
    for (const line of q1583.explicacion.split("\n")) {
      console.log(`  ${line}`)
    }
    console.log()
    console.log("Opciones en BBDD:")
    for (const o of opts1583) {
      const flag = o.isCorrect ? "  ✓ isCorrect=true" : ""
      console.log(`  ${o.letra}) ${o.texto}${flag}`)
    }
    console.log()
    console.log("Respuestas reales por opción:")
    let total1583 = 0
    for (const o of opts1583) {
      total1583 += aggByKey.get(`1583|${o.id}`)?.totalSelected ?? 0
    }
    console.log(`  Total respuestas (no en blanco): ${total1583}`)
    console.log()
    for (const o of opts1583) {
      const a = aggByKey.get(`1583|${o.id}`)
      const total = a?.totalSelected ?? 0
      const mc = a?.appMarkedCorrect ?? 0
      const pct = total1583 > 0 ? (total / total1583) * 100 : 0
      console.log(`  ${o.letra}) seleccionada por ${total} usuarios  (${pct.toFixed(1)}%)`)
      console.log(`     → app marcó correcto: ${mc} · incorrecto: ${total - mc}`)
    }
  }
  console.log()
}

main()
  .catch((e) => {
    console.error("❌", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
