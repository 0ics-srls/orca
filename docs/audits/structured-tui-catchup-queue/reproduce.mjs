import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Module from 'node:module'
import { basename, resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { build } from 'esbuild'

assert.equal(process.env.ORCA_BACKGROUND_LAUNCH, '1')
assert.equal(typeof global.gc, 'function')
const root = process.cwd()
const mocks = {
  'session-file-resolver.ts': 'export const resolveSessionFilePath = async () => null;',
  'transcript-watch.ts': `export const subscribeNativeChatTranscript = async args => {
    globalThis.auditTranscript = args;
    return { watching: true, unsubscribe() { globalThis.auditTranscript = null; } };
  };`,
  'structured-tui-transcript-boundary.ts':
    'export const readStructuredTuiTranscriptBoundary = async () => null; export const writeStructuredTuiTranscriptBoundary = async () => {};',
  'journal-legacy-import.ts':
    'export const appendLegacyTranscriptMessages = async () => {}; export const importLegacyTranscriptIntoJournal = async () => ({ok: true});',
  'transcript-incremental-reader.ts':
    'export const readIncrementalTranscriptMessages = async () => [];',
  'transcript-tail-reader.ts': 'export const nativeChatLineDecoderForAgent = () => () => null;'
}
const built = await build({
  absWorkingDir: root,
  stdin: {
    contents: `export { StructuredTuiTranscriptCatchup } from './src/main/native-chat/agent-session-wire/structured-tui-transcript-catchup.ts';
export { StructuredAgentSessionTaskQueue } from './src/main/native-chat/agent-session-wire/structured-agent-session-task-queue.ts';`,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false,
  plugins: [
    {
      name: 'stub-io-only',
      setup(bundler) {
        bundler.onLoad({ filter: /\.ts$/ }, ({ path }) => {
          const contents = mocks[basename(path)]
          return contents === undefined ? undefined : { contents, loader: 'ts' }
        })
      }
    }
  ]
})
const compiled = new Module(resolve('docs/audits/structured-tui-catchup-queue/compiled.cjs'))
compiled.filename = resolve('docs/audits/structured-tui-catchup-queue/compiled.cjs')
compiled.paths = Module._nodeModulePaths(root)
compiled._compile(built.outputFiles[0].text, compiled.filename)
const { StructuredTuiTranscriptCatchup, StructuredAgentSessionTaskQueue } = compiled.exports
const queue = new StructuredAgentSessionTaskQueue()
let release
const blocked = queue.serialize(
  's',
  () =>
    new Promise((resolve) => {
      release = resolve
    })
)
const catchup = new StructuredTuiTranscriptCatchup({
  store: {
    getRecord: () => ({
      providerHandleChain: [{ handle: { provider: 'codex', threadId: 'synthetic' } }],
      accountHome: { path: 'synthetic' },
      lease: { runtimeKind: 'tui', claimStatus: 'live', runtimeFence: 1 }
    })
  },
  session: () => ({ journal: { directory: 'synthetic' } }),
  schedule: queue.serialize.bind(queue),
  publish() {},
  reset() {}
})
await catchup.prepare('s', 1)
await catchup.activate('s')
const refs = []
async function sample() {
  await setImmediate()
  global.gc()
  global.gc()
  return {
    heapUsed: process.memoryUsage().heapUsed,
    liveMessages: refs.filter((ref) => ref.deref()).length
  }
}
const before = await sample()
function receiveMessages() {
  for (let i = 0; i < 200; i++) {
    const message = {
      id: `synthetic-${i}`,
      role: 'assistant',
      source: 'transcript',
      timestamp: null,
      blocks: [{ type: 'text', text: randomBytes(96 * 1024).toString('base64') }]
    }
    refs.push(new WeakRef(message))
    globalThis.auditTranscript.onAppend([message])
  }
}
receiveMessages()
const queued = await sample()
catchup.stop('s')
const stopped = await sample()
release()
await blocked
await queue.serialize('s', async () => {})
const drained = await sample()
assert.equal(queued.liveMessages, 200)
assert.equal(stopped.liveMessages, 200)
assert.equal(drained.liveMessages, 0)
const sources = Object.fromEntries(
  [
    'src/main/native-chat/agent-session-wire/structured-tui-transcript-catchup.ts',
    'src/main/native-chat/agent-session-wire/structured-agent-session-task-queue.ts',
    'src/main/cli/keyed-promise-queue.ts'
  ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])
)
console.log(
  JSON.stringify(
    {
      node: process.version,
      sources,
      inputBytes: 200 * 128 * 1024,
      before,
      queued,
      stopped,
      drained
    },
    null,
    2
  )
)
