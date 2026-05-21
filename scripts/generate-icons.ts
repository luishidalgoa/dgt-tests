/**
 * Rasteriza src/app/icon.svg → icon.png (512x512) y apple-icon.png (180x180).
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * Después de ejecutarlo, BORRA los .svg para evitar que Next.js sirva ambos:
 *   - src/app/icon.svg
 *   - src/app/apple-icon.svg
 */
import sharp from "sharp"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

async function main() {
  const root  = process.cwd()
  const svgIn = resolve(root, "src/app/icon.svg")
  if (!existsSync(svgIn)) {
    console.error(`✗ No encuentro ${svgIn}`)
    process.exit(1)
  }

  const svgBuf = readFileSync(svgIn)

  // 1. icon.png — favicon principal (512x512 para que se vea nítido en cualquier sitio)
  const iconOut = resolve(root, "src/app/icon.png")
  await sharp(svgBuf, { density: 512 })
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(iconOut)
  console.log(`✓ ${iconOut} (512x512)`)

  // 2. apple-icon.png — para iOS al añadir a pantalla de inicio (180x180 es lo estándar)
  const appleOut = resolve(root, "src/app/apple-icon.png")
  await sharp(svgBuf, { density: 512 })
    .resize(180, 180)
    .png({ compressionLevel: 9 })
    .toFile(appleOut)
  console.log(`✓ ${appleOut} (180x180)`)

  // 3. Opcional: favicon clásico 32x32 (algunos navegadores lo prefieren pequeño)
  const favOut = resolve(root, "public/favicon.png")
  await sharp(svgBuf, { density: 256 })
    .resize(32, 32)
    .png({ compressionLevel: 9 })
    .toFile(favOut)
  console.log(`✓ ${favOut} (32x32)`)

  console.log("\nRecuerda: ahora borra los SVG para que Next sirva los PNG:")
  console.log("  rm src/app/icon.svg")
  console.log("  rm src/app/apple-icon.svg")
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
