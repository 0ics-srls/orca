import { it, expect } from 'vitest'
import * as pty from 'node-pty'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runProcess } from '../../src/shared/child-process/run-process.ts'
import {
  captureDescendantSnapshot,
  readProcessTable
} from '../../src/main/pty-descendant-termination.ts'
import {
  createPtyPhysicalExit,
  shutdownLocalPty,
  killAllLocalPtys
} from '../../src/main/providers/local-pty-termination.ts'
import {
  ptyProcesses,
  ptyAgentSessionIds,
  ptyPhysicalExits,
  ptyExitDisposables,
  clearPtyState
} from '../../src/main/providers/local-pty-provider-state.ts'

const binary = process.env.ORCA_OMP_PROBE_BINARY
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
const ownedPidRows = async (pids) => {
  const result = await runProcess({
    program: 'ps',
    args: ['-p', pids.join(','), '-o', 'pid=,ppid=,pgid=,stat=,comm='],
    maxOutputBytes: 16000
  })
  return result.stdout.trim()
}
it.skipIf(!binary || process.platform === 'win32')(
  'observes actual OMP under production local closure policy',
  async () => {
    const output = mkdtempSync(join(process.cwd(), '.bench-fixtures/omp-close-'))
    const report = []
    for (const launch of ['recognized', 'typed']) {
      for (const close of ['explicit', 'quit']) {
        expect(ptyProcesses.size).toBe(0)
        const home = mkdtempSync(join(tmpdir(), 'orca-omp-close-home-'))
        const agentHome = join(home, 'agent')
        mkdirSync(agentHome)
        const config = join(home, 'probe.yml')
        writeFileSync(
          config,
          'startup:\n  setupWizard: false\n  showSplash: false\n  checkUpdate: false\n'
        )
        const id = `${launch}-${close}`
        let transcript = ''
        let nativeExit = null
        const shell =
          process.env.ORCA_OMP_PROBE_SHELL ??
          (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
        const shellArgs = shell.endsWith('zsh') ? ['-f', '-i'] : ['--noprofile', '--norc', '-i']
        const proc = pty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: 120,
          rows: 35,
          cwd: home,
          env: {
            ...process.env,
            HOME: home,
            ZDOTDIR: home,
            XDG_CONFIG_HOME: home,
            PI_CODING_AGENT_DIR: agentHome,
            ORCA_BACKGROUND_LAUNCH: '1'
          }
        })
        proc.onData((data) => {
          transcript = (transcript + data).slice(-131072)
        })
        ptyProcesses.set(id, proc)
        createPtyPhysicalExit(id)
        if (launch === 'recognized') {
          ptyAgentSessionIds.add(id)
        }
        ptyExitDisposables.set(
          id,
          proc.onExit((event) => {
            nativeExit = event
            ptyPhysicalExits.get(id)?.markExited()
            clearPtyState(id)
            rmSync(home, { recursive: true, force: true })
          })
        )
        let snapshot
        try {
          proc.write(`${quote(binary)} --no-session --config ${quote(config)}\r`)
          await delay(5000)
          snapshot = await captureDescendantSnapshot(proc.pid)
          expect(snapshot?.descendants.length).toBeGreaterThan(0)
          const pids = [proc.pid, ...snapshot.descendants.map((row) => row.pid)]
          const before = await ownedPidRows(pids)
          expect(before).toContain('omp')
          const started = Date.now()
          let closeError = null
          try {
            if (close === 'explicit') {
              await shutdownLocalPty(id, {})
            } else {
              killAllLocalPtys()
            }
          } catch (error) {
            closeError = String(error)
          }
          await delay(6000)
          const after = await ownedPidRows(pids)
          report.push({
            launch,
            close,
            before,
            after,
            nativeExit,
            tracked: ptyProcesses.has(id),
            elapsedMs: Date.now() - started,
            closeError,
            home
          })
          writeFileSync(join(output, `${id}.txt`), transcript)
          writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
          expect(closeError).toBeNull()
          expect(after).toBe('')
        } finally {
          if (snapshot) {
            const current = await readProcessTable()
            const owned = [
              ...snapshot.descendants,
              ...(snapshot.root ? [{ ...snapshot.root, pgid: snapshot.rootPgid }] : [])
            ]
            for (const row of current.rows) {
              if (
                owned.some(
                  (known) =>
                    known.pid === row.pid &&
                    known.startedAt === row.startedAt &&
                    known.pgid === row.pgid
                )
              ) {
                try {
                  process.kill(row.pid, 'SIGKILL')
                } catch {}
              }
            }
          }
          clearPtyState(id)
          rmSync(home, { recursive: true, force: true })
        }
      }
    }
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
    console.log(output)
  },
  90000
)
