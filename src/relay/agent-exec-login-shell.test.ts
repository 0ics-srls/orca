import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { quotePosixShell } from '../shared/wsl-login-shell-command'
import { createHandlers, requestContext, withPlatform } from './agent-exec-handler-test-harness'
import { agentExecLoginShell } from './agent-exec-login-shell'

const fixtureDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixture(shell: string): { cwd: string; pidPath: string; bin: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-agent-login-')))
  fixtureDirs.push(root)
  const bin = join(root, 'bin')
  const cwd = join(root, "repo ' $literal")
  const pidPath = join(root, 'agent.pid')
  mkdirSync(bin)
  mkdirSync(cwd)
  const startup = [
    `export PATH=${quotePosixShell(bin)}:"$PATH"`,
    'printf "LOGIN BANNER\\n"',
    'export ORCA_AGENT_FIXTURE=from-login',
    'cd /'
  ].join('\n')
  writeFileSync(join(root, '.zshrc'), startup)
  writeFileSync(join(root, '.bash_profile'), startup)
  const script = join(root, 'agent.cjs')
  writeFileSync(
    script,
    `
    const fs = require('node:fs')
    if (process.argv.includes('--wait')) {
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid))
      setInterval(() => {}, 1000)
    } else if (process.argv.includes('--environment')) {
      process.stdout.write(JSON.stringify({ value: process.env.ORCA_AGENT_FIXTURE, path: process.env.PATH }))
    } else {
      let stdin = ''
      process.stdin.on('data', chunk => stdin += chunk)
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin }))
      })
    }
  `
  )
  writeFileSync(
    join(bin, 'orca-login-agent'),
    `#!/bin/sh\nexec ${quotePosixShell(process.execPath)} ${quotePosixShell(script)} "$@"\n`,
    { mode: 0o755 }
  )
  vi.stubEnv('HOME', root)
  vi.stubEnv('ZDOTDIR', root)
  vi.stubEnv('SHELL', shell)
  vi.stubEnv('PATH', '/usr/bin:/bin')
  return { cwd, pidPath, bin }
}

describe('SSH agent login execution', () => {
  for (const shell of ['/bin/bash', '/bin/zsh']) {
    it.skipIf(process.platform === 'win32' || !existsSync(shell))(
      `finds a login-only agent with literal argv, intact stdin and clean output in ${shell}`,
      async () => {
        const { cwd } = fixture(shell)
        const handlers = createHandlers()
        const exec = handlers.get('agent.execNonInteractive')!
        const args = [
          'run',
          '',
          'model; echo injected',
          '$(touch injected)',
          '`pwd`',
          'line\nbreak'
        ]
        const params = { binary: 'orca-login-agent', args, cwd, stdin: 'literal prompt\n$HOME\n' }
        const baseline = await exec(params, requestContext())
        expect(baseline).toMatchObject({ spawnError: expect.stringContaining('ENOENT') })
        const result = await exec({ ...params, loginShell: true }, requestContext())
        expect(result).toMatchObject({
          stdout: JSON.stringify({ args, cwd, stdin: params.stdin }),
          exitCode: 0,
          timedOut: false,
          canceled: false
        })
        expect(existsSync(join(cwd, 'injected'))).toBe(false)
      }
    )
  }

  for (const shell of ['/bin/bash', '/bin/zsh']) {
    it.skipIf(process.platform === 'win32' || !existsSync(shell))(
      `keeps explicit environment values after login startup in ${shell}`,
      async () => {
        const { cwd, bin } = fixture(shell)
        const value = 'caller $HOME $(touch injected) `pwd`'
        const result = await createHandlers().get('agent.execNonInteractive')!(
          {
            binary: 'orca-login-agent',
            args: ['--environment'],
            cwd,
            loginShell: true,
            env: { ORCA_AGENT_FIXTURE: value, PATH: bin }
          },
          requestContext()
        )
        expect(result).toMatchObject({ stdout: JSON.stringify({ value, path: bin }), exitCode: 0 })
        expect(existsSync(join(cwd, 'injected'))).toBe(false)
      }
    )
  }

  it.skipIf(process.platform === 'win32')(
    'cancels the exec-replaced agent in its operation lane',
    async () => {
      const { cwd, pidPath } = fixture('/bin/bash')
      const handlers = createHandlers()
      const pending = handlers.get('agent.execNonInteractive')!(
        {
          binary: 'orca-login-agent',
          args: ['--wait'],
          cwd,
          stdin: null,
          loginShell: true,
          operation: 'commit-message'
        },
        requestContext()
      )
      await vi.waitFor(() => expect(existsSync(pidPath)).toBe(true))
      const pid = Number(readFileSync(pidPath, 'utf8'))
      expect(
        await handlers.get('agent.cancelExec')!(
          { cwd, operation: 'pull-request-fields' },
          requestContext()
        )
      ).toEqual({ canceled: false })
      expect(
        await handlers.get('agent.cancelExec')!(
          { cwd, operation: 'commit-message' },
          requestContext()
        )
      ).toEqual({ canceled: true })
      expect(await pending).toMatchObject({ canceled: true, timedOut: false })
      expect(() => process.kill(pid, 0)).toThrow()
    }
  )

  it('only enables login startup for a strict boolean on supported POSIX shells', () => {
    vi.stubEnv('SHELL', '/bin/bash')
    for (const value of [undefined, false, 'true', 1]) {
      expect(agentExecLoginShell('agent', [], '/repo', value)).toBeNull()
    }
    withPlatform('win32', () => {
      expect(agentExecLoginShell('agent.cmd', [], 'C:\\repo', true)).toBeNull()
    })
    vi.stubEnv('SHELL', '/bin/sh')
    expect(agentExecLoginShell('agent', [], '/repo', true)).toBeNull()
  })
})
