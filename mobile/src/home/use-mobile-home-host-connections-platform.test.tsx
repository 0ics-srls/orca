import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, HostProfile } from '../transport/types'

type Entry = { hostId: string; client: RpcClient; state: ConnectionState }

const clients = vi.hoisted(() => {
  const current: Entry[] = []
  return { current }
})
const fetchPlatformMock = vi.hoisted(() => vi.fn())

vi.mock('../transport/use-all-host-clients', () => ({ useAllHostClients: () => clients.current }))
vi.mock('../transport/client-context', () => ({ usePrimeHosts: () => () => {} }))
vi.mock('../components/AccountUsage', () => ({ decodeAccountsSnapshot: () => ({}) }))
vi.mock('../notifications/mobile-notifications', () => ({
  subscribeToDesktopNotifications: () => () => {}
}))
vi.mock('../worktree/home-host-worktree-fetch', () => ({
  fetchHomeHostWorktreeInfo: () => Promise.resolve()
}))
vi.mock('./mobile-home-host-requests', () => ({
  fetchMobileHomeStats: () => {},
  fetchMobileHomeTaskProviders: () => {}
}))
vi.mock('./mobile-home-host-platform-fetch', () => ({
  fetchMobileHomeHostPlatform: (...args: unknown[]) => fetchPlatformMock(...args)
}))

import { useMobileHomeHostConnections } from './use-mobile-home-host-connections'

function fakeClient(): { client: RpcClient; emit: (state: ConnectionState) => void } {
  const listeners = new Set<(state: ConnectionState) => void>()
  const fake = {
    onStateChange: (listener: (state: ConnectionState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribe: () => () => {},
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null
  }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the home wiring reads only these members from a client.
    client: fake as unknown as RpcClient,
    emit: (state) => {
      for (const listener of listeners) {
        listener(state)
      }
    }
  }
}

const host: HostProfile = {
  id: 'host-1',
  name: 'Windows-Low Spec',
  endpoint: 'ws://desk.local:8765',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}
const setters = {
  setAccounts: () => {},
  setStats: () => {},
  setTaskProviders: () => {},
  setWorktreeInfo: () => {}
}

function Probe(): null {
  useMobileHomeHostConnections([host], [], setters)
  return null
}

describe('home host platform reads', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    fetchPlatformMock.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('reads once per connection and stops answering for a client that was replaced', () => {
    const first = fakeClient()
    clients.current = [{ hostId: 'host-1', client: first.client, state: 'connecting' }]
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(fetchPlatformMock).not.toHaveBeenCalled()

    act(() => first.emit('connected'))
    act(() => first.emit('connected'))
    expect(fetchPlatformMock).toHaveBeenCalledOnce()
    expect(fetchPlatformMock.mock.calls[0]?.slice(0, 2)).toEqual([first.client, 'host-1'])

    act(() => first.emit('reconnecting'))
    act(() => first.emit('connected'))
    expect(fetchPlatformMock).toHaveBeenCalledTimes(2)

    const firstDisposed = fetchPlatformMock.mock.calls[0]?.[2]
    expect(firstDisposed()).toBe(false)
    const second = fakeClient()
    clients.current = [{ hostId: 'host-1', client: second.client, state: 'connected' }]
    act(() => renderer?.update(createElement(Probe)))

    expect(firstDisposed()).toBe(true)
    expect(fetchPlatformMock).toHaveBeenCalledTimes(3)
    const secondDisposed = fetchPlatformMock.mock.calls[2]?.[2]
    expect(secondDisposed()).toBe(false)
    act(() => renderer?.unmount())
    renderer = null
    expect(secondDisposed()).toBe(true)
  })
})
