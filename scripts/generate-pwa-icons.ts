/**
 * Rasteriza src/app/icon.svg a los PNGs de la PWA en /public/icons/ +
 * apple-icon.png en src/app/.
 *
 * Por qué un script aparte (vs generate-icons.ts):
 *   - generate-icons.ts apunta a /public/stripe/ con tamaños específicos
 *     para el Dashboard de Stripe.
 *   - Este genera los iconos que consume el manifest PWA + apple-icon
 *     que Next App Router detecta automáticamente.
 *
 * El SVG es la única fuente de verdad. Para cambiar el diseño del icono,
 * edita SOLO src/app/icon.svg + re-ejecuta:
 *
 *   npx tsx scripts/generate-pwa-icons.ts
 *
 * Sharp rasteriza con `density` proporcional al tamaño destino para
 * evitar el antialias borroso típico al hacer downscale desde un SVG de
 * baja densidad.
 */
import sharp from "sharp"
import { readFileSync, existsSync, copyFileSync } from "node:fs"
import { resolve } from "node:path"

async function main() {
  const root  = process.cwd()
  const svgIn = resolve(root, "src/app/icon.svg")
  if (!existsSync(svgIn)) {
    console.error(`✗ No encuentro ${svgIn}`)
    process.exit(1)
  }

  const svgBuf = readFileSync(svgIn)

  // Asegurar copia en public/ para que el manifest pueda servir /icon.svg
  copyFileSync(svgIn, resolve(root, "public/icon.svg"))
  console.log("✓ public/icon.svg sincronizado con src/app/icon.svg")

  // ── PWA icons (varios tamaños para que cada SO escoja el adecuado) ──
  const pwaVariants: { name: string; size: number; desc: string }[] = [
    { name: "icon-2048.png", size: 2048, desc: "Hi-DPI / displays 4K (Android premium)" },
    { name: "icon-1024.png", size: 1024, desc: "Retina iOS / Android grande" },
    { name: "icon-512.png",  size:  512, desc: "PWA installable (Chrome lo exige)" },
    { name: "icon-256.png",  size:  256, desc: "Thumbnails / home grid pequeño" },
  ]
  for (const v of pwaVariants) {
    const out = resolve(root, "public/icons", v.name)
    // density en sharp es DPI. Para un SVG con viewBox 1024 el render
    // size = viewBox * (density / 72). Queremos 2× oversampling antes
    // de resize() para nitidez, con cap a 1024 DPI para no superar el
    // pixel limit de sharp (268M).
    const density = Math.min(Math.ceil((v.size * 2 * 72) / 1024), 1024)
    await sharp(svgBuf, { density })
      .resize(v.size, v.size, { kernel: "lanczos3" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(out)
    console.log(`✓ public/icons/${v.name.padEnd(16)} (${v.size}×${v.size}) — ${v.desc}`)
  }

  // ── Apple touch icon (Next App Router lo detecta como src/app/apple-icon.png) ──
  // Apple recomienda 180×180 — los iPhones modernos usan 180 como home
  // grid icon. Más grande lo downsamplean ellos mismos (peor calidad);
  // exactamente 180 da la nitidez máxima.
  const appleOut = resolve(root, "src/app/apple-icon.png")
  await sharp(svgBuf, { density: 720 })   // 4× para nitidez antes de resize
    .resize(180, 180)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(appleOut)
  console.log(`✓ src/app/apple-icon.png    (180×180) — Apple touch icon (auto-detected by Next)`)

  console.log("\n→ Iconos PWA regenerados desde src/app/icon.svg. Commit + redeploy y el manifest los servirá.")
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
