import { mkdtempSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { WebSocketTransport } from './rpc/ws-transport'
import { readWsFallbackPort } from './rpc/ws-fallback-port-store'

type WebSocketTransportBindInternals = {
  host: string
  tryListen(port: number): Promise<void>
}

// Why: STA-7721 — opting into network reach rebinds the listener from loopback to every interface on the
// port it has already advertised. When that bind fails the widen used to land on an OS-assigned port and
// report success, so nothing was left on the published port, no failure was logged, and the random port was
// persisted as the fallback for later launches. The listener has to stay where it was advertised or fail.
describe('OrcaRuntimeRpcServer widen port retention (STA-7721)', () => {
  async function reserveFreePort(): Promise<number> {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const address = probe.address()
    const port = address !== null && typeof address === 'object' ? address.port : 0
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    return port
  }

  // Why: assert on a real TCP accept rather than on transport bookkeeping — the field symptom is an empty
  // netstat on the advertised port, which only a connection attempt can distinguish from bookkeeping.
  async function accepts(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
  }

  // Why: the wide bind has to fail on the advertised port ONLY. Failing every wide bind would also reject
  // the port-0 relocation, so a regression would still look like a refusal and this test would pass blind.
  function failWideBindOnPort(port: number): { restore: () => void } {
    // Nothing can hold 0.0.0.0:port while the loopback listener owns it, so the bind failure this test
    // reproduces has no portable real-socket trigger; the private listen step is the only seam.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: shape restated from ws-transport.ts; realTryListen.call below fails to typecheck if either member drifts.
    const prototype = WebSocketTransport.prototype as unknown as WebSocketTransportBindInternals
    const realTryListen = prototype.tryListen
    const spy = vi.spyOn(prototype, 'tryListen').mockImplementation(function (
      this: WebSocketTransportBindInternals,
      candidatePort: number
    ) {
      if (this.host === '0.0.0.0' && candidatePort === port) {
        return Promise.reject(
          Object.assign(new Error(`listen EADDRINUSE: address already in use 0.0.0.0:${port}`), {
            code: 'EADDRINUSE',
            syscall: 'listen',
            port
          })
        )
      }
      return realTryListen.call(this, candidatePort)
    })
    return { restore: () => spy.mockRestore() }
  }

  it('reports the offer unavailable and keeps serving the advertised port when the widen cannot hold it', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
    const wsPort = await reserveFreePort()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort
    })

    await server.start()
    const wideBind = failWideBindOnPort(wsPort)
    try {
      expect(server.getWebSocketEndpoint()).toBe(`ws://127.0.0.1:${wsPort}`)

      const offer = await server.createMobilePairingOffer({
        address: '100.64.1.20',
        connectionMode: 'local-only'
      })

      expect(offer.available).toBe(false)
      if (!offer.available) {
        expect(offer.reason).toBe('network_exposure_failed')
      }
      // Why: the whole symptom — the runtime relocating itself off the port the QR and metadata name.
      expect(server.getWebSocketEndpoint()).toBe(`ws://127.0.0.1:${wsPort}`)
      expect(await accepts(wsPort)).toBe(true)
      // Why: a port that was never adopted must never be persisted — the fallback binds FIRST on later
      // launches, so recording one here would carry the relocation into every subsequent launch.
      expect(readWsFallbackPort(userDataPath)).toBeUndefined()
    } finally {
      wideBind.restore()
      await server.stop()
      errorSpy.mockRestore()
    }
  })

  it('widens on a later attempt once the port is free again', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
    const wsPort = await reserveFreePort()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort
    })

    await server.start()
    try {
      const wideBind = failWideBindOnPort(wsPort)
      await expect(server.ensureNetworkExposure()).rejects.toThrow(/EADDRINUSE/)
      wideBind.restore()

      // Why: the failed widen must leave the bind host on loopback, not latched to 0.0.0.0 — otherwise
      // ensureNetworkExposure short-circuits forever and the user can never retry.
      await server.ensureNetworkExposure()
      expect(server.getWebSocketEndpoint()).toBe(`ws://0.0.0.0:${wsPort}`)
      expect(await accepts(wsPort)).toBe(true)
      expect(readWsFallbackPort(userDataPath)).toBeUndefined()
    } finally {
      await server.stop()
      errorSpy.mockRestore()
    }
  })
})
