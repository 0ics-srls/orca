import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'Icon',
  Filter: 'Icon',
  Layers: 'Icon',
  List: 'Icon',
  PanelLeftClose: 'Icon',
  Plus: 'Icon',
  Search: 'Icon',
  SlidersHorizontal: 'Icon',
  SquareTerminal: 'Icon',
  UserCircle: 'Icon',
  X: 'Icon'
}))

import { STATUS_DOT_LABEL_INSET } from '../components/StatusDot'
import { HostScreenHeader } from './host-screen-header'

function render(hostPlatform: 'darwin' | null): ReactTestRenderer {
  const fields = {
    actions: {
      leaveHost: () => {},
      navigateFromHostList: () => {},
      openNewWorktreeModal: () => {}
    },
    connState: 'connected',
    embedded: false,
    floatingWorkspaceEnabled: false,
    forceReconnectHost: null,
    hostId: 'host-a',
    hostPlatform,
    lastConnectedAt: null,
    onHideSidebar: undefined,
    reconnectAttempts: 0,
    relayRecovery: {
      pendingPath: null,
      pairingRejected: false,
      relayHostReachability: 'connecting'
    },
    settings: { activeFilterCount: 0, selectedSortLabel: 'Recent' },
    state: { hostName: 'Windows-Low Spec', groupMode: 'none', showSearch: false }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the header reads only these members on a narrow, non-embedded layout; the rest of the controller is unreachable from it.
  const controller = fields as unknown as Parameters<typeof HostScreenHeader>[0]['controller']
  const rendered: { tree: ReactTestRenderer | null } = { tree: null }
  act(() => {
    rendered.tree = create(createElement(HostScreenHeader, { controller }))
  })
  if (rendered.tree === null) {
    throw new Error('the header did not render')
  }
  return rendered.tree
}

function textNode(tree: ReactTestRenderer, text: string) {
  return tree.root.findAll((node) => String(node.type) === 'Text' && node.props.children === text)
}

describe("the host header's platform line", () => {
  it('names the OS the host reported, aligned under the host name', () => {
    const tree = render('darwin')
    const [platform] = textNode(tree, 'macOS')

    expect(textNode(tree, 'Windows-Low Spec')).toHaveLength(1)
    expect(platform?.props.style.marginLeft).toBe(STATUS_DOT_LABEL_INSET)
  })

  it('is absent for a host that never reported an OS', () => {
    const tree = render(null)
    const texts = tree.root
      .findAll((node) => String(node.type) === 'Text')
      .map((node) => node.props.children)

    expect(texts).toContain('Windows-Low Spec')
    expect(texts).not.toContain('macOS')
    expect(texts).not.toContain('Windows')
  })
})
