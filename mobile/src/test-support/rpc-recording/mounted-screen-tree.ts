import { Component, createElement, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

type CrashProps = { onCrash: (message: string) => void; children?: ReactNode }

/**
 * A screen that throws while rendering or in an effect is a recording, not a suite failure: it is
 * what a reply partition does to a device, and refusing to record it would leave the shapes that
 * break a screen the only ones the oracle cannot see. The boundary catches it, the subtree goes,
 * and the message becomes state.
 */
class MountedScreenCrash extends Component<CrashProps, { crash: string | null }> {
  state: { crash: string | null } = { crash: null }
  static getDerivedStateFromError(error: unknown): { crash: string } {
    return { crash: error instanceof Error ? error.message : String(error) }
  }
  componentDidCatch(error: unknown): void {
    this.props.onCrash(error instanceof Error ? error.message : String(error))
  }
  render(): ReactNode {
    return this.state.crash === null ? this.props.children : null
  }
}

/**
 * A mounted screen, rather than a mounted hook. The element is rebuilt on every mount and update so
 * an adapter can change a prop between steps the way a parent screen would.
 */
export function screenMount(element: () => ReactElement) {
  let renderer: ReactTestRenderer | undefined
  let crashed: string | null = null
  const wrapped = () =>
    createElement(
      MountedScreenCrash,
      {
        onCrash: (message: string) => {
          crashed = message
        }
      },
      element()
    )
  return {
    mount() {
      act(() => {
        renderer = create(wrapped())
      })
    },
    update() {
      act(() => {
        renderer?.update(wrapped())
      })
    },
    unmount() {
      act(() => {
        renderer?.unmount()
        renderer = undefined
        crashed = null
      })
    },
    tree: (): unknown => renderer?.toJSON() ?? null,
    crash: (): string | null => crashed
  }
}

/** The hook form of `screenMount`: the same crash boundary, over a harness that draws nothing. */
export function hookScreenMount(render: () => void): ReturnType<typeof screenMount> {
  function Harness(): null {
    render()
    return null
  }
  return screenMount(() => createElement(Harness))
}

type RenderedNode = { type: string; props: Record<string, unknown>; children: unknown[] | null }

/**
 * The props one inert element was rendered with. Nothing invokes an inert element's callbacks, so a
 * list's contents are only ever observable through the data it was handed; this is how an adapter
 * reads them without the recording pretending a row was drawn.
 */
export function renderedElementProps(tree: unknown, tag: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child)
      }
      return
    }
    if (!node || typeof node !== 'object' || !('type' in node)) {
      return
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: react-test-renderer's JSON nodes carry exactly these three fields.
    const rendered = node as RenderedNode
    if (rendered.type === tag) {
      found.push(rendered.props)
    }
    walk(rendered.children)
  }
  walk(tree)
  return found
}

/** What a mounted screen rendered, and the crash instead if a reply took it down. */
export function projectMountedScreen(screen: { tree: () => unknown; crash: () => string | null }): {
  elements: Record<string, number>
  text: string[]
  labels: string[]
  crash: string | null
} {
  return { ...projectScreenTree(screen.tree()), crash: screen.crash() }
}

/**
 * Which inert primitives a screen chose, the copy it put on them, and the labels it gave them.
 *
 * Deliberately not the whole tree. A projection is an observation, and the props a screen passes
 * include callbacks and style objects that are neither recordable nor behaviour — but the element
 * census is what distinguishes a spinner from a list from an error, the text is what a person would
 * read off the screen, and the labels are the affordances. A screen that stops rendering its rows,
 * or blanks its copy, moves all three.
 */
export function projectScreenTree(tree: unknown): {
  elements: Record<string, number>
  text: string[]
  labels: string[]
} {
  const elements: Record<string, number> = {}
  const text: string[] = []
  const labels: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      text.push(node)
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child)
      }
      return
    }
    if (!node || typeof node !== 'object' || !('type' in node)) {
      return
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: react-test-renderer's JSON nodes carry exactly these three fields.
    const rendered = node as RenderedNode
    elements[rendered.type] = (elements[rendered.type] ?? 0) + 1
    const label = rendered.props.accessibilityLabel
    if (typeof label === 'string') {
      labels.push(label)
    }
    walk(rendered.children)
  }
  walk(tree)
  return { elements, text, labels }
}
