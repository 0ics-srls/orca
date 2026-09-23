import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostCatalogEntry } from '../transport/types'

vi.mock('react-native', () => ({
  FlatList: ({
    data,
    renderItem
  }: {
    data: HostCatalogEntry[]
    renderItem: (info: { item: HostCatalogEntry; index: number }) => unknown
  }) => data.map((item, index) => renderItem({ item, index })),
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: 'View'
}))
vi.mock('../components/MobileHostCard', () => ({ MobileHostCard: 'MobileHostCard' }))
vi.mock('./MobileHomeListHeader', () => ({ MobileHomeListHeader: 'MobileHomeListHeader' }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined)
  }
}))

import {
  recordHostPlatform,
  resetHostPlatformStoreForTests
} from '../transport/host-platform-store'
import { MobileHomeHostList } from './MobileHomeHostList'

function host(id: string, name: string): HostCatalogEntry {
  return {
    id,
    name,
    endpoint: 'ws://desk.local:8765',
    publicKeyB64: 'key',
    lastConnected: 0,
    credentialStatus: 'ready',
    profile: null
  }
}

describe('home host rows', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    resetHostPlatformStoreForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('give each card the platform its own host reported', async () => {
    await act(async () => {
      renderer = create(
        createElement(MobileHomeHostList, {
          autoConnectHostIds: [],
          bottomInset: 0,
          contentMaxWidth: 600,
          footer: createElement('Footer'),
          hostAttempts: {},
          hostLastConnected: {},
          hostConnections: {},
          hosts: [host('host-1', 'Windows-Low Spec'), host('host-2', 'Studio')],
          hostStates: {},
          isWideLayout: false,
          stats: null,
          worktreeInfo: {},
          onOpen: () => {},
          onLongPress: () => {},
          onOpenActions: () => {}
        })
      )
    })
    await act(async () => recordHostPlatform('host-1', 'darwin'))

    const cards = renderer!.root.findAll((node) => String(node.type) === 'MobileHostCard')
    expect(cards.map((card) => [card.props.host.id, card.props.hostPlatform])).toEqual([
      ['host-1', 'darwin'],
      ['host-2', null]
    ])
  })
})
