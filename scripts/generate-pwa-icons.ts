/**
 * Rasteriza public/icons/icon.png (fuente 1024×1024) a los diferentes
 * tamaños PWA + apple-icon + favicon.
 *
 * Por qué un PNG como fuente y no un SVG:
 *   - El logo lo generó ChatGPT/DALL-E como PNG. Mantenemos la fuente
 *     original sin vectorizar para no perder calidad ni cambiar el diseño.
 *   - Sharp con `kernel: lanczos3` hace downscale de alta calidad para
 *     los tamaños pequeños (256, 512). Para subir (2048) usa el bicubic
 *     por defecto, suficiente porque el detalle del logo ya está en el
 *     1024 original.
 *
 * Cuándo re-ejecutar este script:
 *   - Cuando ChatGPT genere una nueva versión del logo y la sustituyas
 *     en public/icons/icon.png. Después corre:
 *
 *       npx tsx scripts/generate-pwa-icons.ts
 *
 *   - El script regenera TODOS los PNGs derivados + apple-icon + favicon
 *     manteniendo el icono fuente intacto.
 */
import sharp from "sharp"
import { existsSync, unlinkSync } from "node:fs"
import { resolve } from "node:path"

async function main() {
  const root  = process.cwd()
  const src   = resolve(root, "public/icons/icon.png")
  if (!existsSync(src)) {
    console.error(`✗ No encuentro ${src}`)
    console.error(`  Pon el PNG fuente (1024×1024) aquí y vuelve a ejecutar.`)
    process.exit(1)
  }

  // Si quedaba el icon.svg del intento anterior con SVG, lo borramos —
  // ahora la fuente única es public/icons/icon.png.
  for (const stale of [
    resolve(root, "src/app/icon.svg"),
    resolve(root, "public/icon.svg"),
  ]) {
    if (existsSync(stale)) {
      unlinkSync(stale)
      console.log(`✗ Borrado ${stale} (legacy SVG, ahora la fuente es PNG)`)
    }
  }

  // ── PWA icons (manifest los referencia) ─────────────────────────────
  const pwaVariants: { name: string; size: number; desc: string }[] = [
    { name: "icon-2048.png", size: 2048, desc: "Hi-DPI / displays 4K" },
    { name: "icon-1024.png", size: 1024, desc: "Retina iOS / Android grande" },
    { name: "icon-512.png",  size:  512, desc: "PWA installable (Chrome lo exige)" },
    { name: "icon-256.png",  size:  256, desc: "Thumbnails / home grid pequeño" },
  ]
  for (const v of pwaVariants) {
    const out = resolve(root, "public/icons", v.name)
    await sharp(src)
      .resize(v.size, v.size, { kernel: "lanczos3", fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(out)
    console.log(`✓ public/icons/${v.name.padEnd(16)} (${v.size}×${v.size}) — ${v.desc}`)
  }

  // ── Apple touch icon (Next App Router lo detecta en src/app/) ──────
  // 180×180 es lo que Apple usa en iOS home; si das más grande iOS lo
  // downsamplea y queda menos nítido. 180 exacto = óptimo.
  const appleOut = resolve(root, "src/app/apple-icon.png")
  await sharp(src)
    .resize(180, 180, { kernel: "lanczos3" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(appleOut)
  console.log(`✓ src/app/apple-icon.png    (180×180) — Apple touch icon (auto-detected by Next)`)

  // ── Favicon (Next App Router: src/app/icon.png lo detecta como favicon) ──
  // No vamos a usar el SVG porque ahora la fuente es PNG. Generamos un
  // favicon 64×64 — tamaño estándar para tabs de navegador.
  const faviconOut = resolve(root, "src/app/icon.png")
  await sharp(src)
    .resize(64, 64, { kernel: "lanczos3" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(faviconOut)
  console.log(`✓ src/app/icon.png          ( 64×64 )  — Favicon (auto-detected by Next)`)

  console.log("\n→ Iconos PWA + favicon regenerados desde public/icons/icon.png.")
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
