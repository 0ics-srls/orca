import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMonacoSetupSteps } from './monaco-setup-steps'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runMonacoSetupSteps', () => {
  it('runs every later step after one throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ran: string[] = []

    runMonacoSetupSteps([
      ['first', () => ran.push('first')],
      [
        'second',
        () => {
          throw new Error('registration exploded')
        }
      ],
      ['third', () => ran.push('third')]
    ])

    expect(ran).toEqual(['first', 'third'])
    expect(consoleError).toHaveBeenCalledWith('[Monaco Setup] second failed', expect.any(Error))
  })
})
