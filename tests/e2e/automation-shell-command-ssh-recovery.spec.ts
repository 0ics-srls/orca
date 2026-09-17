import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetCommand,
  shellQuote,
  startDockerSshRelayTarget,
  writeDockerSshRelayTargetFile
} from './helpers/docker-ssh-relay-target'

test('SSH shell automation retains completion and output across renderer reload', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.skip(process.env.ORCA_E2E_SSH_DOCKER !== '1', 'Requires the Docker SSH fixture')
  test.slow()
  const target = startDockerSshRelayTarget(testInfo)
  registerPostElectronShutdownCleanup(async () => cleanupDockerSshRelayTarget(target))
  const counterPath = '/tmp/orca-shell-automation-launches'
  const releasePath = '/tmp/orca-shell-automation-release'
  const finishedPath = '/tmp/orca-shell-automation-finished'
  const scriptPath = '/tmp/orca-shell-automation-command.sh'
  const startMarker = 'ORCA_SSH_SHELL_BEFORE_RELOAD'
  const endMarker = 'ORCA_SSH_SHELL_AFTER_RELOAD'
  writeDockerSshRelayTargetFile(
    target,
    scriptPath,
    [
      `printf 'launch\\n' >> ${shellQuote(counterPath)}`,
      `printf '%s\\n' ${shellQuote(startMarker)}`,
      `while [ ! -f ${shellQuote(releasePath)} ]; do sleep 0.05; done`,
      `printf '%s\\n' ${shellQuote(endMarker)}`,
      `touch ${shellQuote(finishedPath)}`
    ].join('\n')
  )
  await waitForSessionReady(orcaPage)
  await connectDockerSshRelayTarget(orcaPage, target, { relayGracePeriodSeconds: 0 })
  await orcaPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    store.getState().openAutomationsPage()
  })
  await orcaPage.getByRole('button', { name: 'Add new', exact: true }).click()
  const dialog = orcaPage.getByRole('dialog', { name: /^(Create|Edit) automation$/ })
  await dialog.locator('button[data-agent-combobox-root="true"]').click()
  await orcaPage.getByRole('option', { name: 'Blank Terminal', exact: true }).click()
  const name = 'SSH shell reload'
  await dialog.getByRole('textbox', { name: 'Automation name' }).fill(name)
  const commandEditor = dialog.getByRole('textbox', { name: /^Shell command/ })
  await commandEditor.focus()
  await commandEditor.pressSequentially(`bash ${shellQuote(scriptPath)}`)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
  await orcaPage.getByText(name, { exact: true }).click()
  await orcaPage.getByRole('button', { name: 'Run Now', exact: true }).click()
  await expect
    .poll(
      () =>
        execDockerSshRelayTargetCommand(
          target,
          `test -f ${shellQuote(counterPath)} && echo yes || echo no`
        ) === 'yes',
      { timeout: 30_000 }
    )
    .toBe(true)
  await orcaPage.getByRole('tab', { name: /^Runs/ }).click()
  await expect(
    orcaPage.getByRole('tabpanel').getByRole('button', { name: /Launched/ })
  ).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('ssh-shell-before-reload.png') })

  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable after reload')
    }
    store.getState().openAutomationsPage()
  })
  await orcaPage.getByText(name, { exact: true }).click()
  await orcaPage.getByRole('tab', { name: /^Runs/ }).click()
  await expect(
    orcaPage.getByRole('tabpanel').getByRole('button', { name: /Launched/ })
  ).toBeVisible()
  execDockerSshRelayTargetCommand(target, `touch ${shellQuote(releasePath)}`)
  await expect
    .poll(
      () =>
        execDockerSshRelayTargetCommand(
          target,
          `test -f ${shellQuote(finishedPath)} && echo yes || echo no`
        ) === 'yes'
    )
    .toBe(true)
  expect(execDockerSshRelayTargetCommand(target, `cat ${shellQuote(counterPath)}`)).toBe('launch')

  await expect(orcaPage.getByText('1 run · 1 completed', { exact: true })).toBeVisible({
    timeout: 30_000
  })
  await orcaPage.getByRole('tabpanel').getByRole('button', { name: /Done/ }).click()
  await expect(orcaPage.getByText(startMarker, { exact: false })).toBeVisible()
  await expect(orcaPage.getByText(endMarker, { exact: false })).toBeVisible()
  expect(execDockerSshRelayTargetCommand(target, `cat ${shellQuote(counterPath)}`)).toBe('launch')
  await orcaPage.screenshot({ path: testInfo.outputPath('ssh-shell-after-reload.png') })
})
