"use client"

import { WelcomeModal } from "@/components/WelcomeModal"

interface Props {
  /** Id de la primera notificación pendiente para este usuario, o null. */
  pendingId: string | null
  /** displayName del usuario, para personalizar saludos. */
  username:  string
}

/**
 * Router muy ligero que decide qué modal mostrar en función del id de la
 * notificación pendiente. Al añadir una nueva notificación en
 * src/lib/notifications.ts, añade aquí el case y el componente.
 */
export function UserNotifications({ pendingId, username }: Props) {
  if (!pendingId) return null

  switch (pendingId) {
    case "welcome-v1":
      return <WelcomeModal notificationId="welcome-v1" username={username} />
    // case "terms-update-2026-q2":
    //   return <TermsUpdateModal notificationId="terms-update-2026-q2" />
    default:
      return null
  }
}
