import { describe, expect, it } from 'vitest'
import {
  resolvedTuiAgentArgsBypassPermissions,
  resolveTuiAgentLaunchArgs,
  tuiAgentArgsBypassPermissions
} from './tui-agent-launch-defaults'

describe('tuiAgentArgsBypassPermissions', () => {
  // The Agent Permissions toggle has no storage of its own: Yolo is the presence of the agent's
  // bypass flag in the arguments string, wherever the user has written the rest of the field.
  it.each([
    ['claude', '--dangerously-skip-permissions', true],
    ['claude', '--dangerously-skip-permissions --model Opus', true],
    ['claude', '--model Opus --dangerously-skip-permissions', true],
    ['claude', '', false],
    ['claude', '--model Opus', false],
    // A token boundary, so a longer flag that merely starts the same way is not a bypass.
    ['claude', '--dangerously-skip-permissions-not-really', false],
    [
      'claude',
      '--append-system-prompt "mention --dangerously-skip-permissions only as text"',
      false
    ],
    ['claude', '-- --dangerously-skip-permissions', false],
    ['codex', '--dangerously-bypass-approvals-and-sandbox --model gpt-5.6-sol', true],
    ['codex', '--model gpt-5.6-sol', false],
    ['codex', '-- --dangerously-bypass-approvals-and-sandbox', false]
  ] as const)('reads %s args %s as %s', (agent, args, expected) => {
    expect(tuiAgentArgsBypassPermissions(agent, args, 'posix')).toBe(expected)
  })

  it('reads no bypass out of an absent or non-string value', () => {
    expect(tuiAgentArgsBypassPermissions('claude', null, 'posix')).toBe(false)
    expect(tuiAgentArgsBypassPermissions('claude', undefined, 'posix')).toBe(false)
  })

  it('uses the configured local Windows shell family', () => {
    expect(
      resolvedTuiAgentArgsBypassPermissions(
        'claude',
        {
          agentDefaultArgs: { claude: '`--dangerously-skip-permissions' },
          terminalWindowsShell: 'powershell.exe'
        },
        'win32'
      )
    ).toBe(true)
    expect(
      resolvedTuiAgentArgsBypassPermissions(
        'codex',
        {
          agentDefaultArgs: { codex: '^--dangerously-bypass-approvals-and-sandbox' },
          terminalWindowsShell: 'cmd.exe'
        },
        'win32'
      )
    ).toBe(true)
    expect(
      resolvedTuiAgentArgsBypassPermissions(
        'claude',
        {
          agentDefaultArgs: { claude: '`--dangerously-skip-permissions' },
          terminalWindowsShell: 'powershell.exe'
        },
        'darwin'
      )
    ).toBe(false)
  })
})

/**
 * What the reader answers vs. what Claude actually does with the same argv.
 *
 * `truth` was measured against Claude 2.1.270 by reading `permissionMode` off the `init` event of
 * `claude -p --output-format stream-json --verbose <args>`, with `(no args)` → `default` and
 * `--dangerously-skip-permissions` → `bypassPermissions` as the controls that prove the
 * instrument discriminates. `agrees: false` marks the one case the reader still gets wrong; see
 * the KNOWN LIMIT on tuiAgentArgsBypassPermissions.
 */
const BYPASS_VECTORS = [
  { field: '--dangerously-skip-permissions', truth: true, reads: true, agrees: true },
  { field: '', truth: false, reads: false, agrees: true },
  { field: '--model Opus', truth: false, reads: false, agrees: true },
  // The flag written as the VALUE of a value-taking option: Claude appends it to the system
  // prompt and stays on `default`. The reader has no arity, so it reports a bypass.
  {
    field: '--append-system-prompt "--dangerously-skip-permissions"',
    truth: false,
    reads: true,
    agrees: false
  },
  // Same argv as above, spelled without quotes — the whole-string reader missed this one too.
  {
    field: '--append-system-prompt --dangerously-skip-permissions',
    truth: false,
    reads: true,
    agrees: false
  },
  // Quoting the whole flag is still the flag once the startup path re-quotes argv.
  { field: '"--dangerously-skip-permissions"', truth: true, reads: true, agrees: true },
  { field: "'--dangerously-skip-permissions'", truth: true, reads: true, agrees: true },
  // Prose that merely names the flag, and operands after `--`, are not options.
  {
    field: '--append-system-prompt "Discuss --dangerously-skip-permissions carefully"',
    truth: false,
    reads: false,
    agrees: true
  },
  { field: '-- --dangerously-skip-permissions', truth: false, reads: false, agrees: true },
  { field: '--dangerously-skip-permissions -- foo', truth: true, reads: true, agrees: true }
] as const

describe('tuiAgentArgsBypassPermissions against the real CLI', () => {
  // Same answer on every shell: the field is Orca's own setting, re-quoted per shell at launch,
  // so one spelling must not mean different postures on different machines.
  it.each(['posix', 'powershell', 'cmd'] as const)('reads the same on %s', (shell) => {
    for (const { field, reads } of BYPASS_VECTORS) {
      expect(tuiAgentArgsBypassPermissions('claude', field, shell), field).toBe(reads)
    }
  })

  it('matches Claude everywhere except the documented arity case', () => {
    const disagreements = BYPASS_VECTORS.filter(({ truth, reads }) => truth !== reads)
    expect(disagreements.map(({ field }) => field)).toEqual(
      BYPASS_VECTORS.filter(({ agrees }) => !agrees).map(({ field }) => field)
    )
    // Pin the count so widening the blind spot cannot land quietly.
    expect(disagreements).toHaveLength(2)
  })
})

describe('resolveTuiAgentLaunchArgs', () => {
  // A terminal launch still applies the whole configured string verbatim; only the structured
  // route stopped reading it.
  it('hands the configured arguments to a terminal launch unchanged', () => {
    expect(
      resolveTuiAgentLaunchArgs('claude', {
        claude: '--dangerously-skip-permissions --model Opus'
      })
    ).toBe('--dangerously-skip-permissions --model Opus')
  })

  it('falls back to the agent default when nothing is configured', () => {
    expect(resolveTuiAgentLaunchArgs('claude', {})).toBe('--dangerously-skip-permissions')
    expect(resolveTuiAgentLaunchArgs('claude', { claude: '' })).toBe('')
  })
})
