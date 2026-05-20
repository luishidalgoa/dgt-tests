/**
 * Utilidades para trabajar con los códigos de tema (codigoTema).
 *
 * El formato es "TC X.Y-Z.W (...)" donde la parte "TC X.Y" identifica
 * el capítulo del libro AEOL. Agrupamos por ese prefijo.
 */

const TEMA_NAMES: Record<string, string> = {
  "TC 1":    "La conducción",
  "TC 1.1":  "El conductor",
  "TC 1.2":  "La vía",
  "TC 1.3":  "El entorno",
  "TC 1.4":  "Normas generales",
  "TC 1.5":  "Velocidad",
  "TC 2":    "Otros usuarios",
  "TC 2.1":  "Peatones",
  "TC 2.2":  "Ciclistas",
  "TC 2.3":  "Motociclistas",
  "TC 2.4":  "Vehículos especiales",
  "TC 2.5":  "Camiones",
  "TC 2.6":  "Autobuses",
  "TC 2.7":  "Transporte escolar",
  "TC 2.8":  "Animales",
  "TC 3":    "Señalización",
  "TC 3.1":  "Agentes",
  "TC 3.2":  "Semáforos",
  "TC 3.3":  "Marcas viales",
  "TC 3.4":  "Carteles",
  "TC 3.5":  "Señales de peligro",
  "TC 3.6":  "Señales de prohibición",
  "TC 3.7":  "Señales de obligación",
  "TC 3.8":  "Señales de indicación",
  "TC 4":    "Maniobras",
  "TC 5":    "Estacionamiento",
  "TC 6":    "Alumbrado",
  "TC 7":    "Equipamiento del vehículo",
  "TC 7.1":  "Documentación",
  "TC 7.2":  "Mecánica",
  "TC 7.3":  "Seguridad activa y pasiva",
  "TC 7.4":  "Mantenimiento",
  "TC 8":    "Transporte de cargas",
  "TC 9":    "Accidentes",
  "TC 10":   "Cuestiones administrativas",
}

export function getTemaName(code: string): string {
  return TEMA_NAMES[code] ?? code
}

export function extractTemaPrefix(codigoTema: string | null): string | null {
  if (!codigoTema) return null
  const match = codigoTema.match(/^(TC\s+\d+(?:\.\d+)?)/)
  return match ? match[1].trim() : codigoTema
}
