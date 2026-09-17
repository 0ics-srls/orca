# Withdrawn diff-model change control

Run from the repository root with the two named commits available:

```sh
ORCA_BACKGROUND_LAUNCH=1 REVIEW_VARIANT=base pnpm exec vitest run --config docs/audits/memory-pr-risk-review-2026-09-17/controls/20904.config.mjs
ORCA_BACKGROUND_LAUNCH=1 REVIEW_VARIANT=published pnpm exec vitest run --config docs/audits/memory-pr-risk-review-2026-09-17/controls/20904.config.mjs
```

The pre-PR hook must pass; the withdrawn published hook must fail: it cancels the timer that releases the two kept Monaco models. The test uses actual React callback-ref/unmount ordering and controlled model objects, with the exact selected hook loaded from Git. It is not a full historical app build or a native browser test. No visible app is launched.

This negative control is intentionally outside the default test suite. The original published failure is evidence for withdrawal, not a failing check proposed for merge.
