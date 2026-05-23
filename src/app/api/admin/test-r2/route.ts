import { NextResponse } from "next/server"
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { requireAdmin } from "@/lib/adminGuard"
import { getEffectiveSecret } from "@/lib/secretCatalog"

/**
 * POST /api/admin/test-r2
 *
 * Health check del bucket Cloudflare R2 configurado en /admin/secrets:
 *   1. HeadBucket  → verifica endpoint + creds + que el bucket exista
 *   2. ListObjectsV2 (MaxKeys=1) → confirma scope Object:Read y devuelve
 *      una key real para el siguiente paso
 *   3. fetch HEAD a `${NEXT_PUBLIC_IMAGE_CDN_URL}/<firstKey>` →
 *      verifica que el bucket está sirviendo como CDN público
 *
 * No escribe nada en el bucket (no side effects). El test usa las creds
 * leyendo getEffectiveSecret(), o sea DB-override primero y env var
 * después, exactamente igual que lo hará el runtime real.
 *
 * Restricción: solo admin (requireAdmin via notFound 404 si no lo es).
 */

type TestSuccess = {
  ok:                  true
  latencyMs:           number
  bucket:              string
  endpoint:            string
  objectCount:         number | "unknown"
  publicUrlReachable:  boolean | null
}
type TestFailure = { ok: false; error: string }

export async function POST(): Promise<NextResponse<TestSuccess | TestFailure>> {
  await requireAdmin()

  const [endpoint, bucket, accessKeyId, secretAccessKey, publicUrl] = await Promise.all([
    getEffectiveSecret("R2_ENDPOINT"),
    getEffectiveSecret("R2_BUCKET_NAME"),
    getEffectiveSecret("R2_ACCESS_KEY_ID"),
    getEffectiveSecret("R2_SECRET_ACCESS_KEY"),
    getEffectiveSecret("NEXT_PUBLIC_IMAGE_CDN_URL"),
  ])

  const missing: string[] = []
  if (!endpoint)        missing.push("R2_ENDPOINT")
  if (!bucket)          missing.push("R2_BUCKET_NAME")
  if (!accessKeyId)     missing.push("R2_ACCESS_KEY_ID")
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY")
  if (missing.length > 0) {
    return NextResponse.json({
      ok:    false,
      error: `Faltan vars: ${missing.join(", ")}`,
    })
  }

  const s3 = new S3Client({
    region:      "auto",
    endpoint:    endpoint!,
    credentials: {
      accessKeyId:     accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  })

  const startTs = Date.now()
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket! }))

    // ListObjects es opcional — si las creds no tienen Object:Read
    // (raro), no rompemos el test entero, solo dejamos objectCount=unknown.
    let objectCount: number | "unknown" = "unknown"
    let firstKey:    string | null      = null
    try {
      const list = await s3.send(new ListObjectsV2Command({
        Bucket:  bucket!,
        MaxKeys: 1,
      }))
      objectCount = list.KeyCount ?? 0
      firstKey    = list.Contents?.[0]?.Key ?? null
    } catch { /* swallow */ }

    // Verificación adicional: si tenemos URL pública + al menos 1 objeto,
    // hacemos HEAD para confirmar que el bucket está sirviendo como CDN
    // (a veces el toggle "public dev URL" no propaga inmediatamente).
    let publicUrlReachable: boolean | null = null
    if (publicUrl && firstKey) {
      try {
        const res = await fetch(`${publicUrl.replace(/\/$/, "")}/${firstKey}`, { method: "HEAD" })
        publicUrlReachable = res.ok
      } catch {
        publicUrlReachable = false
      }
    }

    return NextResponse.json({
      ok:        true,
      latencyMs: Date.now() - startTs,
      bucket:    bucket!,
      endpoint:  endpoint!,
      objectCount,
      publicUrlReachable,
    })
  } catch (err) {
    // Errores típicos de AWS SDK: NoSuchBucket, InvalidAccessKeyId,
    // SignatureDoesNotMatch, NetworkingError. Devolvemos el mensaje
    // tal cual (es lo más útil para debugging).
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg })
  }
}
