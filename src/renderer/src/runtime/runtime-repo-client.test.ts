// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'
import {
  getRuntimeRepoBaseRefDefault,
  searchRuntimeRepoBaseRefDetails,
  searchRuntimeRepoBaseRefs
} from './runtime-repo-client'

const getBaseRefDefault = vi.fn()
const searchBaseRefs = vi.fn()
const searchBaseRefDetails = vi.fn()
const runtimeCall = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  getBaseRefDefault.mockReset()
  searchBaseRefs.mockReset()
  searchBaseRefDetails.mockReset()
  runtimeCall.mockReset()
  vi.stubGlobal('window', {
    api: {
      repos: {
        getBaseRefDefault,
        searchBaseRefs,
        searchBaseRefDetails
      },
      runtimeEnvironments: {
        call: (args: RuntimeEnvironmentCallRequest) =>
          createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeCall(args)
      }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runtime repo client search bounds', () => {
  it('rejects oversized local base-ref searches before IPC', async () => {
    await expect(
      searchRuntimeRepoBaseRefs(null, 'repo-1', 'x'.repeat(3 * 1024), 20)
    ).resolves.toEqual([])

    expect(searchBaseRefs).not.toHaveBeenCalled()
    expect(runtimeCall).not.toHaveBeenCalled()
  })

  it('rejects oversized runtime base-ref detail searches before RPC', async () => {
    await expect(
      searchRuntimeRepoBaseRefDetails(
        { activeRuntimeEnvironmentId: 'env-1' },
        'repo-1',
        'secret-token-value'.repeat(256),
        20
      )
    ).resolves.toEqual([])

    expect(searchBaseRefDetails).not.toHaveBeenCalled()
    expect(runtimeCall).not.toHaveBeenCalled()
  })

  it('forwards the selected SSH host to base-ref IPC', async () => {
    getBaseRefDefault.mockResolvedValue({ defaultBaseRef: 'origin/main', remoteCount: 1 })
    searchBaseRefs.mockResolvedValue(['origin/main'])

    await getRuntimeRepoBaseRefDefault(null, 'same-repo', 'ssh:server')
    await searchRuntimeRepoBaseRefs(null, 'same-repo', 'main', 20, 'ssh:server')

    expect(getBaseRefDefault).toHaveBeenCalledWith({
      repoId: 'same-repo',
      hostId: 'ssh:server'
    })
    expect(searchBaseRefs).toHaveBeenCalledWith({
      repoId: 'same-repo',
      query: 'main',
      limit: 20,
      hostId: 'ssh:server'
    })
  })

  it('rejects an unverifiable runtime search instead of returning empty refs', async () => {
    runtimeCall.mockResolvedValue({
      id: 'rpc-1',
      ok: true,
      result: { refs: [], truncated: false, unverifiableReason: 'remote Git unavailable' },
      _meta: { runtimeId: 'remote-runtime' }
    })
    const settings = { activeRuntimeEnvironmentId: 'env-1' }

    await expect(searchRuntimeRepoBaseRefs(settings, 'repo-1', 'main', 20)).rejects.toThrow(
      'remote Git unavailable'
    )
    await expect(searchRuntimeRepoBaseRefDetails(settings, 'repo-1', 'main', 20)).rejects.toThrow(
      'remote Git unavailable'
    )
  })

  it('propagates native IPC search failures', async () => {
    searchBaseRefs.mockRejectedValue(new Error('git remote failed'))
    await expect(searchRuntimeRepoBaseRefs(null, 'repo-1', 'main', 20)).rejects.toThrow(
      'git remote failed'
    )
  })
})
