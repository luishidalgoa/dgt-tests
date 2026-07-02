import * as Sentry from "@sentry/nextjs"
import { NextRequest, NextResponse } from "next/server"
import { shouldNotifyOnce } from "@/lib/sentryThrottle"

/**
 * Catch-all de `/api/*` para 404 de rutas inexistentes.
 *
 * Estrategia: solo reporta a Sentry los 404 que tienen alta probabilidad
 * de venir de la PROPIA app (UI haciendo fetch mal hecho tras refactor,
 * link interno que apunta a endpoint movido, etc.). Descarta lo que es
 * ruido externo (bots, scanners, scrapers).
 *
 * Orden de descarte (la primera que matchee → skip Sentry, devolver 404):
 *   1. User-Agent claramente bot/crawler/spider/scraper
 *   2. Path típico de scan (wp-admin, .env, .git, phpmyadmin, etc.) —
 *      son ataques automatizados, no nuestro frontend
 *   3. Referrer presente pero NO de nuestro dominio — viene de fuera
 *   4. Sin referrer + UA no parece browser real — probablemente bot
 *
 * Si supera todos los filtros, capturamos con `level: "warning"` y
 * un throttle in-memory para no saturar Sentry si una pantalla rota
 * dispara el mismo 404 cientos de veces (sentryThrottle.ts).
 *
 * Importante: como Next App Router prioriza rutas estáticas/explícitas
 * sobre dinámicas, solo cae aquí lo que NINGÚN handler real captura.
 */

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.hdglabs.com").replace(/\/$/, "")

const BOT_UA_PATTERN = /(bot|crawler|spider|scraper|wget|curl|httrack|masscan|nikto|nmap|sqlmap|nuclei|gobuster)/i
const BROWSER_UA_PATTERN = /(mozilla|chrome|safari|firefox|edge|opera)/i

/**
 * Paths típicos de scanners y reconnaissance. NO los reportamos: son
 * fuzzing automatizado y no nuestro frontend.
 */
const HONEYPOT_PATTERNS = [
  /\/wp-/i,                      // WordPress login/admin
  /\/wordpress/i,
  /\.env\b/i,                    // archivos config expuestos
  /\.git(\/|$)/i,
  /\.svn(\/|$)/i,
  /phpmyadmin/i,
  /xmlrpc/i,
  /\.well-known\/.*\.(php|asp)/i,
  /vendor\/.*\.(php|asp|html)/i,
  /backup/i,
  /\.bak$/i,
  /\.sql$/i,
  /admin\.(php|asp|aspx)/i,
  /config\.(php|json|yml|yaml)/i,
  /cgi-bin/i,
  /\/api\/(v1|v2|v3)\/[a-z]+(login|auth|users)/i,  // intentos de APIs estándar
]

function shouldCapture(req: NextRequest): boolean {
  const ua      = (req.headers.get("user-agent") ?? "").toLowerCase()
  const referer = req.headers.get("referer") ?? ""
  const path    = req.nextUrl.pathname

  // 1. UA bot → skip
  if (BOT_UA_PATTERN.test(ua)) return false

  // 2. Path honeypot/scan típico → skip
  if (HONEYPOT_PATTERNS.some((p) => p.test(path))) return false

  // 3. Referrer de fuera de nuestro dominio → skip (no es nuestra UI)
  if (referer && !referer.startsWith(APP_URL)) return false

  // 4. Sin referrer + UA no es browser conocido → probablemente bot
  //    silencioso. Sí dejamos pasar UA browser sin referrer (direct hit
  //    de un user tecleando una URL).
  if (!referer && !BROWSER_UA_PATTERN.test(ua)) return false

  return true
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.pathname

  if (shouldCapture(req)) {
    // Throttle: si el mismo path se reporta más de 1 vez cada 10 min,
    // ignoramos para no saturar (puede ser un bug que dispara el
    // mismo 404 muchas veces seguidas — con uno basta para enterarse).
    const key = `api-404:${req.method}:${path}`
    if (shouldNotifyOnce(key, 10 * 60 * 1000)) {
      Sentry.captureMessage(
        `API 404: ${req.method} ${path}`,
        {
          level: "warning",
          tags: {
            api_method: req.method,
            api_path:   path,
          },
          extra: {
            referer:    req.headers.get("referer") ?? "(none)",
            userAgent:  req.headers.get("user-agent") ?? "(none)",
          },
        },
      )
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 })
}

export const GET    = handler
export const POST   = handler
export const PUT    = handler
export const PATCH  = handler
export const DELETE = handler
export const HEAD   = handler
