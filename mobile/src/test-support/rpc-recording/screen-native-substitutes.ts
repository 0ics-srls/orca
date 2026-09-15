import { useEffect, useRef } from 'react'
import { inertIconModule, inertNativeElement, inertNativeElements } from './inert-native-elements'
import { partialNativeModule, silentNativeSubscription } from './native-module-traps'

/**
 * The view packages a mounted screen imports, and what it gets instead.
 *
 * Every element here is inert (see `inert-native-elements.ts`) and every member follows the table's
 * rule: only what a screen reads is listed, and the rest throws. A screen is mounted to observe the
 * requests it sends and the state it publishes, so nothing below simulates a device — no gesture is
 * recognised, no animation runs, no navigation happens and no layout is measured. What a recording
 * needs from any of them is that the render completes.
 *
 * Two entries pin a device input rather than refusing it, for the same reason `AppState` does:
 * `hairlineWidth` is a pixel density and a window size is a window size, and a recording fixes both
 * instead of reading them.
 *
 * A module that declares a `default` says so with `__esModule`, because `import X, { y }` compiles
 * to `__importStar`, which otherwise overwrites the declared default with the module itself.
 */

/** Focus is pinned to mounted: a recording's screen is the one on top, and `blur` is an action. */
function useMountedFocusEffect(callback: () => void | (() => void)): void {
  useEffect(callback, [callback])
}

/** Holds what is written to it; nothing animates it and no worklet ever reads it. */
function useInertSharedValue(initial: unknown): { value: unknown } {
  return useRef({ value: initial }).current
}

function useInertAnimatedStyle(): Record<string, never> {
  return {}
}

function useInertScrollHandler(): () => void {
  return () => {}
}

function useInertFrameCallback(): { setActive: () => void } {
  return { setActive: () => {} }
}

/**
 * A gesture that is never recognised. Every builder call returns the builder, so a composed chain
 * assembles exactly as written, and no handler it was given is ever invoked.
 */
function inertGestureBuilder(): unknown {
  const builder: unknown = new Proxy(
    {},
    { get: (_target, key) => (key === '__esModule' ? undefined : () => builder) }
  )
  return builder
}

function inertAnimatedNamespace(): unknown {
  return partialNativeModule('react-native-reanimated.default', {
    ...inertNativeElements(['View', 'Text', 'ScrollView', 'FlatList']),
    createAnimatedComponent: (component: unknown) => component
  })
}

export function screenNativeSubstitutes(): Map<string, unknown> {
  return new Map<string, unknown>([
    [
      'react-native-safe-area-context',
      partialNativeModule('react-native-safe-area-context', inertNativeElements(['SafeAreaView']))
    ],
    [
      'expo-router',
      partialNativeModule('expo-router', {
        // One router per recording, so a screen that closes over it keeps a stable callback.
        useRouter: constantRouter,
        useFocusEffect: useMountedFocusEffect,
        useLocalSearchParams: () => ({})
      })
    ],
    ['lucide-react-native', inertIconModule()],
    [
      'react-native-gesture-handler',
      partialNativeModule('react-native-gesture-handler', {
        Gesture: inertGestureBuilder(),
        ...inertNativeElements(['GestureDetector', 'GestureHandlerRootView'])
      })
    ],
    [
      'react-native-reanimated',
      partialNativeModule('react-native-reanimated', {
        __esModule: true,
        default: inertAnimatedNamespace(),
        useSharedValue: useInertSharedValue,
        useAnimatedStyle: useInertAnimatedStyle,
        useAnimatedScrollHandler: useInertScrollHandler,
        useFrameCallback: useInertFrameCallback,
        // A spring or a timing settles on its target, the only value a still recording could read.
        withSpring: (toValue: unknown) => toValue,
        withTiming: (toValue: unknown) => toValue,
        interpolate: () => 0,
        Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
        runOnJS: () => () => {},
        measure: () => null,
        scrollTo: () => {}
      })
    ],
    [
      'react-native-svg',
      partialNativeModule('react-native-svg', {
        __esModule: true,
        default: inertNativeElement('Svg'),
        ...inertNativeElements(['Circle', 'Defs', 'G', 'LinearGradient', 'Path', 'Rect', 'Stop'])
      })
    ]
  ])
}

const ROUTER = { push: () => {}, replace: () => {}, back: () => {}, dismiss: () => {} }
function constantRouter(): typeof ROUTER {
  return ROUTER
}

const ABSOLUTE_FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }

/** The same merge the real `flatten` does, and pure, so a screen reading one style sees it. */
function flattenStyle(style: unknown): unknown {
  if (!Array.isArray(style)) {
    return style ?? {}
  }
  return Object.assign({}, ...style.map((entry) => flattenStyle(entry)))
}

/**
 * A task deferred to a microtask rather than dropped: a scheduler that never runs its task swallows
 * whatever send the screen deferred, and the recording claims the screen sends nothing.
 */
function runAfterInteractions(task?: () => unknown): Promise<unknown> & {
  done: (onFulfilled?: () => unknown, onRejected?: (reason: unknown) => unknown) => void
  cancel: () => void
} {
  let cancelled = false
  const settled = Promise.resolve().then(() => (cancelled ? undefined : task?.()))
  return Object.assign(settled, {
    done: (onFulfilled?: () => unknown, onRejected?: (reason: unknown) => unknown) => {
      void settled.then(onFulfilled, onRejected)
    },
    cancel: () => {
      cancelled = true
    }
  })
}

/** The react-native primitives and module members a mounted screen reads. */
export function reactNativeScreenMembers(): Record<string, unknown> {
  return {
    ...inertNativeElements([
      'ActivityIndicator',
      'FlatList',
      'Image',
      'Modal',
      'Pressable',
      'RefreshControl',
      'ScrollView',
      'SectionList',
      'Switch',
      'Text',
      'TextInput',
      'View'
    ]),
    StyleSheet: {
      create: (sheet: unknown) => sheet,
      flatten: flattenStyle,
      hairlineWidth: 1,
      absoluteFill: ABSOLUTE_FILL,
      absoluteFillObject: ABSOLUTE_FILL
    },
    Alert: { alert: () => {} },
    BackHandler: { addEventListener: silentNativeSubscription },
    Keyboard: { addListener: silentNativeSubscription, dismiss: () => {} },
    Linking: { openURL: () => Promise.resolve(true), openSettings: () => Promise.resolve() },
    InteractionManager: { runAfterInteractions }
  }
}
