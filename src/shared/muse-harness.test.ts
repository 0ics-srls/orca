import { describe, expect, it } from 'vitest'
import {
  isExpectedAgentProcess,
  recognizeAgentProcess,
  recognizeAgentProcessFromCommandLine
} from './agent-process-recognition'
import { buildAgentStartupPlan } from './tui-agent-startup'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from './tui-agent-config'
import { resolveTuiAgentLaunchArgs } from './tui-agent-launch-defaults'

describe('Muse harness contract', () => {
  it('recognizes the versioned binary and ignores muse exec', () => {
    expect(recognizeAgentProcess('muse-bin-1.3.0')).toEqual({
      agent: 'muse',
      processName: 'muse-bin-1.3.0'
    })
    expect(recognizeAgentProcess('muse-bin-1.3.0-R3401.1.exe')).toEqual({
      agent: 'muse',
      processName: 'muse-bin-1.3.0-r3401.1'
    })
    expect(isExpectedAgentProcess('muse-bin-1.3.0', 'muse')).toBe(true)
    expect(isExpectedAgentProcess('muse-bin-1.3.0', 'claude')).toBe(false)
    expect(isExpectedAgentProcess('ante-obsidian', 'ante')).toBe(false)
    expect(recognizeAgentProcessFromCommandLine('muse --trust-workspace')).toEqual({
      agent: 'muse',
      processName: 'muse'
    })
    expect(recognizeAgentProcessFromCommandLine('muse exec say hello')).toBeNull()
    expect(recognizeAgentProcessFromCommandLine('muse --yolo exec say hello')).toBeNull()
    expect(recognizeAgentProcessFromCommandLine('muse resume last')).toEqual({
      agent: 'muse',
      processName: 'muse'
    })
  })

  it('trusts the workspace by default and passes --yolo only for full-auto', () => {
    expect(getTuiAgentLaunchCommand(TUI_AGENT_CONFIG.muse, 'darwin')).toBe('muse --trust-workspace')
    expect(getTuiAgentLaunchCommand(TUI_AGENT_CONFIG.muse, 'linux')).toBe('muse --trust-workspace')
    expect(resolveTuiAgentLaunchArgs('muse', { muse: '' })).toBe('')
    expect(resolveTuiAgentLaunchArgs('muse', { muse: '--yolo' })).toBe('--yolo')

    const manual = buildAgentStartupPlan({
      agent: 'muse',
      prompt: '',
      cmdOverrides: {},
      platform: 'darwin',
      allowEmptyPromptLaunch: true,
      agentArgs: ''
    })
    const fullAuto = buildAgentStartupPlan({
      agent: 'muse',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      shell: 'posix',
      allowEmptyPromptLaunch: true,
      agentArgs: '--yolo'
    })
    expect(manual?.launchCommand).toBe('muse --trust-workspace')
    expect(fullAuto?.launchCommand).toBe("muse --trust-workspace '--yolo'")
    expect(fullAuto?.launchCommand.includes('cmd //c')).toBe(false)
  })

  it('keeps a subcommand-shaped or multi-line prompt as the user task', () => {
    const subcommand = buildAgentStartupPlan({
      agent: 'muse',
      prompt: 'exec do the thing',
      cmdOverrides: {},
      platform: 'darwin'
    })
    const multiline = buildAgentStartupPlan({
      agent: 'muse',
      prompt: 'fix the bug\nstill the task',
      cmdOverrides: {},
      platform: 'darwin'
    })
    expect(subcommand?.followupPrompt).toBe('exec do the thing')
    expect(subcommand?.launchCommand).toBe('muse --trust-workspace')
    expect(multiline?.followupPrompt).toBe('fix the bug\nstill the task')
    expect(multiline?.launchCommand).toBe('muse --trust-workspace')
  })

  it('launches through cmd on Windows Git Bash and the native binary elsewhere', () => {
    const gitBash = buildAgentStartupPlan({
      agent: 'muse',
      prompt: '',
      cmdOverrides: {},
      platform: 'win32',
      shell: 'posix',
      allowEmptyPromptLaunch: true,
      agentArgs: '--yolo'
    })
    const powershell = buildAgentStartupPlan({
      agent: 'muse',
      prompt: '',
      cmdOverrides: {},
      platform: 'win32',
      shell: 'powershell',
      allowEmptyPromptLaunch: true
    })
    expect(gitBash?.launchCommand).toBe(
      "if command -v muse >/dev/null 2>&1; then exec muse --trust-workspace '--yolo'; else cmd //c muse --trust-workspace '--yolo'; fi"
    )
    expect(powershell?.launchCommand).toBe('muse --trust-workspace')
  })
})
