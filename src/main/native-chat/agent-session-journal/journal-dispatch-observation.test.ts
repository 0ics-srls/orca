import { describe, expect, it } from 'vitest'
import { latestJournalDispatchObservation } from './journal-dispatch-observation'

describe('latestJournalDispatchObservation', () => {
  it('uses the newest submission in the requested fence', () => {
    const journal = {
      submissions: () => [
        {
          fence: 7,
          dispatchState: 'unknown' as const,
          recovered: true as const,
          submittedAt: 1
        },
        {
          fence: 8,
          dispatchState: 'pending' as const,
          submittedAt: 2
        },
        {
          fence: 7,
          dispatchState: 'accepted' as const,
          submittedAt: 1
        }
      ]
    }

    expect(latestJournalDispatchObservation(journal, 7)).toEqual({
      state: 'accepted',
      recovered: false
    })
    expect(latestJournalDispatchObservation(journal, 8)).toEqual({
      state: 'pending',
      recovered: false
    })
  })

  it('returns no observation when the fence has no submission', () => {
    expect(latestJournalDispatchObservation({ submissions: () => [] }, 7)).toBeNull()
  })
})
