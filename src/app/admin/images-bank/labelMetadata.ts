/**
 * Metadata de los labels del clasificador SigLIP para la vista admin.
 *
 * Por qué SEPARAR la metadata del classifier:
 *   - Las IDs en `classify_siglip.py` quedan en inglés (estables, no rotan
 *     entre runs ni al cambiar idioma).
 *   - El JSON de salida usa esas IDs como keys → estables.
 *   - Esta capa solo traduce y agrupa para la UI. Si traduces a otro
 *     idioma o re-categorizas, NO hay que re-clasificar imágenes.
 *
 * Cuándo actualizar:
 *   - Si añades labels nuevos en classify_siglip.py → añádelos aquí también
 *     con su categoría y display español. Si no, salen sin traducir
 *     (fallback al id en inglés).
 *   - Si quieres mover un label de categoría → cambia `category` aquí.
 *
 * Orden visual = orden del array CATEGORIES.
 */

export const CATEGORIES = [
  "Escenas",
  "Vehículos",
  "Señalización (forma)",
  "Señalización (tipo)",
  "Señales específicas",
  "Interior coche",
  "Factor vehículo",
  "Factor humano",
  "Controles policiales",
  "Condiciones",
  "Peatones y convivencia",
  "Especiales",
] as const

export type Category = typeof CATEGORIES[number]

export interface LabelMetadata {
  displayEs: string
  category:  Category
  /** ISO 8601 (YYYY-MM-DD). Si presente y a menos de NEW_BADGE_DAYS
   *  días, el sidebar muestra un badge "NEW" junto al pill del filtro.
   *  Convención: cada vez que se añade un label nuevo al banco se le
   *  pone la fecha de hoy; expira solo a los 7 días sin limpieza. */
  addedAt?:  string
}

/** Días que un label se considera "nuevo" desde su addedAt (o
 *  discoveredAt si vino de Gemini/Groq). Cambia aquí si quieres
 *  hacer la ventana más larga/corta. */
export const NEW_BADGE_DAYS = 7

/** Devuelve true si el label fue añadido recientemente. Comprueba
 *  primero el `addedAt` de la metadata estática (labels manuales);
 *  si no, mira `discoveredAt` del label descubierto por Gemini/Groq
 *  pasado por el caller (page.tsx hace el merge runtime con
 *  discovered_labels.json). */
export function isLabelNew(
  id: string,
  discoveredAt?: string,
  now: number = Date.now(),
): boolean {
  const iso = LABEL_METADATA[id]?.addedAt ?? discoveredAt
  if (!iso) return false
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return false
  const ageMs = now - ts
  return ageMs >= 0 && ageMs < NEW_BADGE_DAYS * 86_400_000
}

export const LABEL_METADATA: Record<string, LabelMetadata> = {
  // ── Escenas ───────────────────────────────────────────────────────
  urban_street:        { displayEs: "Calle urbana",                category: "Escenas" },
  rural_road:          { displayEs: "Carretera rural",             category: "Escenas" },
  highway:             { displayEs: "Autovía/Autopista",           category: "Escenas" },
  divided_highway:     { displayEs: "Carretera dividida (mediana)", category: "Escenas", addedAt: "2026-05-26" },
  single_lane_road:    { displayEs: "Carretera sin mediana",        category: "Escenas", addedAt: "2026-05-26" },
  road_works:          { displayEs: "Obras en la vía",              category: "Escenas", addedAt: "2026-05-26" },
  tunnel:              { displayEs: "Túnel",                       category: "Escenas" },
  tunnel_entrance:     { displayEs: "Entrada de túnel",             category: "Escenas", addedAt: "2026-05-26" },
  bridge:              { displayEs: "Puente",                      category: "Escenas" },
  roundabout:          { displayEs: "Rotonda",                     category: "Escenas" },
  roundabout_entrance: { displayEs: "Entrada a glorieta",          category: "Escenas", addedAt: "2026-05-26" },
  level_crossing:      { displayEs: "Paso a nivel",                category: "Escenas", addedAt: "2026-05-26" },
  intersection:                  { displayEs: "Intersección",                  category: "Escenas" },
  lane_merge_diverge:            { displayEs: "Incorporación / bifurcación",   category: "Escenas", addedAt: "2026-05-26" },
  incorporation:                 { displayEs: "Incorporación a la vía",        category: "Escenas", addedAt: "2026-05-27" },
  vehicle_collision_risk:        { displayEs: "Riesgo entre vehículos",        category: "Escenas", addedAt: "2026-05-27" },
  intersection_maneuver:         { displayEs: "Maniobra en intersección",      category: "Escenas", addedAt: "2026-05-25" },
  intersection_priority_diagram: { displayEs: "Prioridad en cruce (diagrama)", category: "Escenas", addedAt: "2026-05-26" },
  crosswalk:           { displayEs: "Paso de peatones",            category: "Escenas" },
  parking:             { displayEs: "Aparcamiento",                category: "Escenas" },
  curve:               { displayEs: "Curva",                       category: "Escenas" },
  road_crest:          { displayEs: "Cambio de rasante",           category: "Escenas", addedAt: "2026-05-26" },

  // ── Vehículos ─────────────────────────────────────────────────────
  // pedestrian se ha movido a "Peatones y convivencia" — encaja mejor
  // ahí como ancla de toda la sección. Ya no es "participante del tráfico
  // genérico" sino el sujeto de la nueva categoría.
  car:                  { displayEs: "Coche",                category: "Vehículos" },
  truck:                { displayEs: "Camión",               category: "Vehículos" },
  trailer:              { displayEs: "Remolque / Caravana",  category: "Vehículos", addedAt: "2026-05-26" },
  motorcycle:           { displayEs: "Motocicleta",          category: "Vehículos" },
  bicycle:              { displayEs: "Bicicleta",            category: "Vehículos" },
  cyclist_on_road:      { displayEs: "Ciclista en calzada",  category: "Vehículos", addedAt: "2026-05-26" },
  moped:                { displayEs: "Ciclomotor",           category: "Vehículos", addedAt: "2026-05-26" },
  bus:                  { displayEs: "Autobús",              category: "Vehículos" },
  emergency_vehicle:    { displayEs: "Vehículo emergencia",  category: "Vehículos" },
  agricultural_vehicle: { displayEs: "Vehículo agrícola",    category: "Vehículos" },
  van:                  { displayEs: "Furgoneta",            category: "Vehículos" },
  construction_vehicle: { displayEs: "Maquinaria de obra",   category: "Vehículos", addedAt: "2026-05-26" },
  turn_signal_active:   { displayEs: "Intermitente activo",  category: "Vehículos", addedAt: "2026-05-26" },

  // ── Señalización (forma — qué TIPO de elemento es) ────────────────
  traffic_sign_vertical: { displayEs: "Señal vertical",  category: "Señalización (forma)" },
  road_marking:          { displayEs: "Marca vial",      category: "Señalización (forma)" },
  traffic_light:         { displayEs: "Semáforo",        category: "Señalización (forma)" },

  // ── Señalización (tipo — clasificación general por forma y color) ──
  sign_prohibition: { displayEs: "Prohibición (roja circular)", category: "Señalización (tipo)" },
  sign_warning:     { displayEs: "Peligro (triangular)",        category: "Señalización (tipo)" },
  sign_mandatory:   { displayEs: "Obligación (azul circular)",  category: "Señalización (tipo)" },
  sign_information: { displayEs: "Información (rectangular)",   category: "Señalización (tipo)" },
  sign_priority:    { displayEs: "Prioridad genérica",          category: "Señalización (tipo)" },

  // ── Señales específicas (los pictogramas más identificables) ───────
  sign_stop:                { displayEs: "STOP",                     category: "Señales específicas" },
  sign_yield:               { displayEs: "Ceda el paso",             category: "Señales específicas" },
  sign_speed_limit:         { displayEs: "Límite de velocidad",      category: "Señales específicas" },
  sign_no_overtaking:       { displayEs: "Prohibido adelantar",      category: "Señales específicas" },
  sign_no_entry:            { displayEs: "Dirección prohibida",      category: "Señales específicas" },
  sign_pedestrian_crossing: { displayEs: "Paso de peatones (señal)", category: "Señales específicas" },
  sign_works:               { displayEs: "Obras",                    category: "Señales específicas" },
  sign_priority_road:         { displayEs: "Vía con prioridad (rombo amarillo)", category: "Señales específicas" },
  edge_delineator_post:       { displayEs: "Hito de arista (baliza borde)",      category: "Señales específicas", addedAt: "2026-05-26" },
  wild_animals_crossing_sign:    { displayEs: "Señal animales salvajes",    category: "Señales específicas", addedAt: "2026-05-26" },
  traffic_light_warning_sign:    { displayEs: "Señal semáforo próximo",     category: "Señales específicas", addedAt: "2026-05-26" },

  // ── Interior coche ────────────────────────────────────────────────
  // Nota: `tires_wheels` y `mechanical` se han movido a "Factor vehículo"
  // porque ahí encajan mejor (mantenimiento/estado del vehículo).
  dashboard:           { displayEs: "Cuadro de mandos",            category: "Interior coche" },
  warning_light:       { displayEs: "Testigo luminoso",            category: "Interior coche" },
  car_mirror:          { displayEs: "Retrovisor",                  category: "Interior coche" },
  driver_pov_interior: { displayEs: "Vista del conductor (POV)",   category: "Interior coche" },
  airbags_xray:        { displayEs: "Airbags (vista rayos X)",     category: "Interior coche" },
  steering_wheel:      { displayEs: "Volante del coche",            category: "Interior coche", addedAt: "2026-05-26" },
  gps_device:          { displayEs: "Dispositivo GPS / navegador",  category: "Interior coche", addedAt: "2026-05-26" },
  child_seat:          { displayEs: "Asiento infantil",             category: "Interior coche", addedAt: "2026-05-26" },
  seat_belt:           { displayEs: "Cinturón de seguridad",        category: "Interior coche", addedAt: "2026-05-26" },

  // ── Factor vehículo (mantenimiento) ──────────────────────────────
  // Imágenes sobre el estado/mantenimiento del coche: neumáticos,
  // mecánica, ITV, repostaje, comprobación de presión, etc.
  // `tires_wheels` eliminado — fusionado en `mechanical` (factor vehículo consolidado).
  // `mechanical` consolidado: cubre TODO el factor vehículo — esquemas 2D
  // DGT, render 3D transparente, neumáticos/ruedas (antes `tires_wheels`),
  // revisión de fluidos, piezas aisladas (filtro, batería). Si la dilución
  // del embedding promedio se vuelve problemática (algún subset deja de
  // reconocerse), considerar separar otra vez en sub-labels.
  mechanical:                 { displayEs: "Mecánica / Motor / Esquema",  category: "Factor vehículo" },
  tire_inflation_check:       { displayEs: "Inflar / comprobar rueda",    category: "Factor vehículo", addedAt: "2026-05-25" },
  vehicle_maintenance_general:{ displayEs: "Mantenimiento general",       category: "Factor vehículo", addedAt: "2026-05-25" },
  tow_truck_assistance:       { displayEs: "Grúa / asistencia carretera", category: "Factor vehículo", addedAt: "2026-05-26" },
  vehicle_breakdown:          { displayEs: "Avería de vehículo",          category: "Factor vehículo", addedAt: "2026-05-26" },
  itv:                        { displayEs: "ITV",                         category: "Factor vehículo", addedAt: "2026-05-26" },
  auto_part_isolated:         { displayEs: "Componente / pieza aislada",  category: "Factor vehículo", addedAt: "2026-05-26" },
  vehicle_documents:          { displayEs: "Documentación vehículo/conductor", category: "Factor vehículo", addedAt: "2026-05-26" },

  // ── Factor humano (estado del conductor) ─────────────────────────
  // Imágenes sobre fatiga, postura, distracción, ergonomía y
  // condiciones psicofísicas del conductor.
  driver_fatigue:             { displayEs: "Fatiga / somnolencia",            category: "Factor humano", addedAt: "2026-05-25" },
  proper_driving_posture:     { displayEs: "Postura correcta + cinturón",     category: "Factor humano", addedAt: "2026-05-25" },
  driver_distraction:         { displayEs: "Distracción al volante",          category: "Factor humano", addedAt: "2026-05-25" },
  family_safety_in_car:       { displayEs: "Familia + sillita + cinturones",  category: "Factor humano", addedAt: "2026-05-26" },
  fatigue_warning_dashboard:  { displayEs: "Alerta fatiga (cuadro mandos)",   category: "Factor humano", addedAt: "2026-05-26" },
  driver_allergy_symptoms:    { displayEs: "Alergias",                        category: "Factor humano", addedAt: "2026-05-26" },
  medication_health:          { displayEs: "Medicación / Salud",              category: "Factor humano", addedAt: "2026-05-27" },
  alcohol_consumption:        { displayEs: "Consumo de alcohol",               category: "Factor humano", addedAt: "2026-05-26" },

  // ── Controles policiales ──────────────────────────────────────────
  // Imágenes de controles de alcoholemia, drogas o tráfico — el
  // dispositivo en sí (alcoholímetro) o el control en acción.
  breathalyzer_device:        { displayEs: "Alcoholímetro (dispositivo)",  category: "Controles policiales", addedAt: "2026-05-25" },
  police_breathalyzer_test:   { displayEs: "Control de alcoholemia",       category: "Controles policiales", addedAt: "2026-05-25" },

  // ── Condiciones meteo ─────────────────────────────────────────────
  night:                        { displayEs: "Noche",                        category: "Condiciones" },
  night_highway_lit:            { displayEs: "Autopista iluminada (noche)",   category: "Condiciones", addedAt: "2026-05-26" },
  night_driving_low_visibility: { displayEs: "Noche · baja visibilidad POV",  category: "Condiciones", addedAt: "2026-05-26" },
  lighting:                     { displayEs: "Iluminación / Alumbrado",       category: "Condiciones", addedAt: "2026-05-27" },
  rain:         { displayEs: "Lluvia",               category: "Condiciones" },
  fog:          { displayEs: "Niebla",               category: "Condiciones" },
  snow:         { displayEs: "Nieve",                category: "Condiciones" },
  snow_chains:                 { displayEs: "Cadenas para nieve",          category: "Condiciones" },
  snow_plow:                   { displayEs: "Quitanieves",                 category: "Condiciones" },
  icy_road:                    { displayEs: "Hielo en la calzada",         category: "Condiciones" },
  winter_driving_scene:        { displayEs: "Conducción invernal",         category: "Condiciones" },

  // ── Peatones y convivencia ────────────────────────────────────────
  // Imágenes centradas en el peatón como sujeto y en la convivencia
  // cívica conductor↔peatón. Cuando el classifier detecte uno de estos
  // tags, la pregunta probablemente trata de "cesión de paso", "atención
  // a peatones vulnerables", "distracciones", "visibilidad reducida", etc.
  pedestrian:                 { displayEs: "Peatón",                       category: "Peatones y convivencia" },
  yielding_to_pedestrian:     { displayEs: "Ceder paso a peatón",          category: "Peatones y convivencia", addedAt: "2026-05-25" },
  pedestrian_at_risk:         { displayEs: "Peatón en riesgo",             category: "Peatones y convivencia" },
  jaywalking:                 { displayEs: "Cruce indebido (sin paso)",    category: "Peatones y convivencia", addedAt: "2026-05-25" },
  elderly_pedestrian:         { displayEs: "Peatón mayor / anciano",       category: "Peatones y convivencia", addedAt: "2026-05-25" },
  child_pedestrian:           { displayEs: "Peatón niño",                  category: "Peatones y convivencia", addedAt: "2026-05-25" },
  pedestrian_with_disability: { displayEs: "Peatón con discapacidad",      category: "Peatones y convivencia", addedAt: "2026-05-25" },
  distracted_pedestrian:      { displayEs: "Peatón distraído (móvil)",     category: "Peatones y convivencia", addedAt: "2026-05-25" },
  group_of_pedestrians:       { displayEs: "Grupo de peatones",            category: "Peatones y convivencia", addedAt: "2026-05-25" },
  pedestrian_at_night:        { displayEs: "Peatón de noche / baja visibilidad", category: "Peatones y convivencia", addedAt: "2026-05-25" },

  // ── Especiales ────────────────────────────────────────────────────
  // `merging_into_traffic` ELIMINADO — precisión real ~3% en zero-shot
  // SigLIP. Se confundía sistemáticamente con adelantamientos /
  // intersecciones / esquemas. Si se necesita en el futuro, mejor un
  // mini-clasificador supervisado con ejemplos manuales.
  schematic_diagram:        { displayEs: "Esquema/Diagrama",            category: "Especiales" },
  overtaking:               { displayEs: "Adelantamiento",              category: "Especiales" },
  traffic_accident:         { displayEs: "Accidente de tráfico",        category: "Especiales" },
  traffic_officer_signal:   { displayEs: "Señal de agente de tráfico",  category: "Especiales" },
  gas_station:              { displayEs: "Gasolinera/Repostaje",        category: "Especiales" },
  first_aid_at_accident:    { displayEs: "Primeros auxilios (escena)",  category: "Especiales" },
  first_aid_maneuver:       { displayEs: "Maniobra de primeros auxilios", category: "Especiales", addedAt: "2026-05-25" },
  medicamentos:             { displayEs: "Medicamentos",                category: "Especiales", addedAt: "2026-05-26" },
}

/**
 * Devuelve el display español de un tag, con fallback al id si no
 * está en la metadata (label nuevo no traducido aún).
 */
export function labelEs(id: string): string {
  return LABEL_METADATA[id]?.displayEs ?? id
}

/**
 * Devuelve la categoría de un tag, con fallback a "Especiales" si no
 * está mapeado (típicamente label nuevo recién añadido al classifier).
 */
export function labelCategory(id: string): Category {
  return LABEL_METADATA[id]?.category ?? "Especiales"
}
