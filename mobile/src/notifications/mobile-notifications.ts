import { requestNotificationCatchup } from './push-dismissal-reconciliation'
import { dismissHostPushNotification } from './push-socket-dismissal'
import type { DismissNotificationEvent } from './desktop-notification-events'
import type { MobileNotificationEvent } from '../../../src/main/runtime/runtime-mobile-notification-controller'
import type { RpcClient } from '../transport/rpc-client'
import * as Notifications from 'expo-notifications'
import { hasConfirmedPushRegistration } from './push-registration'
import { deriveHostFingerprint } from './push-host-fingerprint'
import { loadHostCatalog } from '../transport/host-store'
import { foregroundNotificationBehavior } from './push-receive'

export {
  ensureNotificationPermissions,
  getNotificationPermissionState,
  type NotificationPermissionState
} from './notification-permissions'

type SubscribeResult = {
  type: 'ready'
  subscriptionId: string
}

export function subscribeToDesktopNotifications(client: RpcClient, hostId: string): () => void {
  let subscriptionId: string | null = null
  let disposed = false

  function unsubscribeServer(id: string) {
    if (client.getState() === 'connected') {
      client.sendRequest('notifications.unsubscribe', { subscriptionId: id }).catch(() => {})
    }
  }

  const params = { includeDesktopSuppressed: true }
  const unsubscribeStream = client.subscribe('notifications.subscribe', params, (data: unknown) => {
    const event = data as DismissNotificationEvent | SubscribeResult | { type: string }
    if (event.type === 'ready') {
      subscriptionId = (event as SubscribeResult).subscriptionId
      if (disposed) {
        unsubscribeServer(subscriptionId)
        unsubscribeStream()
        return
      }
      // A max watermark asks only which delivered pushes are stale; socket history
      // never becomes a second OS-notification delivery route.
      void requestNotificationCatchup(client, hostId, () => disposed).catch(() => {})
      return
    }
    if (!disposed && event.type === 'notification') {
      void presentSocketFallback(
        event as Extract<MobileNotificationEvent, { type: 'notification' }>,
        hostId
      ).catch(() => {})
    }
    if (!disposed && event.type === 'dismiss') {
      void dismissHostPushNotification(event as DismissNotificationEvent, hostId).catch(() => {})
    }
  })

  return () => {
    disposed = true
    unsubscribeStream()
    if (subscriptionId) {
      unsubscribeServer(subscriptionId)
    }
  }
}

async function presentSocketFallback(
  event: Extract<MobileNotificationEvent, { type: 'notification' }>,
  hostId: string
): Promise<void> {
  if (await hasConfirmedPushRegistration(hostId)) {
    return
  }
  const host = (await loadHostCatalog()).find((entry) => entry.id === hostId)
  if (!host) {
    return
  }
  const hostFingerprint = deriveHostFingerprint(host.publicKeyB64)
  if (!hostFingerprint) {
    return
  }
  const data = {
    kind: 'alert' as const,
    hostFingerprint,
    ...(event.notificationId ? { notificationId: event.notificationId } : {}),
    ...(event.notificationSeq !== undefined ? { notificationSeq: event.notificationSeq } : {}),
    ...(event.notificationEpoch ? { notificationEpoch: event.notificationEpoch } : {}),
    ...(event.worktreeId ? { worktreeId: event.worktreeId } : {})
  }
  const behavior = await foregroundNotificationBehavior({
    request: {
      content: {
        title: event.title,
        subtitle: null,
        body: event.body,
        data,
        categoryIdentifier: null,
        sound: null
      }
    }
  })
  if (!behavior.shouldShowBanner && !behavior.shouldShowList) {
    return
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: event.title,
      body: event.body,
      data,
      sound: behavior.shouldPlaySound ? 'default' : null
    },
    trigger: null
  })
}
