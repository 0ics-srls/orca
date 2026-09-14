/**
 * The probe and reap scripts run on someone else's machine and decide whether a process is
 * signalled, so the shell itself is the part worth testing for real. These cases run the
 * generated scripts through /bin/sh against real unix sockets and real processes.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  isReapableRelayHusk,
  parseRelayEndpointIncumbentProbe,
  relayEndpointIncumbentProbeCommand,
  type RelayEndpointIncumbent
} from './ssh-relay-endpoint-incumbent'
import { reapEmptyRelayHuskCommand } from './ssh-relay-endpoint-takeover'
import { RELAY_DAEMON_SERVICE_ENTRY_FILENAMES } from '../../shared/relay-artifacts'

const posixOnly = process.platform === 'win32' ? describe.skip : describe

const FAKE_RELAY_SOURCE = `
const net = require('net')
const path = require('path')
const sock = process.argv[process.argv.indexOf('--sock-path') + 1]
function spawnChild(args) {
  require('child_process').spawn(process.execPath, args, { stdio: 'ignore' })
}
if (process.argv.includes('--with-child')) {
  spawnChild(['-e', 'setTimeout(() => {}, 60000)'])
}
// Why forked the same way production does: the exclusion is argv-shaped, so a hand-written
// stand-in would test the test rather than the shell that runs on someone's host.
for (const name of process.argv.filter((arg) => arg.startsWith('--service-child='))) {
  spawnChild([path.join(__dirname, name.slice('--service-child='.length))])
}
net.createServer(() => {}).listen(sock, () => process.stdout.write('READY\\n'))
process.on('SIGTERM', () => process.exit(0))
`

// Self-limiting: these are orphaned when the relay under test is reaped.
const IDLE_SERVICE_SOURCE = 'setTimeout(() => {}, 60000)\n'

function sh(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/bin/sh', ['-c', script], { timeout: 20_000 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

let workDir: string
let pgreplessBinDir: string
let hasLsof = false
const running: ChildProcess[] = []

function startFakeRelay(
  sockPath: string,
  options: { withChild?: boolean; serviceChildren?: readonly string[] } = {}
): Promise<ChildProcess> {
  const args = [join(workDir, 'relay.js'), '--sock-path', sockPath]
  if (options.withChild) {
    args.push('--with-child')
  }
  for (const name of options.serviceChildren ?? []) {
    args.push(`--service-child=${name}`)
  }
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'] })
  running.push(child)
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('READY')) {
        resolve(child)
      }
    })
    child.on('exit', () => reject(new Error('fake relay exited before listening')))
  })
}

async function probe(sockPath: string): Promise<RelayEndpointIncumbent> {
  const output = await sh(relayEndpointIncumbentProbeCommand(process.execPath, sockPath))
  return parseRelayEndpointIncumbentProbe(sockPath, output)
}

/** The relay forks its children after it starts listening, so the probe can race them. */
async function waitForChildCount(
  sockPath: string,
  expected: number
): Promise<RelayEndpointIncumbent> {
  let incumbent = await probe(sockPath)
  for (let attempt = 0; attempt < 50 && incumbent.holders[0]?.childCount !== expected; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    incumbent = await probe(sockPath)
  }
  return incumbent
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'orca-relay-incumbent-'))
  writeFileSync(join(workDir, 'relay.js'), FAKE_RELAY_SOURCE)
  for (const filename of RELAY_DAEMON_SERVICE_ENTRY_FILENAMES) {
    writeFileSync(join(workDir, filename), IDLE_SERVICE_SOURCE)
  }
  writeFileSync(join(workDir, 'looks-like-relay-watcher.js'), IDLE_SERVICE_SOURCE)
  pgreplessBinDir = join(workDir, 'pgrepless-bin')
  mkdirSync(pgreplessBinDir)
  for (const tool of ['ps', 'tr']) {
    symlinkSync((await sh(`command -v ${tool}`)).trim(), join(pgreplessBinDir, tool))
  }
  hasLsof = await sh('command -v lsof >/dev/null 2>&1 && echo yes || echo no').then(
    (out) => out.trim() === 'yes'
  )
})

afterEach(() => {
  while (running.length > 0) {
    running.pop()?.kill('SIGKILL')
  }
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

it('runs the holder-enumeration assertions on this machine', () => {
  // Why asserted rather than assumed: the cases below degrade to verdict-only checks without
  // lsof, and a silently degraded suite would stop covering the reap gate entirely.
  expect(hasLsof).toBe(true)
})

posixOnly('relay endpoint probe against a real socket', () => {
  it('reports live, and identifies the holding process, for a listening relay', async () => {
    const sockPath = join(workDir, 'live.sock')
    const relay = await startFakeRelay(sockPath)
    const incumbent = await probe(sockPath)

    expect(incumbent.verdict).toBe('live')
    expect(incumbent.evidence).toBe('accepted-connection')
    expect(incumbent.socketPresent).toBe(true)
    if (!hasLsof) {
      return
    }
    expect(incumbent.holders.map((holder) => holder.pid)).toEqual([relay.pid])
    expect(incumbent.holders[0]).toMatchObject({
      matchesRelayArgv: true,
      childCount: 0,
      unrecognizedChildCount: 0
    })
    expect(isReapableRelayHusk(incumbent)).toBe(true)
  })

  it("counts the daemon's own service children but does not hold them against it", async () => {
    const sockPath = join(workDir, 'services.sock')
    await startFakeRelay(sockPath, { serviceChildren: RELAY_DAEMON_SERVICE_ENTRY_FILENAMES })
    const incumbent = await waitForChildCount(sockPath, RELAY_DAEMON_SERVICE_ENTRY_FILENAMES.length)

    expect(incumbent.holders[0].childCount).toBe(RELAY_DAEMON_SERVICE_ENTRY_FILENAMES.length)
    expect(incumbent.holders[0].unrecognizedChildCount).toBe(0)
    expect(isReapableRelayHusk(incumbent)).toBe(true)
  })

  it('still retains a relay holding work alongside its service children', async () => {
    const sockPath = join(workDir, 'services-and-work.sock')
    await startFakeRelay(sockPath, {
      withChild: true,
      serviceChildren: RELAY_DAEMON_SERVICE_ENTRY_FILENAMES
    })
    const incumbent = await waitForChildCount(
      sockPath,
      RELAY_DAEMON_SERVICE_ENTRY_FILENAMES.length + 1
    )

    expect(incumbent.holders[0].unrecognizedChildCount).toBe(1)
    expect(isReapableRelayHusk(incumbent)).toBe(false)
  })

  it('does not excuse a child that merely mentions a service entry name', async () => {
    const sockPath = join(workDir, 'lookalike.sock')
    await startFakeRelay(sockPath, { serviceChildren: ['looks-like-relay-watcher.js'] })
    const incumbent = await waitForChildCount(sockPath, 1)

    expect(incumbent.holders[0].unrecognizedChildCount).toBe(1)
    expect(isReapableRelayHusk(incumbent)).toBe(false)
  })

  it('refuses to call a relay with a live child an empty husk', async () => {
    const sockPath = join(workDir, 'busy.sock')
    await startFakeRelay(sockPath, { withChild: true })
    const incumbent = await probe(sockPath)

    expect(incumbent.verdict).toBe('live')
    if (!hasLsof) {
      return
    }
    expect(incumbent.holders[0].childCount).toBeGreaterThan(0)
    expect(isReapableRelayHusk(incumbent)).toBe(false)
  })

  it('reports exited for a socket inode a SIGKILLed relay left behind', async () => {
    const sockPath = join(workDir, 'stale.sock')
    const relay = await startFakeRelay(sockPath)
    relay.kill('SIGKILL')
    await new Promise((resolve) => relay.on('exit', resolve))

    const incumbent = await probe(sockPath)
    expect(incumbent.socketPresent).toBe(true)
    expect(incumbent.verdict).toBe(hasLsof ? 'exited' : 'unverifiable')
  })

  it('reports no listener for a path that was never bound', async () => {
    const incumbent = await probe(join(workDir, 'never-existed.sock'))
    expect(incumbent.socketPresent).toBe(false)
    expect(incumbent.verdict).toBe(hasLsof ? 'exited' : 'unverifiable')
  })
})

posixOnly('empty relay husk reap against a real process', () => {
  it('terminates a proven-empty relay and confirms the pid is gone', async () => {
    const sockPath = join(workDir, 'husk.sock')
    const relay = await startFakeRelay(sockPath)
    const output = await sh(reapEmptyRelayHuskCommand(relay.pid!, sockPath))
    expect(output.trim()).toBe('GONE')
  })

  it('refuses to signal a relay that acquired a child after it was probed', async () => {
    const sockPath = join(workDir, 'raced.sock')
    const relay = await startFakeRelay(sockPath, { withChild: true })
    const output = await sh(reapEmptyRelayHuskCommand(relay.pid!, sockPath))
    expect(output.trim()).toBe('BUSY')
    expect(relay.killed).toBe(false)
  })

  it('terminates a relay whose only children are its own service processes (#13614)', async () => {
    const sockPath = join(workDir, 'service-husk.sock')
    const relay = await startFakeRelay(sockPath, {
      serviceChildren: RELAY_DAEMON_SERVICE_ENTRY_FILENAMES
    })
    await waitForChildCount(sockPath, RELAY_DAEMON_SERVICE_ENTRY_FILENAMES.length)
    const output = await sh(reapEmptyRelayHuskCommand(relay.pid!, sockPath))
    expect(output.trim()).toBe('GONE')
  })

  it('refuses to signal when the host cannot enumerate children at all', async () => {
    const sockPath = join(workDir, 'no-pgrep.sock')
    const relay = await startFakeRelay(sockPath)
    // A PATH carrying every tool the script needs except `pgrep`: the census answers
    // `unknown`, which must reach BUSY rather than the zero a missing tool would imply.
    const output = await sh(
      `PATH=${pgreplessBinDir}\n${reapEmptyRelayHuskCommand(relay.pid!, sockPath)}`
    )
    expect(output.trim()).toBe('BUSY')
    expect(relay.killed).toBe(false)
  })

  it('refuses to signal a pid whose argv is not this relay at this socket', async () => {
    const sockPath = join(workDir, 'mismatch.sock')
    await startFakeRelay(sockPath)
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore'
    })
    running.push(bystander)
    const output = await sh(reapEmptyRelayHuskCommand(bystander.pid!, sockPath))
    expect(output.trim()).toBe('MISMATCH')
    expect(bystander.killed).toBe(false)
  })
})

/**
 * `lsof` reports the same empty stdout whether nothing holds the socket or it could not answer
 * at all, and under `-t` it exits 1 either way. Measured on Debian 12: against a wedged NFS
 * mount it blocks indefinitely (killed at 120s, no stdout, no stderr), and with `-b` it returns
 * in 2ms having reported no holder for a socket a live process was holding. Reading either as
 * "nobody holds it" unlinks a live relay's endpoint, so the script has to tell an answer from a
 * failure before the parser is allowed to see `HOLDERS_SOURCE=lsof`.
 */
posixOnly('holder enumeration when lsof cannot answer', () => {
  async function probeWithStubLsof(
    sockPath: string,
    stubBody: string
  ): Promise<RelayEndpointIncumbent> {
    const binDir = mkdtempSync(join(workDir, 'stub-lsof-'))
    writeFileSync(join(binDir, 'lsof'), `#!/bin/sh\n${stubBody}\n`, { mode: 0o755 })
    const output = await sh(
      `PATH=${binDir}:$PATH\n${relayEndpointIncumbentProbeCommand(process.execPath, sockPath)}`
    )
    return parseRelayEndpointIncumbentProbe(sockPath, output)
  }

  /** A socket inode with no listener: the one shape whose honest verdict is `exited`. */
  async function staleSocket(name: string): Promise<string> {
    const sockPath = join(workDir, name)
    const relay = await startFakeRelay(sockPath)
    relay.kill('SIGKILL')
    await new Promise((resolve) => relay.on('exit', resolve))
    return sockPath
  }

  it('refuses to call the endpoint exited when lsof failed to stat the path', async () => {
    // Verbatim shape of `lsof -b -t -a -U <sock>` against a socket a live relay was holding.
    const incumbent = await probeWithStubLsof(
      await staleSocket('lsof-status-error.sock'),
      'echo "lsof: status error on $4: Resource temporarily unavailable" >&2\nexit 1'
    )

    expect(incumbent.holdersEnumerable).toBe(false)
    expect(incumbent.verdict).toBe('unverifiable')
  })

  it('refuses to call the endpoint exited when lsof was killed mid-probe', async () => {
    // What any `timeout`/`-S` bound around the blocking case produces: no output, no stderr.
    const incumbent = await probeWithStubLsof(
      await staleSocket('lsof-signalled.sock'),
      'kill -KILL $$'
    )

    expect(incumbent.holdersEnumerable).toBe(false)
    expect(incumbent.verdict).toBe('unverifiable')
  })

  it('still reports exited when lsof cleanly found no holder', async () => {
    // The over-correction guard: a silent exit 1 is lsof answering "nobody", not failing.
    const incumbent = await probeWithStubLsof(await staleSocket('lsof-clean-empty.sock'), 'exit 1')

    expect(incumbent.holdersEnumerable).toBe(true)
    expect(incumbent.verdict).toBe('exited')
  })

  it('keeps holders lsof did report even when it also emitted a diagnostic', async () => {
    const sockPath = join(workDir, 'lsof-noisy-holder.sock')
    const relay = await startFakeRelay(sockPath)
    const incumbent = await probeWithStubLsof(
      sockPath,
      `echo "lsof: WARNING: can't stat() nfs file system /mnt/share" >&2\necho ${relay.pid}\nexit 1`
    )

    expect(incumbent.holdersEnumerable).toBe(true)
    expect(incumbent.holders.map((holder) => holder.pid)).toEqual([relay.pid])
  })
})
