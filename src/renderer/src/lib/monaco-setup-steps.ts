export type MonacoSetupStep = readonly [name: string, setup: () => void]

// Why: these registrations are independent and optional, so one throwing must not skip the
// rest or abort the module import that every editor surface depends on.
export function runMonacoSetupSteps(steps: readonly MonacoSetupStep[]): void {
  for (const [name, setup] of steps) {
    try {
      setup()
    } catch (error) {
      console.error(`[Monaco Setup] ${name} failed`, error)
    }
  }
}
