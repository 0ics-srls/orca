// Two panes can end up bound to one ptyId when a leaf id is duplicated across tabs (STA-7961).
// Delivery is a single slot per ptyId, so the second mount evicts the first and one of the two
// panes paints nothing the shell sent. Hydration heals the duplicate; this records the ones that
// still reach the renderer, so a field crash bundle names the PTY.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const recordRendererCrashBreadcrumb = vi.fn()
vi.mock('@/lib/crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: (name: string, data?: unknown) =>
    recordRendererCrashBreadcrumb(name, data)
}))

const PTY_ID = 'wt-1@@289ed0f2'

describe('duplicate pane pty data delivery', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    recordRendererCrashBreadcrumb.mockReset()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  async function mountPane(): Promise<{
    registerData: (id: string) => void
    unregisterData: (id: string) => void
  }> {
    const { createIpcPtySessionHandlers } = await import('./ipc-pty-session-handlers')
    const { createPtyOutputProcessor } = await import('./pty-output-processor')
    return createIpcPtySessionHandlers({
      outputProcessor: createPtyOutputProcessor({}),
      getPtyId: () => PTY_ID,
      getCallbacks: () => ({ onData: vi.fn() }),
      getSuppressAttentionEvents: () => false,
      markExited: vi.fn()
    })
  }

  it('stays silent when the first pane claims the pty', async () => {
    const pane = await mountPane()

    pane.registerData(PTY_ID)

    expect(recordRendererCrashBreadcrumb).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports the ptyId when a second pane overwrites the live handler', async () => {
    const first = await mountPane()
    const second = await mountPane()

    first.registerData(PTY_ID)
    second.registerData(PTY_ID)

    expect(recordRendererCrashBreadcrumb).toHaveBeenCalledWith(
      'terminal_pty_data_handler_overwritten',
      { ptyId: PTY_ID }
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('stays silent when a pane re-registers after releasing the pty', async () => {
    const pane = await mountPane()

    pane.registerData(PTY_ID)
    pane.unregisterData(PTY_ID)
    pane.registerData(PTY_ID)

    expect(recordRendererCrashBreadcrumb).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays silent while a shutdown of the same pty is still pending', async () => {
    const { unregisterPtyDataHandlers } = await import('./pty-shutdown-data-suspension')
    const outgoing = await mountPane()
    const incoming = await mountPane()

    outgoing.registerData(PTY_ID)
    const snapshots = unregisterPtyDataHandlers([PTY_ID])
    incoming.registerData(PTY_ID)

    expect(recordRendererCrashBreadcrumb).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    for (const snapshot of snapshots) {
      snapshot.commit()
    }
  })
})
