/**
 * Rasteriza src/app/icon.svg a varios PNG en public/stripe/ para usar
 * como logo de producto, business logo, etc. en el Dashboard de Stripe.
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * Stripe acepta JPG/PNG square, máx 5MB. La recomendación oficial:
 *   - Logo de producto:  1024x1024 PNG con fondo transparente o color
 *   - Branding logo:     128x128 PNG (mínimo) — Dashboard → Settings → Branding
 *   - Icon (Checkout):   256x256 PNG cuadrado
 *
 * El SVG en src/app/icon.svg sigue siendo el favicon real de la app
 * (Next.js lo sirve automáticamente). Estos PNG son SOLO para subirlos
 * manualmente al Dashboard de Stripe.
 */
import sharp from "sharp"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

async function main() {
  const root  = process.cwd()
  const svgIn = resolve(root, "src/app/icon.svg")
  if (!existsSync(svgIn)) {
    console.error(`✗ No encuentro ${svgIn}`)
    process.exit(1)
  }

  const svgBuf = readFileSync(svgIn)
  const outDir = resolve(root, "public/stripe")

  const variants: { name: string; size: number; desc: string }[] = [
    { name: "logo-1024.png", size: 1024, desc: "Producto en Stripe Checkout / Dashboard" },
    { name: "logo-512.png",  size:  512, desc: "General / redes sociales" },
    { name: "logo-256.png",  size:  256, desc: "Icon en Stripe Checkout" },
    { name: "logo-128.png",  size:  128, desc: "Branding logo en Stripe Dashboard (mínimo)" },
  ]

  for (const v of variants) {
    const out = resolve(outDir, v.name)
    await sharp(svgBuf, { density: Math.max(256, v.size) })
      .resize(v.size, v.size)
      .png({ compressionLevel: 9 })
      .toFile(out)
    console.log(`✓ public/stripe/${v.name} (${v.size}×${v.size}) — ${v.desc}`)
  }

  console.log("\n→ Usa public/stripe/logo-1024.png al crear el producto")
  console.log("  en https://dashboard.stripe.com/products → Add product → Image")
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
