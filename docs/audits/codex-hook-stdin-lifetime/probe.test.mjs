import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { getManagedScript } from '../../../src/main/codex/codex-hook-script'
import { getGrokManagedScript } from '../../../src/main/grok/grok-hook-script'

const rows = []
const payload = '{"hook_event_name":"UserPromptSubmit","session_id":"fixture"}\n'

async function probe(name, script, holdMs) {
  const directory = await mkdtemp(join(tmpdir(), 'orca-hook-eof-audit-'))
  const filename = join(directory, 'hook.sh')
  await writeFile(filename, script)
  const started = performance.now()
  const child = spawn('/bin/sh', [filename], {
    stdio: ['pipe', 'ignore', 'pipe'],
    env: {
      ...process.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_PANE_KEY: 'audit-fixture',
      ORCA_AGENT_HOOK_ENDPOINT: '',
      ORCA_AGENT_HOOK_PORT: '',
      ORCA_AGENT_HOOK_TOKEN: ''
    }
  })
  let stderr = ''
  let closed = false
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  child.stdin.on('error', () => {})
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      closed = true
      resolve({ code, signal, elapsedMs: performance.now() - started })
    })
  })
  const watchdog = setTimeout(() => {
    child.stdin.end()
    child.kill('SIGKILL')
  }, 16_000)
  try {
    child.stdin.write(payload)
    await new Promise((resolve) => setTimeout(resolve, holdMs))
    const aliveBeforeEof = !closed
    child.stdin.end()
    const result = await completion
    const row = { name, holdMs, aliveBeforeEof, ...result, stderr }
    rows.push(row)
    return row
  } finally {
    clearTimeout(watchdog)
    child.stdin.end()
    if (!closed) {
      child.kill('SIGKILL')
    }
    await completion.catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('actual generated hook EOF ownership', () => {
  it('Codex remains blocked beyond ten seconds until the writer closes stdin', async () => {
    const result = await probe('codex-held-stdin', getManagedScript('posix'), 10_250)
    expect(result.aliveBeforeEof).toBe(true)
    expect(result.code).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
  }, 20_000)

  it('Codex completes when the writer closes after its complete payload', async () => {
    const result = await probe('codex-eof', getManagedScript('posix'), 0)
    expect(result.code).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.elapsedMs).toBeLessThan(2_000)
  })

  it('Grok returns with a complete JSON payload while its input pipe stays open', async () => {
    const result = await probe('grok-held-stdin', getGrokManagedScript('posix'), 2_000)
    expect(result.aliveBeforeEof).toBe(false)
    expect(result.code).toBe(0)
    expect(result.signal).toBeNull()
  })
})

afterAll(async () => {
  await writeFile(
    process.env.ORCA_HOOK_EOF_OUTPUT ?? 'docs/audits/codex-hook-stdin-lifetime/results.json',
    `${JSON.stringify({ node: process.version, platform: process.platform, rows }, null, 2)}\n`
  )
})
