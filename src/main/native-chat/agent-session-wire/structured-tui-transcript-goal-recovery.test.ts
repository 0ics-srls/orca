import { appendFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { parseCodexGoalJournalItemId } from '../../../shared/codex-goal-journal-identity'
import { projectStructuredItemsToNativeChat } from '../../../shared/structured-agent-session-projection'
import { stripNoiseMessages } from '../../../shared/native-chat-noise'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import { StructuredTuiTranscriptCatchup } from './structured-tui-transcript-catchup'
import { createTuiTranscriptTeardownFixture } from './structured-tui-transcript-teardown-test-fixture'
import {
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD
} from './structured-agent-session-host-test-data'

it('replays the durable handoff boundary across two restarts without inventing goal transitions', async () => {
  const fixture = await createTuiTranscriptTeardownFixture()
  await fixture.requestHandoff()
  fixture.host['handoffs'].stopTuiHistoryCatchup()
  const session = fixture.host['sessions'].get(SESSION)
  const fence = fixture.store.getRecord(SESSION)?.lease.runtimeFence
  if (!session || fence === undefined) {
    throw new Error('Missing TUI owner')
  }
  const line = (status: string, tokensUsed = 0) =>
    `${JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'thread_goal_updated',
        threadId: THREAD,
        goal: {
          threadId: THREAD,
          objective: 'Keep the scratch folder tidy.',
          status,
          tokensUsed,
          createdAt: 1790073005
        }
      }
    })}\n`
  await appendFile(fixture.rollout, line('active') + line('active', 10) + line('paused', 10))
  const recover = async () => {
    const catchup = new StructuredTuiTranscriptCatchup({
      store: fixture.store,
      session: () => session,
      schedule: (_sessionId, task) => task(),
      publish: () => {},
      reset: () => {}
    })
    try {
      await catchup.recover(SESSION, fence)
      await catchup.activate(SESSION)
    } finally {
      catchup.stopAll()
    }
  }
  const goalItems = () =>
    session.journal.snapshot().items.filter((item) => parseCodexGoalJournalItemId(item.itemId))
  const visibleGoals = () => stripNoiseMessages(projectStructuredItemsToNativeChat(goalItems()))
  await recover()
  expect(goalItems()).toHaveLength(3)
  // Older clients ignore goal metadata and retain all three readable system rows.
  const legacyMessages = projectStructuredItemsToNativeChat(goalItems()).map((message) => ({
    ...message,
    codexGoal: undefined
  }))
  expect(stripNoiseMessages(legacyMessages)).toHaveLength(3)
  expect(visibleGoals().map((message) => message.blocks[0])).toEqual([
    { type: 'text', text: 'Goal set: Keep the scratch folder tidy.' },
    { type: 'text', text: 'Goal paused: Keep the scratch folder tidy.' }
  ])
  const ids = goalItems().map((item) => item.itemId)
  for (let restart = 0; restart < 2; restart++) {
    const previous = session.journal
    await previous.close()
    session.journal = await openAgentSessionJournal({
      journalDir: previous.directory,
      identity: previous['identity']
    })
    await recover()
    expect(goalItems().map((item) => item.itemId)).toEqual(ids)
    expect(visibleGoals()).toHaveLength(2)
  }
  await appendFile(fixture.rollout, line('active', 20))
  await recover()
  expect(goalItems()).toHaveLength(4)
  expect(visibleGoals().map((message) => message.blocks[0])).toEqual([
    { type: 'text', text: 'Goal set: Keep the scratch folder tidy.' },
    { type: 'text', text: 'Goal paused: Keep the scratch folder tidy.' },
    { type: 'text', text: 'Goal set: Keep the scratch folder tidy.' }
  ])
})
