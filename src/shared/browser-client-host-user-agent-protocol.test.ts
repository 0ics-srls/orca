import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BrowserClientHostAttachParams,
  BrowserClientHostCommandEvent,
  BrowserClientHostReady
} from './browser-client-host-protocol'

const page = {
  authorityRuntimeId: 'runtime-old',
  authorityEpoch: 'epoch-old',
  browserHostClientId: 'host-a',
  browserHostGeneration: 2,
  browserPageId: 'page-a',
  pageHostGeneration: 3,
  browserProfileId: 'profile-a',
  userAgentMode: 'native' as const,
  executionHostKey: 'native:runtime-a:1',
  state: 'active' as const
}

const authority = {
  type: 'command' as const,
  authorityRuntimeId: 'runtime-a',
  authorityEpoch: 'epoch-new',
  browserHostClientId: 'host-a',
  browserHostGeneration: 4,
  pageCommandProtocolVersion: 1 as const,
  pageReconciliationProtocolVersion: 1 as const,
  userAgentContractVersion: 1 as const,
  browserPageId: 'page-a',
  pageHostGeneration: 5,
  commandSequence: 6,
  commandId: 'command-a'
}

describe('browser client-host user-agent contract', () => {
  it('negotiates mode only with command and inventory v1', () => {
    const attach = BrowserClientHostAttachParams.parse({
      authorityRuntimeId: 'runtime-a',
      browserHostClientId: 'host-a',
      hostCapabilities: ['webview'],
      pageCommandProtocolVersion: 1,
      pageInventoryProtocolVersion: 1,
      pageInventory: [page],
      userAgentContractVersion: 1
    })
    expect(attach.pageInventory?.[0]?.userAgentMode).toBe('native')
    expect(
      BrowserClientHostReady.parse({
        type: 'ready',
        authorityEpoch: 'epoch-new',
        browserHostGeneration: 4,
        pageCommandProtocolVersion: 1,
        pageInventoryProtocolVersion: 1,
        userAgentContractVersion: 1
      })
    ).toHaveProperty('userAgentContractVersion', 1)
    expect(() =>
      BrowserClientHostAttachParams.parse({
        authorityRuntimeId: 'runtime-a',
        browserHostClientId: 'host-a',
        hostCapabilities: ['webview'],
        userAgentContractVersion: 1
      })
    ).toThrow('Browser user-agent contract requires command and inventory negotiation')
  })

  it('requires mode on negotiated inventory and rejects it without negotiation', () => {
    const base = {
      authorityRuntimeId: 'runtime-a',
      browserHostClientId: 'host-a',
      hostCapabilities: ['webview'],
      pageCommandProtocolVersion: 1,
      pageInventoryProtocolVersion: 1
    }
    expect(() =>
      BrowserClientHostAttachParams.parse({
        ...base,
        pageInventory: [{ ...page, userAgentMode: undefined }],
        userAgentContractVersion: 1
      })
    ).toThrow('Browser page inventory omits its user-agent mode')
    expect(() => BrowserClientHostAttachParams.parse({ ...base, pageInventory: [page] })).toThrow(
      'Browser page inventory did not negotiate its user-agent contract'
    )
  })

  it.each(['createPage', 'reclaimPage', 'restorePage'] as const)(
    'carries authoritative mode on %s',
    (type) => {
      const previousAuthority = {
        authorityRuntimeId: 'runtime-a',
        authorityEpoch: 'epoch-old',
        browserHostClientId: 'host-a',
        browserHostGeneration: 2,
        pageHostGeneration: 3
      }
      const command =
        type === 'createPage'
          ? {
              type,
              browserProfileId: 'profile-a',
              userAgentMode: 'native',
              executionHostKey: 'host'
            }
          : type === 'reclaimPage'
            ? {
                type,
                previousAuthority,
                browserProfileId: 'profile-a',
                userAgentMode: 'native',
                executionHostKey: 'host'
              }
            : {
                type,
                browserProfileId: 'profile-a',
                userAgentMode: 'native',
                executionHostKey: 'host'
              }
      expect(BrowserClientHostCommandEvent.parse({ ...authority, command })).toMatchObject({
        command: { type, userAgentMode: 'native' }
      })
      expect(() =>
        BrowserClientHostCommandEvent.parse({
          ...authority,
          command: { ...command, userAgentMode: undefined }
        })
      ).toThrow('Browser page command omits its user-agent mode')
      const unnegotiated = { ...authority, userAgentContractVersion: undefined, command }
      expect(() => BrowserClientHostCommandEvent.parse(unnegotiated)).toThrow(
        'Browser page command did not negotiate its user-agent contract'
      )
    }
  )

  it('keeps the additive contract invisible to an old decoder', () => {
    const oldAttach = z.object({
      authorityRuntimeId: z.string(),
      browserHostClientId: z.string(),
      hostCapabilities: z.array(z.string())
    })
    expect(
      oldAttach.parse({
        authorityRuntimeId: 'runtime-a',
        browserHostClientId: 'host-a',
        hostCapabilities: ['webview'],
        userAgentContractVersion: 1
      })
    ).not.toHaveProperty('userAgentContractVersion')
  })
})
