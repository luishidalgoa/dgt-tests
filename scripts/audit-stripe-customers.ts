/**
 * Audita los customers de Stripe contra la BBDD para detectar:
 *
 *  1. DUPLICADOS: varios customers en Stripe con el mismo
 *     metadata.appUserId. Suele ser el origen de orphans (ej.: un bug
 *     temprano que recreaba customer en cada checkout).
 *
 *  2. ORPHANS: customers en Stripe que NO coinciden con
 *     user.stripeCustomerId (cuando hay duplicados, el "no elegido" es
 *     orphan). Si tienen subscriptions activas son los peligrosos —
 *     siguen cobrando sin que la app lo sepa.
 *
 *  3. STALE DB: user.stripeCustomerId que no existe en Stripe.
 *
 *  4. UNTRACKED: customers en Stripe SIN metadata.appUserId — fully
 *     orphan, ni siquiera sabemos a qué user pertenecen. Suelen ser de
 *     versiones tempranas del código o creados a mano desde el dashboard.
 *
 * Estrategia: combinamos dos enfoques:
 *  - search por metadata.appUserId (para casos 1, 2, 3)
 *  - list completo de customers (para caso 4)
 *
 *   # auditar usando claves del .env activo (LIVE típicamente)
 *   npm run stripe:audit
 *
 *   # auditar TEST (lee .env.local con priority)
 *   npx tsx --env-file=.env --env-file-if-exists=.env.local scripts/audit-stripe-customers.ts
 *
 * Por defecto NO hace cambios. Para CANCELAR las subs activas de los
 * orphans, pasa --cancel-orphan-subs.
 */
import Stripe from "stripe"
import { db } from "@/lib/db"

const CANCEL_ORPHAN_SUBS = process.argv.includes("--cancel-orphan-subs")

type DbUser = {
  id:               number
  username:         string
  email:            string | null
  stripeCustomerId: string | null
}

async function main() {
  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    console.error("✗ STRIPE_SECRET_KEY no definida")
    process.exit(1)
  }
  const isLive = apiKey.startsWith("sk_live_")
  console.log(`🔑 Modo Stripe: ${isLive ? "🔴 LIVE" : "🟢 TEST"}`)
  console.log(CANCEL_ORPHAN_SUBS ? "🚧 --cancel-orphan-subs activado" : "🔍 Solo auditoría (sin cambios)")
  console.log()

  const stripe = new Stripe(apiKey)

  // ── 1. Cargar todos los users ────────────────────────────────────────
  const users: DbUser[] = await db.user.findMany({
    select: { id: true, username: true, email: true, stripeCustomerId: true },
  })
  const usersWithStripe = users.filter((u) => u.stripeCustomerId !== null)
  console.log(`📦 Users en BBDD: ${users.length}, con stripeCustomerId: ${usersWithStripe.length}`)
  console.log()

  // ── 2. Para cada user, buscar TODOS sus customers en Stripe ─────────
  const duplicados: { user: DbUser; customers: Stripe.Customer[] }[] = []
  const orphans:    { user: DbUser | null; customer: Stripe.Customer }[] = []
  const staleDb:    { user: DbUser }[] = []

  for (const user of users) {
    let customers: Stripe.Customer[] = []
    try {
      const search = await stripe.customers.search({
        query: `metadata['appUserId']:'${user.id}'`,
        limit: 100,
      })
      customers = search.data
    } catch (err) {
      console.warn(`⚠ search falló para user #${user.id}: ${err instanceof Error ? err.message : err}`)
      continue
    }

    if (customers.length > 1) {
      duplicados.push({ user, customers })
    }

    // Orphans: los que NO son el referenciado por DB
    for (const c of customers) {
      if (user.stripeCustomerId !== c.id) {
        orphans.push({ user, customer: c })
      }
    }

    // Stale DB: el DB tiene un id que no aparece en los resultados
    if (user.stripeCustomerId && !customers.some((c) => c.id === user.stripeCustomerId)) {
      // Confirmamos haciendo retrieve directo
      try {
        const direct = await stripe.customers.retrieve(user.stripeCustomerId)
        if ((direct as Stripe.Customer).metadata?.appUserId !== String(user.id)) {
          // Existe pero su metadata no coincide — extraño pero no nulo
          console.warn(`⚠ user #${user.id}.stripeCustomerId='${user.stripeCustomerId}' existe en Stripe pero su metadata.appUserId='${(direct as Stripe.Customer).metadata?.appUserId ?? "—"}'`)
        }
      } catch {
        staleDb.push({ user })
      }
    }
  }

  // ── 3. UNTRACKED: customers en Stripe SIN metadata.appUserId ────────
  // No hay forma de buscarlos por search query, hay que listar y filtrar.
  console.log("→ Listando customers para detectar untracked (sin metadata.appUserId)...")
  const untracked: Stripe.Customer[] = []
  const dbCustomerIds = new Set(
    usersWithStripe.map((u) => u.stripeCustomerId).filter((x): x is string => Boolean(x))
  )
  let starting_after: string | undefined
  let totalListed = 0
  do {
    const page: Stripe.ApiList<Stripe.Customer> = await stripe.customers.list({
      limit: 100,
      ...(starting_after ? { starting_after } : {}),
    })
    totalListed += page.data.length
    for (const c of page.data) {
      const hasAppUserId = Boolean(c.metadata?.appUserId)
      const referencedByDb = dbCustomerIds.has(c.id)
      if (!hasAppUserId && !referencedByDb) {
        untracked.push(c)
      }
    }
    starting_after = page.has_more ? page.data[page.data.length - 1].id : undefined
  } while (starting_after)
  console.log(`   ${totalListed} customers totales en Stripe, ${untracked.length} untracked`)
  console.log()

  // ── 4. Reporte ───────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════")
  console.log(" RESUMEN")
  console.log("═══════════════════════════════════════════════════════════")
  console.log(`Duplicados (varios customers por appUserId): ${duplicados.length}`)
  console.log(`Orphans    (customer Stripe que la BBDD no apunta): ${orphans.length}`)
  console.log(`Stale DB   (BBDD apunta a customer inexistente): ${staleDb.length}`)
  console.log(`Untracked  (customer Stripe sin metadata.appUserId): ${untracked.length}`)
  console.log()

  if (duplicados.length > 0) {
    console.log("⚠ DUPLICADOS:")
    for (const d of duplicados) {
      console.log(`   user #${d.user.id} (${d.user.username}) tiene ${d.customers.length} customers en Stripe:`)
      for (const c of d.customers) {
        const isDbOne = d.user.stripeCustomerId === c.id
        console.log(`     ${isDbOne ? "→" : " "} ${c.id} (email=${c.email ?? "—"}, name=${c.name ?? "—"}, created=${new Date(c.created * 1000).toISOString().slice(0, 10)})${isDbOne ? " ← BBDD" : ""}`)
      }
    }
    console.log()
  }

  if (orphans.length > 0) {
    console.log("⚠ ORPHANS (customers en Stripe que la BBDD NO referencia):")
    for (const o of orphans) {
      const c = o.customer
      const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 5 })
      const activeSubs = subs.data.filter((s) => s.status === "active" || s.status === "trialing")
      console.log(`   ${c.id}`)
      console.log(`     email:      ${c.email ?? "—"}`)
      console.log(`     name:       ${c.name ?? "—"}`)
      console.log(`     created:    ${new Date(c.created * 1000).toISOString().slice(0, 10)}`)
      console.log(`     appUserId:  ${c.metadata?.appUserId} (user DB: ${o.user ? `#${o.user.id} ${o.user.username}` : "✗ no existe"})`)
      console.log(`     subs:       ${subs.data.length} total / ${activeSubs.length} ACTIVAS ${activeSubs.length > 0 ? "🚨" : ""}`)
      for (const s of subs.data) {
        console.log(`        - ${s.id} · status=${s.status}`)
      }

      if (CANCEL_ORPHAN_SUBS && activeSubs.length > 0) {
        for (const s of activeSubs) {
          console.log(`     ⏳ Cancelando ${s.id}...`)
          await stripe.subscriptions.cancel(s.id)
          console.log(`     ✓ Cancelada`)
        }
      }
    }
    console.log()
  }

  if (staleDb.length > 0) {
    console.log("⚠ STALE DB (BBDD apunta a customer que no existe en Stripe):")
    for (const s of staleDb) {
      console.log(`   user #${s.user.id} (${s.user.username}) → stripeCustomerId='${s.user.stripeCustomerId}'`)
    }
    console.log("   → considera limpiarlo a mano con sql o lanzar npm run stripe:sync-user <username>")
    console.log()
  }

  if (untracked.length > 0) {
    console.log("⚠ UNTRACKED (customers SIN metadata.appUserId — origen desconocido):")
    for (const c of untracked) {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 5 })
      const activeSubs = subs.data.filter((s) => s.status === "active" || s.status === "trialing")
      console.log(`   ${c.id}`)
      console.log(`     email:   ${c.email ?? "—"}`)
      console.log(`     name:    ${c.name ?? "—"}`)
      console.log(`     created: ${new Date(c.created * 1000).toISOString().slice(0, 10)}`)
      console.log(`     subs:    ${subs.data.length} total / ${activeSubs.length} ACTIVAS ${activeSubs.length > 0 ? "🚨" : ""}`)
      for (const s of subs.data) {
        console.log(`        - ${s.id} · status=${s.status}`)
      }

      if (CANCEL_ORPHAN_SUBS && activeSubs.length > 0) {
        for (const s of activeSubs) {
          console.log(`     ⏳ Cancelando ${s.id}...`)
          await stripe.subscriptions.cancel(s.id)
          console.log(`     ✓ Cancelada`)
        }
      }
    }
    console.log()
  }

  const allClean = duplicados.length === 0 && orphans.length === 0 && staleDb.length === 0 && untracked.length === 0
  if (allClean) {
    console.log("✓ Todo limpio — no hay duplicados, orphans, stale DB ni untracked.")
  } else if (!CANCEL_ORPHAN_SUBS && (orphans.length > 0 || untracked.length > 0)) {
    console.log("ℹ Para cancelar las subs activas de orphans/untracked:")
    console.log("    npm run stripe:audit -- --cancel-orphan-subs")
    console.log("  (esto NO borra los customers — eso es manual desde el dashboard de Stripe).")
  }
}

main()
  .catch((e) => {
    console.error("❌", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
