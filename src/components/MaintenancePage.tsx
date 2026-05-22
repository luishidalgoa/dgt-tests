/**
 * Pantalla "volvemos en breve" que se muestra cuando MAINTENANCE_MODE
 * está activo en AppConfig. Solo la ven los users que no son ADMIN —
 * el admin ve la app normal para poder hacer la migración / lo que sea.
 */
export function MaintenancePage() {
  return (
    <div style={{
      minHeight: "calc(100vh - 100px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div className="card-soft" style={{ padding: 36, maxWidth: 480, textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 12 }} aria-hidden="true">🛠️</div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
          Volvemos en breve
        </h1>
        <p style={{ marginTop: 14, fontSize: 14.5, color: "var(--slate-500)", lineHeight: 1.55 }}>
          Estamos haciendo unas mejoras en la plataforma. La aplicación estará
          disponible de nuevo en unos minutos. Gracias por tu paciencia.
        </p>
        <p style={{ marginTop: 20, fontSize: 12, color: "var(--slate-400)" }}>
          DGT Tests · modo mantenimiento
        </p>
      </div>
    </div>
  )
}
