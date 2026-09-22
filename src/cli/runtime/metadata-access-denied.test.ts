import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMetadata, tryReadMetadata } from './metadata'
import { getCliStatus } from './status'

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))
afterEach(() => vi.resetAllMocks())

function failRead(code: string): void {
  vi.mocked(readFileSync).mockImplementation(() => {
    throw Object.assign(new Error(`${code}: /private/metadata.json`), { code })
  })
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('runtime metadata access denied', () => {
  it.each(['EPERM', 'EACCES'])(
    'reports a %s read as denied in both readers and status',
    async (code) => {
      failRead(code)
      const expected = {
        code: 'runtime_access_denied',
        data: { operation: 'read_metadata', systemCode: code, processState: 'unverifiable' }
      }

      for (const read of [readMetadata, tryReadMetadata]) {
        expect(thrownBy(() => read('/test'))).toMatchObject(expected)
      }
      await expect(getCliStatus('/test')).rejects.toMatchObject(expected)
    }
  )

  it('keeps absent metadata as not_running', async () => {
    failRead('ENOENT')

    expect(tryReadMetadata('/test')).toBeNull()
    expect(() => readMetadata('/test')).toThrowError(
      expect.objectContaining({ code: 'runtime_unavailable' })
    )
    await expect(getCliStatus('/test')).resolves.toMatchObject({
      result: { runtime: { state: 'not_running' } }
    })
  })

  it('keeps malformed metadata handling', () => {
    vi.mocked(readFileSync).mockReturnValue('invalid JSON')

    expect(tryReadMetadata('/test')).toBeNull()
    expect(() => readMetadata('/test')).toThrow('Could not read Orca runtime metadata')
  })
})
