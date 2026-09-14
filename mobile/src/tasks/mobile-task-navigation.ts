import {
  coordinateHostStackNavigation,
  hostStackHostRoute,
  navigateToHostStackRoute,
  type HostStackHostRoute,
  type HostStackNavigationController,
  type HostStackRootNavigation,
  type HostStackRouteTarget,
  type HostStackRouter,
  type PendingHostStackNavigation
} from '../navigation/host-stack-navigation'
import type { TaskProvider } from './mobile-task-providers'

export function mobileTasksHostRoute(hostId: string): HostStackHostRoute {
  return hostStackHostRoute(hostId)
}

export function mobileTasksRouteTarget(
  hostId: string,
  provider?: TaskProvider
): HostStackRouteTarget {
  return {
    name: '[hostId]/tasks',
    params: provider ? { hostId, taskSource: provider } : { hostId }
  }
}

export function navigateToMobileTasks(
  navigation: HostStackRootNavigation,
  router: HostStackRouter,
  hostId: string,
  provider?: TaskProvider
): HostStackNavigationController {
  return navigateToHostStackRoute(
    navigation,
    router,
    hostId,
    mobileTasksRouteTarget(hostId, provider)
  )
}

export function coordinateMobileTasksNavigation(
  current: PendingHostStackNavigation | null,
  navigation: HostStackRootNavigation,
  router: HostStackRouter,
  hostId: string,
  provider?: TaskProvider
): PendingHostStackNavigation {
  return coordinateHostStackNavigation(
    current,
    navigation,
    router,
    hostId,
    mobileTasksRouteTarget(hostId, provider)
  )
}
