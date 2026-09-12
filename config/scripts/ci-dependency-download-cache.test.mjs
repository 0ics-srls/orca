import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const read = (path) => parse(readFileSync(path, 'utf8'))
const workflow = (name) => read(`.github/workflows/${name}.yml`)
const action = read('.github/actions/install-node-dependencies/action.yml')

describe('CI dependency download caches', () => {
  it('scopes desktop stores to the root lockfile and lets mixed installs opt in', () => {
    expect(action.inputs['cache-dependency-path'].default).toBe('pnpm-lock.yaml')
    for (const step of action.runs.steps.filter((step) => step.uses === 'actions/setup-node@v6')) {
      expect(step.with.cache).toBe('pnpm')
      expect(step.with['cache-dependency-path']).toBe('${{ inputs.cache-dependency-path }}')
    }
    const install = action.runs.steps.find((step) => step.name === 'Install dependencies')
    expect(install.if).toBeUndefined()
    expect(install.run).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(install.run).toContain(
      'diff --exit-code -- package.json pnpm-lock.yaml pnpm-workspace.yaml'
    )
    const mobile = workflow('mobile').jobs.verify.steps.find((step) =>
      step.uses?.includes('install-node-dependencies')
    )
    expect(mobile.with['cache-dependency-path'].trim().split('\n')).toEqual([
      'pnpm-lock.yaml',
      'mobile/pnpm-lock.yaml'
    ])
  })
})

describe('release install targets', () => {
  const targetFlags = ['--os=current,darwin,linux,win32', '--cpu=current,x64,arm64']

  it.each([
    'adhoc-mac-build',
    'daily-mac-build',
    'hourly-mac-build',
    'release-mac-build',
    'release-cut',
    'dev-channel-win-build',
    'windows-signing-rehearsal'
  ])('%s keeps cross-target packaging dependencies', (name) => {
    const installs = Object.values(workflow(name).jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.with?.command?.startsWith('pnpm install '))
    expect(installs.length).toBeGreaterThan(0)
    for (const step of installs) {
      for (const flag of targetFlags) {
        expect(step.with.command).toContain(flag)
      }
    }
  })

  it('offers the same targets for local cross-target packaging', () => {
    const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts['install:release']
    for (const flag of targetFlags) {
      expect(script).toContain(flag)
    }
  })

  it('keeps installed Windows addon checks in the Windows CI lane', () => {
    const steps = Object.values(workflow('pr').jobs).flatMap((job) => job.steps ?? [])
    const test = steps.find((step) => step.name === 'Test Windows-specific boundaries')
    expect(test.run).toContain('config/scripts/windows-process-tree-gyp-path.test.mjs')
    expect(test.run).toContain('config/scripts/windows-process-tree-gyp-rebuild.test.mjs')
    expect(test.run).toContain('config/scripts/package-electron-runtime-contract.test.mjs')
    expect(test.run).toContain('config/scripts/electron-builder-runtime-resources.test.mjs')
  })
})
