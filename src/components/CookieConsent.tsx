"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Cookie, X, Check, Settings2 } from "lucide-react"

/**
 * Banner GDPR + LSSI-CE de consentimiento de cookies.
 *
 * Solo cookies/storage que usamos:
 *  - `dgt_tests_session` (iron-session): cookie HTTP-only para autenticación.
 *    Estrictamente necesaria, no requiere consentimiento.
 *  - localStorage `dgt:current-exam`: guarda el progreso del examen.
 *    Funcional, requiere consentimiento.
 *  - sessionStorage `dgt:ai-quota-results-*`: sincronizar contador IA entre
 *    paneles dentro del mismo attempt. Funcional, requiere consentimiento.
 *  - localStorage `dgt:cookie-consent`: guarda la propia decisión del banner.
 *
 * El banner se muestra hasta que el usuario elige una opción. La decisión
 * se persiste en localStorage como `{ accepted: "all" | "essential", at }`.
 */

const STORAGE_KEY = "dgt:cookie-consent"
/** Versión actual del banner. Cuando cambies la política, súbela y los usuarios verán el banner otra vez. */
const POLICY_VERSION = "2026-05"

interface ConsentRecord {
  /** "all" = acepta funcional, "essential" = solo session, null = pendiente */
  accepted: "all" | "essential"
  /** Versión de la política aceptada. */
  version:  string
  /** ISO timestamp. */
  at:       string
}

function loadConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ConsentRecord
    if (parsed.version !== POLICY_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

function saveConsent(accepted: "all" | "essential") {
  if (typeof window === "undefined") return
  try {
    const rec: ConsentRecord = { accepted, version: POLICY_VERSION, at: new Date().toISOString() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec))
  } catch {
    // ignore
  }
}

export function CookieConsent() {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setMounted(true)
    const existing = loadConsent()
    setVisible(!existing)
  }, [])

  function acceptAll() {
    saveConsent("all")
    setVisible(false)
  }
  function acceptEssentialOnly() {
    saveConsent("essential")
    setVisible(false)
    // Si el usuario rechaza funcional, limpiamos lo que ya hubiera
    try {
      window.localStorage.removeItem("dgt:current-exam")
      // Las claves de quota IA en sessionStorage se borran solas al cerrar pestaña
    } catch {
      // ignore
    }
  }

  // Evita hydration mismatch
  if (!mounted || !visible) return null

  return (
    <div
      role="dialog"
      aria-label="Aviso de cookies"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 60,
        maxWidth: 720,
        marginInline: "auto",
        borderRadius: 16,
        background: "#fff",
        border: "1.5px solid var(--slate-200)",
        boxShadow: "0 20px 50px -20px rgba(0,0,0,0.30)",
        padding: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            flexShrink: 0,
            width: 42,
            height: 42,
            borderRadius: 12,
            background: "linear-gradient(135deg, var(--orange-400), var(--orange-600))",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Cookie className="h-5 w-5" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: "var(--ink)" }}>
            Usamos cookies y almacenamiento local
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--slate-600)" }}>
            Una cookie de sesión para mantenerte logueado, y almacenamiento local del navegador
            para guardar tu progreso del examen. No usamos cookies de seguimiento ni de
            publicidad.{" "}
            <Link
              href="/privacidad"
              style={{ color: "var(--orange-600)", fontWeight: 700, textDecoration: "underline" }}
            >
              Más información
            </Link>
            .
          </p>

          {expanded && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--slate-100)",
                fontSize: 12,
                color: "var(--slate-600)",
                lineHeight: 1.5,
              }}
            >
              <p style={{ margin: 0, marginBottom: 4 }}>
                <b>Necesarias</b> · cookie de sesión (autenticación).
                Imprescindibles para que la app funcione.
              </p>
              <p style={{ margin: 0 }}>
                <b>Funcionales</b> · localStorage para guardar progreso del examen en curso
                y sessionStorage para sincronizar el contador de IA entre paneles. Si las
                rechazas, podrás usar la app pero perderás el examen al recargar.
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1.5px solid var(--slate-200)",
            background: "#fff",
            color: "var(--slate-600)",
            fontSize: 12.5,
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {expanded ? "Ocultar detalles" : "Personalizar"}
        </button>
        <button
          type="button"
          onClick={acceptEssentialOnly}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: "1.5px solid var(--slate-300)",
            background: "#fff",
            color: "var(--slate-700)",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <X className="h-3.5 w-3.5" />
          Solo necesarias
        </button>
        <button
          type="button"
          onClick={acceptAll}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: 0,
            background: "linear-gradient(135deg, var(--orange-500), var(--red-600))",
            color: "#fff",
            fontSize: 13,
            fontWeight: 800,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 8px 18px -10px rgba(220, 38, 38, 0.55)",
          }}
        >
          <Check className="h-3.5 w-3.5" />
          Aceptar todas
        </button>
      </div>
    </div>
  )
}
