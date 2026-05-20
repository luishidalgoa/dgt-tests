# Deploy a Vercel + Turso

Guía paso a paso para publicar **DGT Tests** en Vercel usando Turso como BBDD libSQL.

---

## 1. Cuenta y BBDD en Turso

### 1.1. Instalar la CLI

PowerShell:

```powershell
irm get.tur.so/install.ps1 | iex
```

macOS / Linux:

```bash
curl -sSfL https://get.tur.so/install.sh | bash
```

### 1.2. Login y crear la BBDD

```bash
turso auth signup           # o `turso auth login` si ya tienes cuenta
turso db create dgt-tests   # crea la BBDD (puede tardar unos segundos)
```

### 1.3. Obtener URL y token

```bash
turso db show dgt-tests --url
# → libsql://dgt-tests-tuusuario.turso.io

turso db tokens create dgt-tests
# → ey... (un JWT largo)
```

Guarda los dos valores.

---

## 2. Configurar variables localmente

Añade al `.env` (queda **fuera** de git por el `.gitignore`):

```env
# Para Prisma CLI (migrate, etc.) sigue usando el SQLite local
DATABASE_URL="file:./dev.db"

# Para la app y los scripts (libSQL → Turso)
TURSO_DATABASE_URL="libsql://dgt-tests-tuusuario.turso.io"
TURSO_AUTH_TOKEN="ey......."
```

> El runtime usa `TURSO_DATABASE_URL` si existe. Si no, cae a la BBDD SQLite
> local. Así puedes seguir desarrollando offline cuando quieras.

---

## 3. Crear el schema en Turso

```bash
npm run db:push      # aplica schema.prisma a TURSO_DATABASE_URL
```

Esto crea las tablas en la BBDD remota.

---

## 4. Poblar la BBDD remota

Con las variables del `.env` cargadas (los scripts las leen vía `tsx`):

```bash
npm run db:seed            # importa los JSONs de los bancos
npm run manual:import      # importa el manual y copia los PDFs a public/
```

Verifica:

```bash
npx tsx scripts/sanity-check.ts
# Categorías: 3, Tests: 104, Preguntas: 2676, Opciones: 8023, etc.
```

---

## 5. Configurar Vercel

### 5.1. Subir el repo a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:tuusuario/dgt-tests.git
git push -u origin main
```

### 5.2. Importar en Vercel

1. Ve a [vercel.com/new](https://vercel.com/new)
2. Conecta tu cuenta de GitHub e importa el repo
3. Framework preset: **Next.js** (auto-detectado)
4. **NO toques** el build command — el `package.json` ya tiene `prisma generate && next build`

### 5.3. Variables de entorno en Vercel

En el dashboard del proyecto → **Settings → Environment Variables**:

| Key                  | Value                                  | Entornos |
|----------------------|----------------------------------------|----------|
| `TURSO_DATABASE_URL` | `libsql://dgt-tests-tuusuario.turso.io`| Production, Preview, Development |
| `TURSO_AUTH_TOKEN`   | el JWT que copiaste                    | Production, Preview, Development |

> No hace falta `DATABASE_URL` en Vercel — sólo `TURSO_*`.

### 5.4. Deploy

Pulsa **Deploy**. El build:

1. `postinstall` → `prisma generate` (genera el cliente)
2. `npm run build` → `prisma generate && next build`
3. Sirve la app

---

## 6. Verificar

Abre la URL `.vercel.app` que te dé Vercel. Deberías ver:

- Dashboard con las 3 categorías
- Stats: 0 intentos, 0 errores pendientes
- Al hacer un test y finalizarlo → se guarda en Turso (visible en Historial)

---

## 7. Tamaño del repo y deployment

Los PDFs en `public/manual/pdfs/` suman ~50-80 MB. Vercel los sirve como
estáticos sin problema (el límite del Hobby tier es 100 MB por archivo,
ningún PDF se acerca a eso).

Si quieres mantener el repo de git ligero, considera usar **Git LFS** para
los PDFs grandes.

---

## 8. Solución de problemas

### "Cannot find module '@prisma/client'"
Verifica que el `postinstall` ejecutó `prisma generate`. En Vercel
dashboard → **Deployments → último deploy → Logs**, busca la línea
`✔ Generated Prisma Client`.

### "TURSO_DATABASE_URL is undefined"
Las variables de entorno se cargan en el momento del **build**, no en
runtime. Si las añades después, redeploy.

### "Failed to fetch PDF" en el visor del manual
Asegúrate de que `public/manual/pdfs/` se subió al repo. Comprueba con:
```bash
git ls-files public/manual/pdfs | wc -l
# debería dar ~32
```

### Quiero usar la BBDD de Turso también en dev local
Solo tienes que tener `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` definidos
en `.env`. El runtime los usará automáticamente. Quítalos del `.env` para
volver al SQLite local.

---

## 9. Comandos útiles después del deploy

```bash
# Ver tablas y conteo
turso db shell dgt-tests
> .tables
> SELECT COUNT(*) FROM questions;

# Backup
turso db shell dgt-tests .dump > backup.sql

# Restaurar
turso db shell dgt-tests < backup.sql
```
