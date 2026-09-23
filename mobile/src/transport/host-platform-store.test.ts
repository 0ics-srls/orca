import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock
}))

import {
  forgetHostPlatform,
  recordHostPlatform,
  resetHostPlatformStoreForTests,
  useHostPlatform
} from './host-platform-store'

const KEY = 'orca:host-platform:v1:host-1'

type Deferred = { resolve: (value: string | null) => void; promise: Promise<string | null> }
function deferred(): Deferred {
  let resolve: (value: string | null) => void = () => {}
  const promise = new Promise<string | null>((r) => {
    resolve = r
  })
  return { resolve, promise }
}

describe('host platform store', () => {
  let renderer: ReactTestRenderer | null = null
  const seen: Record<string, ReturnType<typeof useHostPlatform>[]> = {}

  function Row({ hostId }: { hostId: string }): null {
    const platform = useHostPlatform(hostId)
    ;(seen[hostId] ??= []).push(platform)
    return null
  }

  async function mount(hostIds: string[]): Promise<void> {
    await act(async () => {
      renderer = create(
        createElement(
          'rows',
          null,
          hostIds.map((hostId) => createElement(Row, { key: hostId, hostId }))
        )
      )
    })
  }

  const latest = (hostId: string) => seen[hostId]?.at(-1)

  beforeEach(() => {
    resetHostPlatformStoreForTests()
    vi.clearAllMocks()
    for (const hostId of Object.keys(seen)) {
      delete seen[hostId]
    }
    asyncStorageMock.getItem.mockResolvedValue(null)
    asyncStorageMock.setItem.mockResolvedValue(undefined)
    asyncStorageMock.removeItem.mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows the last platform a host reported before it has connected this launch', async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) =>
      key === KEY ? 'win32' : null
    )
    await mount(['host-1', 'host-2'])

    expect(latest('host-1')).toBe('win32')
    expect(latest('host-2')).toBeNull()
  })

  it('ignores a stored value this client cannot name', async () => {
    asyncStorageMock.getItem.mockResolvedValue('plan9')
    await mount(['host-1'])

    expect(latest('host-1')).toBeNull()
  })

  it('lets a live status reply win over a stored copy that loads after it', async () => {
    const stored = deferred()
    asyncStorageMock.getItem.mockReturnValue(stored.promise)
    await mount(['host-1'])

    await act(async () => recordHostPlatform('host-1', 'darwin'))
    await act(async () => stored.resolve('win32'))

    expect(latest('host-1')).toBe('darwin')
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(KEY, 'darwin')
  })

  it('clears the platform when a host answers without one, on screen and on disk', async () => {
    asyncStorageMock.getItem.mockResolvedValue('win32')
    await mount(['host-1'])
    expect(latest('host-1')).toBe('win32')

    await act(async () => recordHostPlatform('host-1', null))

    expect(latest('host-1')).toBeNull()
    expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(KEY)
  })

  it('does not bring back a removed host from a load that was still in flight', async () => {
    const stored = deferred()
    asyncStorageMock.getItem.mockReturnValue(stored.promise)
    await mount(['host-1'])

    await act(async () => forgetHostPlatform('host-1'))
    await act(async () => stored.resolve('win32'))

    expect(latest('host-1')).toBeNull()
    expect(asyncStorageMock.removeItem).toHaveBeenCalledWith(KEY)
  })

  it("re-renders only the row whose host's platform changed", async () => {
    await mount(['host-1', 'host-2'])
    const host2Renders = seen['host-2']?.length ?? 0

    await act(async () => recordHostPlatform('host-1', 'linux'))
    await act(async () => recordHostPlatform('host-1', 'linux'))

    expect(latest('host-1')).toBe('linux')
    expect(seen['host-2']).toHaveLength(host2Renders)
    expect(asyncStorageMock.setItem).toHaveBeenCalledOnce()
  })

  it('never shows one host its predecessor’s platform when the same reader switches hosts', async () => {
    await act(async () => {
      renderer = create(createElement(Row, { hostId: 'host-1' }))
    })
    await act(async () => recordHostPlatform('host-1', 'darwin'))

    await act(async () => {
      renderer?.update(createElement(Row, { hostId: 'host-2' }))
    })

    expect(latest('host-1')).toBe('darwin')
    expect(seen['host-2']).toEqual([null])
  })

  it('keeps showing the record when storage fails', async () => {
    asyncStorageMock.setItem.mockRejectedValue(new Error('disk full'))
    await mount(['host-1'])

    await act(async () => recordHostPlatform('host-1', 'darwin'))

    expect(latest('host-1')).toBe('darwin')
  })
})
