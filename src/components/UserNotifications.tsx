"use client"

import { useEffect, useState } from "react"
import { WelcomeModal } from "@/components/WelcomeModal"
import { UserUpdateModal } from "@/components/UserUpdateModal"
import { isLocallyAcked } from "@/lib/client-acks"

interface Props {
  /** Id de la primera notificación pendiente para este usuario, o null. */
  pendingId: string | null
  /** displayName del usuario, para personalizar saludos. */
  username:  string
}

/**
 * Router muy ligero que decide qué modal mostrar en función del id de la
 * notificación pendiente. Filtra también contra localStorage para evitar
 * re-mostrar una notificación si el server-side ack no se persistió por
 * cualquier razón.
 *
 * Para añadir una nueva notificación:
 *   1. src/lib/notifications.ts → entry en NOTIFICATIONS
 *   2. Aquí abajo → case con el componente del modal
 */
export function UserNotifications({ pendingId, username }: Props) {
  const [skipLocal, setSkipLocal] = useState<boolean | null>(null)

  // Hidratamos el flag de localStorage del lado cliente
  useEffect(() => {
    if (!pendingId) {
      setSkipLocal(null)
      return
    }
    setSkipLocal(isLocallyAcked(pendingId))
  }, [pendingId])

  if (!pendingId) return null
  // Mientras no sabemos si está en local (primer render SSR), no pintamos
  // nada: evita un parpadeo del modal si está acked en local pero el server
  // todavía no lo sabe.
  if (skipLocal === null) return null
  if (skipLocal) return null

  switch (pendingId) {
    case "welcome-v1":
      return <WelcomeModal notificationId="welcome-v1" username={username} />
    case "user-update-may26":
      return <UserUpdateModal notificationId="user-update-may26" />
    default:
      return null
  }
}
