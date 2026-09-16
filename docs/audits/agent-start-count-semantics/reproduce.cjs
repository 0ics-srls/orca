const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '../../..')
const source = 'src/main/stats/agent-session-transition-recorder.ts'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-agent-start-semantics-'))
const modulePath = path.join(temporary, 'recorder.cjs')

try {
  const bundle = esbuild.buildSync({
    absWorkingDir: root,
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false
  }).outputFiles[0].contents
  fs.writeFileSync(modulePath, bundle)
  const { AgentSessionTransitionRecorder } = require(modulePath)
  const run = (name, states, replay = false) => {
    const events = []
    const recorder = new AgentSessionTransitionRecorder({
      onAgentStart: (sessionKey, at) => events.push({ type: 'agent_start', sessionKey, at }),
      onAgentStop: (sessionKey, at) => events.push({ type: 'agent_stop', sessionKey, at })
    })
    states.forEach((state, index) =>
      recorder.onStatus({
        paneKey: 'same-tab:same-leaf',
        worktreeId: 'same-worktree',
        connectionId: null,
        stateStartedAt: 1_800_000_000_000 + index * 1000,
        payload: { state },
        ...(replay ? { isReplay: true } : {})
      })
    )
    const result = {
      name,
      inputEvents: states.length,
      starts: events.filter((event) => event.type === 'agent_start').length,
      stops: events.filter((event) => event.type === 'agent_stop').length,
      trackedPanesBeforeClear: recorder.trackedPaneCount,
      uniquePaneKeys: new Set(events.map((event) => event.sessionKey)).size
    }
    recorder.onCleared({ paneKey: 'same-tab:same-leaf' })
    result.trackedPanesAfterClear = recorder.trackedPaneCount
    return result
  }
  const cases = [
    run(
      '44 working/done turns on one unchanged pane',
      Array.from({ length: 44 }, () => ['working', 'done']).flat()
    ),
    run(
      '44 identical live working refreshes',
      Array.from({ length: 44 }, () => 'working')
    ),
    run(
      '44 replayed working refreshes',
      Array.from({ length: 44 }, () => 'working'),
      true
    )
  ]
  assert.deepEqual(
    cases.map((result) => result.starts),
    [44, 1, 0]
  )
  assert.deepEqual(
    cases.map((result) => result.trackedPanesAfterClear),
    [0, 0, 0]
  )
  const result = {
    scope:
      'Actual transition recorder; synthetic hook statuses on one unchanged pane. No process is spawned by these operations.',
    source,
    sourceSha256: createHash('sha256')
      .update(fs.readFileSync(path.join(root, source)))
      .digest('hex'),
    bundleSha256: createHash('sha256').update(bundle).digest('hex'),
    cases
  }
  const output = process.argv[2] || path.join(__dirname, 'results.json')
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  delete require.cache[modulePath]
  fs.rmSync(temporary, { recursive: true, force: true })
}
