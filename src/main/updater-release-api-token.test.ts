import { beforeEach, describe, expect, it, vi } from 'vitest'

const ghExecMock = vi.fn()
vi.mock('./git/runner', () => ({
  ghExecFileAsync: (...args: unknown[]) => ghExecMock(...args)
}))

const { _resetReleaseApiTokenCache, rejectReleaseApiToken, resolveReleaseApiToken } =
  await import('./updater-release-api-token')

const T0 = 1_000_000
const TTL_MS = 5 * 60_000

describe('resolveReleaseApiToken', () => {
  beforeEach(() => {
    ghExecMock.mockReset()
    _resetReleaseApiTokenCache()
  })

  it('reads the github.com token through gh and trims it', async () => {
    ghExecMock.mockResolvedValue({ stdout: 'gho_abc\n', stderr: '' })

    await expect(resolveReleaseApiToken(T0)).resolves.toBe('gho_abc')

    expect(ghExecMock.mock.calls[0][0]).toEqual(['auth', 'token', '--hostname', 'github.com'])
    expect(ghExecMock.mock.calls[0][1]).toMatchObject({ idempotent: false })
  })

  it('serves the cached token within its TTL and re-reads after it', async () => {
    ghExecMock.mockResolvedValue({ stdout: 'gho_abc', stderr: '' })

    await resolveReleaseApiToken(T0)
    await resolveReleaseApiToken(T0 + TTL_MS - 1)
    expect(ghExecMock).toHaveBeenCalledTimes(1)

    await resolveReleaseApiToken(T0 + TTL_MS + 1)
    expect(ghExecMock).toHaveBeenCalledTimes(2)
  })

  // Why: gh missing or logged out is the unauthenticated path the picker always
  // had; it must not fail the list, and it must not spawn gh on every click.
  it('returns null when gh is missing or logged out and does not re-spawn within the TTL', async () => {
    ghExecMock.mockRejectedValueOnce(new Error('gh: not found'))

    await expect(resolveReleaseApiToken(T0)).resolves.toBeNull()
    await expect(resolveReleaseApiToken(T0 + TTL_MS - 1)).resolves.toBeNull()
    expect(ghExecMock).toHaveBeenCalledTimes(1)

    ghExecMock.mockResolvedValueOnce({ stdout: 'gho_new', stderr: '' })
    await expect(resolveReleaseApiToken(T0 + TTL_MS + 1)).resolves.toBe('gho_new')
  })

  it('treats empty output as no token', async () => {
    ghExecMock.mockResolvedValue({ stdout: '\n', stderr: '' })

    await expect(resolveReleaseApiToken(T0)).resolves.toBeNull()
  })

  it('shares one in-flight read between concurrent callers', async () => {
    let finish: (value: { stdout: string; stderr: string }) => void = () => {}
    ghExecMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )

    const first = resolveReleaseApiToken(T0)
    const second = resolveReleaseApiToken(T0)
    finish({ stdout: 'gho_abc', stderr: '' })

    await expect(Promise.all([first, second])).resolves.toEqual(['gho_abc', 'gho_abc'])
    expect(ghExecMock).toHaveBeenCalledTimes(1)
  })

  // Why: a token GitHub rejected would otherwise be re-read from the keyring
  // and re-sent on every load — one gh spawn and one wasted request each time.
  it('goes unauthenticated for a TTL after the token is rejected', async () => {
    ghExecMock.mockResolvedValue({ stdout: 'gho_stale', stderr: '' })
    await expect(resolveReleaseApiToken(T0)).resolves.toBe('gho_stale')

    rejectReleaseApiToken(T0)

    await expect(resolveReleaseApiToken(T0 + TTL_MS - 1)).resolves.toBeNull()
    expect(ghExecMock).toHaveBeenCalledTimes(1)
    await expect(resolveReleaseApiToken(T0 + TTL_MS + 1)).resolves.toBe('gho_stale')
    expect(ghExecMock).toHaveBeenCalledTimes(2)
  })
})
