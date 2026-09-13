/** Five live panes used to exercise coordinator pruning and store-update gating.
 *  Data only — the test owns the seeding, which mutates its own store mock. */
export const MANY_PANES = [
  { tabId: 'tab-1', leafId: '11111111-1111-4111-8111-111111111111', ptyId: 'pty-1' },
  { tabId: 'tab-2', leafId: '22222222-2222-4222-8222-222222222222', ptyId: 'pty-2' },
  { tabId: 'tab-3', leafId: '33333333-3333-4333-8333-333333333333', ptyId: 'pty-3' },
  { tabId: 'tab-4', leafId: '44444444-4444-4444-8444-444444444444', ptyId: 'pty-4' },
  { tabId: 'tab-5', leafId: '55555555-5555-4555-8555-555555555555', ptyId: 'pty-5' }
]
