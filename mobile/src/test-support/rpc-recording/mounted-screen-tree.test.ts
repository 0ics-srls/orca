import { resolve } from 'node:path'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { projectMountedScreen, renderedElementProps, screenMount } from './mounted-screen-tree'
import { pilotMountAdapters } from './pilot-mount-adapters'
import { runRecording } from './run-recording'
import { readScenarios } from './scenario-input'
import { vitestRecordingScheduler } from './vitest-recording-scheduler'

const root = resolve(import.meta.dirname, '../../../..')
const manifest = readScenarios(
  process.env.RPC_FOUNDATION_SCENARIOS ??
    resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json')
).scenarios

function Broken(): never {
  throw new Error('a reply took the screen down')
}

describe('a mounted screen', () => {
  it('records a crash as state instead of failing the run', () => {
    const screen = screenMount(() => createElement(Broken))
    screen.mount()
    expect(projectMountedScreen(screen)).toEqual({
      elements: {},
      text: [],
      labels: [],
      crash: 'a reply took the screen down'
    })
  })

  it('projects the elements, copy and labels of what rendered', () => {
    const screen = screenMount(() =>
      createElement(
        'View',
        null,
        createElement('Text', { accessibilityLabel: 'title' }, 'Files'),
        createElement('Text', null, 'orca-files')
      )
    )
    screen.mount()
    expect(projectMountedScreen(screen)).toEqual({
      elements: { View: 1, Text: 2 },
      text: ['Files', 'orca-files'],
      labels: ['title'],
      crash: null
    })
  })

  it('reads the props an inert element was handed, which is all a list ever renders', () => {
    const screen = screenMount(() =>
      createElement('View', null, createElement('FlatList', { data: [{ id: 'row-1' }] }))
    )
    screen.mount()
    expect(renderedElementProps(screen.tree(), 'FlatList')).toEqual([{ data: [{ id: 'row-1' }] }])
    expect(renderedElementProps(screen.tree(), 'SectionList')).toEqual([])
  })

  /**
   * The screen-mount capability end to end: the real panel, over the real host-client context, over
   * the scripted socket. Both worktree values on the wire are the adapter's declared prop, and the
   * fallback is reached only because the first request was refused.
   */
  it('sends what the screen sends, with no substitute shaping a param', async () => {
    const scenario = manifest.find(
      (candidate) => candidate.id === 'files-explorer-legacy-fallback'
    )!
    const { adapters } = pilotMountAdapters(root, { device: scenario })
    const recording = await runRecording(
      scenario,
      adapters[scenario.operation]!,
      vitestRecordingScheduler()
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a recorded sender entry has a name and three positional argument slots.
    const sender = recording.checkpoints.at(-1)!.observation.sender as {
      name: string
      args: { name: string; value: unknown }[]
    }[]
    expect(
      sender.map((entry) => ({
        name: entry.name,
        params: entry.args[1]?.value,
        options: entry.args[2]?.value
      }))
    ).toEqual([
      {
        name: 'files.readDir#1',
        params: { relativePath: '', worktree: 'id:wt-files' },
        options: { $rpc: 'absent' }
      },
      {
        name: 'files.list#1',
        params: { worktree: 'id:wt-files' },
        options: { $rpc: 'absent' }
      }
    ])
  })
})
