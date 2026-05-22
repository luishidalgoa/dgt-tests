/**
 * Escritura ATÓMICA de un archivo JSON (u otro texto).
 *
 * Escribe primero a `<path>.tmp` y solo después renombra a `<path>`.
 * Si el proceso muere durante el writeFileSync (Ctrl+C, OOM, power loss…),
 * el archivo original sigue intacto — el `rename()` es atómico en NTFS y
 * ext4 cuando origen y destino están en el mismo volumen.
 *
 * Por qué importa: el `writeFileSync` directo puede dejar el JSON truncado
 * a 0 bytes si lo matan a medias, y eso rompe TODO el proyecto cuando
 * src/lib/manualIndice.ts importa el archivo al cargar.
 *
 * Uso típico:
 *   writeJsonAtomic(path, JSON.stringify(data, null, 2) + "\n")
 */

import { writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs"

export function writeJsonAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, content, "utf8")
    renameSync(tmp, path)
  } catch (e) {
    // Limpiar el .tmp si quedó tras un fallo, para no dejar basura
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* noop */ }
    throw e
  }
}
