# Open-Source Community PR and Issue Maintenance Report

I inspected the local repositories and OpenClaw’s public repository guidance. I found no `../../hermes` directory, so I used `../../hermes-agent` as the likely intended project.

The strongest overall pattern is that these projects treat community maintenance as an intake-and-trust system, not merely “accept GitHub pull requests.”

## Executive summary

Across the projects, mature workflows consistently include:

- Separate channels for bugs, feature proposals, support, and design discussion.
- Structured issue forms requiring reproducible evidence.
- Explicit limits on contribution scope and queue size.
- Automated labeling, triage, stale handling, and routing.
- Trust or vouch systems for first-time contributors.
- Maintainer-owned release notes, branch control, and final merge decisions.
- Strong safeguards around untrusted issue/PR content and privileged automation.
- A preference for plugins, skills, or external repositories when core changes would increase maintenance burden.
- Mandatory visual or behavioral evidence for UI changes.
- Clear policies for AI-assisted contributions, varying from welcoming to restrictive.

## Repository-by-repository findings

### Herdr: closed, highly curated PR intake

Sources: [`../../herdr/CONTRIBUTING.md`](../../herdr/CONTRIBUTING.md), [`pr-gate.yml`](../../herdr/.github/workflows/pr-gate.yml), [`bug.yml`](../../herdr/.github/ISSUE_TEMPLATE/bug.yml)

Herdr has the most restrictive contribution model:

- Unsolicited PRs are not accepted.
- Only maintainers or contributors listed in `.github/APPROVED_CONTRIBUTORS` may submit implementation PRs.
- The approved-contributor list is curated and grants no implicit authority or scope.
- Reproducible bugs go through a factual bug template; the maintainer-controlled issue agent investigates and may create the fix PR itself.
- Feature ideas, proposals, questions, and non-reproducible reports go to Discussions.
- Contributors are explicitly told not to speculate about root cause or attach a proposed patch to bug reports.
- PRs must be focused, use lowercase conventional titles, reference issues using `refs #N`, and pass `just ci`.

The `pr-gate.yml` workflow enforces this policy on `pull_request_target`:

1. Fetches maintainers and approved contributors from the default branch.
2. Checks author permissions and allowlist membership.
3. Applies `ai-review` to trusted PRs.
4. Adds an idempotent explanatory comment and auto-closes untrusted PRs.
5. Leaves Dependabot/GitHub Actions bot PRs exempt.

This is a very clear trust boundary. It prevents maintainers from spending time reviewing work from unknown authors while still leaving a documented route for bug reports and discussion.

Herdr also has release linkage automation:

- Commit bodies containing exact `refs #N` references cause issues to receive `pending-release`.
- Issues are commented/closed when the corresponding release is published.
- CI validates commit subjects and PR titles across Ubuntu, macOS, and Windows, including Windows packaging/smoke tests.

Useful lesson for Orca: if core PR capacity is scarce, explicitly choose between open contribution and curated contribution. Do not leave contributors guessing.

### T3 Code: issue triage as a productized support workflow

Sources: [`../../t3code/.github/triage/PLAYBOOK.md`](../../t3code/.github/triage/PLAYBOOK.md), [`via-triage.yml`](../../t3code/.github/ISSUE_TEMPLATE/via-triage.yml), [`pr-vouch.yml`](../../t3code/.github/workflows/pr-vouch.yml)

T3 Code openly states that it is not actively accepting contributions:

- Bugs and reliability fixes are the most plausible candidates.
- Large features, drive-by changes, and speculative improvements are discouraged.
- Feature requests belong in Ideas Discussions.
- PRs require small scope, a clear “What Changed/Why,” and before/after screenshots or videos for UI changes.
- First-time contributors are marked `vouch:unvouched` until trusted.

The unusual and valuable part is its AI-assisted triage playbook. It is not just an issue template; it describes an end-to-end support procedure:

1. Ask the user to explain the problem in their own words.
2. Read a machine-facts context file.
3. Fetch the latest version of the playbook.
4. Clone the exact release tag matching the user’s installation.
5. Inspect logs, traces, SQLite, service state, ports, and installed agent CLIs.
6. Search upstream issues and newer releases.
7. Offer the user a choice: fix, file an issue, both, or neither.
8. Never patch the installed source as the diagnosis.
9. Show the complete issue text and obtain explicit approval before posting.
10. Redact secrets and home-directory paths.
11. Prefer adding evidence to an existing issue over opening duplicates.

The `via-triage` template captures:

- User description
- Diagnosis
- Deterministic reproduction
- Environment
- Evidence
- Related issues
- Workaround
- Agent/model provenance

Other automation:

- PR size labels are computed from effective changed lines, excluding whitespace and test-only paths.
- A thread-transfer report is generated after CI using trusted baseline code rather than executing PR code.
- Release workflows produce stable tags and scheduled/manual nightlies.

Useful lesson for Orca: support and issue filing can be treated as a controlled diagnostic workflow, with explicit consent before external actions.

### Superset: open contribution with AI triage

Sources: [`../../superset/CONTRIBUTING.md`](../../superset/CONTRIBUTING.md), [`triage-issue.yml`](../../superset/.github/workflows/triage-issue.yml), [`triage-issue.md`](../../superset/.github/prompts/triage-issue.md)

Superset uses a more open model:

- Small bug fixes, documentation, and focused improvements can be submitted directly.
- Larger features should begin with an issue.
- Questions are routed to Discord.
- PRs require conventional squash titles, one change per PR, test evidence, and maintainer-edit permission.
- UI changes should include screenshots or recordings.

Its most notable mechanism is automated issue triage:

- Runs when an issue opens, when it receives the `triage` label, or manually.
- Checks out repository code.
- Gives Claude only `Read`, `Glob`, and `Grep`.
- Does not provide shell access or the GitHub token to the model.
- Treats issue content as untrusted data.
- Posts the generated comment in a separate step using `GITHUB_TOKEN`.
- Refuses to post empty output or credential-like strings.
- Uses `NO_COMMENT` when no useful triage response can be produced.

The workflow prompt asks for:

- Issue summary
- Affected areas/files
- Likely root cause
- Reproduction
- Fix direction

Superset also has a thoughtful preview lifecycle:

- PRs create isolated previews for multiple surfaces.
- One tagged comment is updated rather than producing comment spam.
- Preview resources are cleaned up automatically when PRs close.

Useful lesson for Orca: AI can assist triage safely when it is read-only, isolated from credentials, and its output is validated before publication.

### Hermes Agent: explicit priorities and extension boundaries

Sources: [`../../hermes-agent/CONTRIBUTING.md`](../../hermes-agent/CONTRIBUTING.md), [`PULL_REQUEST_TEMPLATE.md`](../../hermes-agent/.github/PULL_REQUEST_TEMPLATE.md)

Hermes defines contribution priorities in order:

1. Bug fixes
2. Cross-platform compatibility
3. Security hardening
4. Performance and robustness
5. New skills
6. New tools
7. Documentation

It also provides architectural intake rules:

- Capabilities should usually be skills rather than core tools.
- Broadly useful official skills may be bundled.
- Specialized or community skills belong in a Skills Hub.
- New in-tree memory providers are no longer accepted; contributors should publish standalone plugins.
- Existing providers may receive bug fixes.

The PR template requires:

- Related issue
- Conventional commit
- Duplicate search
- Focused scope
- Tests, including platform testing
- Documentation/config/schema updates
- Screenshots/logs where appropriate
- Skill-specific end-to-end validation

The project also has a contributor provenance check:

- CI maps commit author emails to GitHub identities.
- Unmapped contributors cause the check to fail until attribution is configured.

Security and supply-chain maintenance is automated through:

- Lint and tests
- OSV scanning
- Supply-chain audits
- Release workflows with trusted publishing

Useful lesson for Orca: contribution policy should explain not only how to submit code, but where functionality belongs architecturally.

### cmux: high-process review and release governance

Sources: [`../../cmux/CONTRIBUTING.md`](../../cmux/CONTRIBUTING.md), [`pull_request_template.md`](../../cmux/.github/pull_request_template.md), [review-bot rules](../../cmux/.github/review-bot-rules/README.md)

cmux combines broad community intake with extensive process controls.

PR requirements include:

- Summary and motivation
- Tests and manual verification
- Demo video for UI changes
- Changelog/docs consideration
- Resolution of all bot and human review comments
- Explicit copy/paste triggers for review bots such as CodeRabbit, Greptile, and others

Its review-bot rules are unusually granular. They cover:

- Algorithmic complexity
- Accessibility
- Internationalization
- Concurrency and actor isolation
- Blocking runtime calls
- Test determinism
- Source-control artifacts
- Reliability and single-source-of-truth issues
- UI state/layout
- Package boundaries

The rules are stored on the base branch, preventing a PR from weakening its own review policy.

The CI and release system has strong safety properties:

- CODEOWNERS protects workflow and shipping-related files.
- Comments document that branch protection must require code-owner review.
- Changed-area detection fails open: if routing cannot be computed, all checks run.
- Release workflows use immutable-asset guards.
- Partial release states fail instead of silently rebuilding.
- Signing, notarization, attestations, and monotonic build checks are enforced.

The internal agent workflow in `CLAUDE.md` is also instructive:

- Main agent implements and opens the PR.
- A bounded review agent handles structured review and CI feedback.
- Repair agents are spawned only for failed checks.
- Parallel repair is avoided to prevent worktree races.
- The main agent owns dogfooding, approval, and merge.
- Runtime/UI changes require explicit approval after dogfooding.

Useful lesson for Orca: separate implementation, review, repair, dogfooding, and merge authority. Automation can accelerate review without making merge decisions autonomous.

### Ghostty: discussion-first design plus vouch governance

Sources: [`../../ghostty/CONTRIBUTING.md`](../../ghostty/CONTRIBUTING.md), [`issue-triage.yml`](../../ghostty/.github/DISCUSSION_TEMPLATE/issue-triage.yml), [`vouch-check-pr.yml`](../../ghostty/.github/workflows/vouch-check-pr.yml), [`AI_POLICY.md`](../../ghostty/AI_POLICY.md)

Ghostty distinguishes contribution types sharply:

- Actionable, reproducible bugs use Issue Triage Discussions.
- Feature design happens in Feature Request Discussions.
- An accepted, well-scoped feature issue is implemented by a PR.
- Q&A goes to Discussions or Discord.
- WIP/design PRs may be closed or become stale.
- Contributors are asked to search existing issues/discussions and use reactions instead of “+1” comments.
- Translation PRs have a separate path.

Ghostty uses a vouch model:

- First-time contributors open a Vouch Request Discussion.
- The contributor must use their own voice and follow the project’s AI rules.
- Maintainers issue `!vouch`.
- Unvouched PRs are automatically closed.
- Repeated low-quality or rule-breaking behavior can lead to denouncement and automatic closure of future interactions.
- Vouch state synchronizes with CODEOWNERS.

The issue triage form is comprehensive:

- Version
- OS
- Display server
- Window manager
- Minimal configuration
- Logs
- Reproduction
- Search/acknowledgement checkboxes

Ghostty’s AI policy is explicit:

- AI assistance must be disclosed, including extent.
- Contributors must understand and personally review generated code.
- AI-generated issue text requires human editing/review.
- AI-generated media is not accepted.
- Maintainers may be exempt.
- Repeated bad AI submissions can be publicly denounced.

Useful lesson for Orca: a discussion-first funnel prevents feature churn in the issue tracker, while vouching can protect a small maintainer team from low-context or abusive submissions.

## OpenClaw: strict routing, queue limits, and automation

Sources:

- [OpenClaw CONTRIBUTING.md](https://raw.githubusercontent.com/openclaw/openclaw/main/CONTRIBUTING.md)
- [OpenClaw PR template](https://raw.githubusercontent.com/openclaw/openclaw/main/.github/pull_request_template.md)
- [OpenClaw bug form](https://raw.githubusercontent.com/openclaw/openclaw/main/.github/ISSUE_TEMPLATE/bug_report.yml)
- [OpenClaw auto-response workflow](https://github.com/openclaw/openclaw/blob/main/.github/workflows/auto-response.yml)
- [OpenClaw stale workflow](https://github.com/openclaw/openclaw/blob/main/.github/workflows/stale.yml)

OpenClaw’s contribution guide is unusually explicit about routing:

- Bugs and small fixes can go directly to PR.
- Features and architecture changes should begin as an issue or Discord discussion.
- Questions go to Discord, not GitHub issues.
- Refactor-only PRs are rejected unless a maintainer requested them.
- Test/CI-only PRs for failures already present on `main` are rejected.
- New capabilities that belong as third-party plugins are redirected out of core.
- Agent-authored work should create or reuse an issue first unless it is a tiny bug fix.
- Contributors must keep PRs takeover-ready by enabling maintainer edits.
- Contributors do not edit `CHANGELOG.md`; maintainers or automation do that when landing changes.
- Visual changes require before/after screenshots.
- PRs are capped at 20 open PRs per author; excess PRs receive `r: too-many-prs` and are auto-closed.

The PR template is structured around durable reviewer context:

- What problem this solves
- Why the solution was chosen
- User impact
- Evidence

The bug form insists on grounded evidence:

- Bug type
- Summary
- Reproduction
- Expected vs. actual behavior
- Version, OS, install method
- Model/provider route
- Logs and screenshots
- Impact and severity
- Last-known-good/first-known-bad versions

A particularly strong detail is the instruction to write `NOT_ENOUGH_INFO` when an answer cannot be grounded in evidence. That discourages speculative incident narratives.

The automation layer includes:

- Label-driven auto-responses such as `r: support`, `r: skill`, `r: no-ci-pr`, and `r: third-party-extension`.
- Automatic closure and explanatory routing comments.
- Bug subtype labels derived from issue-form answers.
- Warnings for excessive maintainer mentions/spam-pinging.
- Stale issues after 7 days and stale PRs after 5 days.
- Closure shortly afterward with instructions to retry on the latest release.
- Closed issues are locked after 48 hours of inactivity.

This is a very high-throughput model: labels act as executable policy.

## Cross-project patterns worth adopting in Orca

### 1. Define an intake funnel

A practical Orca funnel could be:

| Report type | Destination | Required next step |
|---|---|---|
| Reproducible bug | Issue form | Version, environment, repro, logs |
| Feature/design proposal | Discussion or issue | Problem statement and alternatives |
| Setup/support question | Discord/help channel | No issue unless defect is found |
| Security report | Private security channel | Never public issue |
| Plugin/skill request | External registry/repository | Keep core lean |
| Small bug fix | PR | Link issue when context exists |

This combines the routing discipline of OpenClaw/Ghostty with the support workflow of T3 Code.

### 2. Make evidence the unit of triage

Require:

- Exact version/build
- Platform and install method
- Deterministic reproduction
- Expected and actual behavior
- Logs or screenshots
- Impact and frequency
- Last-known-good version for regressions

Avoid asking contributors to guess root causes. Let maintainers or a triage agent investigate.

### 3. Use automation as policy enforcement

Good candidates:

- Area labels from changed paths
- Bug subtype labels from issue-form answers
- PR size labels
- Duplicate reminders
- Stale handling
- Preview lifecycle cleanup
- Release milestone linkage
- Queue limits
- Auto-routing comments for support/plugin submissions

Any automation with write access should:

- Read untrusted issue/PR text as data.
- Avoid checking out or executing PR code in privileged contexts.
- Keep model/tool access read-only.
- Validate generated output before posting.
- Use idempotent comment markers.

### 4. Establish a contributor trust path

There are three viable models demonstrated here:

- Open intake: anyone may submit, with strong CI and review.
- Vouch intake: first-time contributors need an explicit trust signal.
- Curated intake: only approved contributors may open implementation PRs.

Orca should choose one deliberately rather than accidentally developing an inconsistent system.

### 5. Separate core changes from ecosystem changes

Hermes and OpenClaw both redirect specialized functionality to plugins/skills. This protects core maintainability while still welcoming ecosystem contributions.

For Orca, this could apply to:

- Skills
- Integrations
- Provider adapters
- Theme packs
- Optional automation backends
- Community-maintained extensions

### 6. Preserve maintainer ownership of releases

Several projects keep these areas maintainer-owned:

- Changelog entries
- Version bumps
- Release tags
- Signing/notarization
- Artifact publication
- Final merge
- Security-sensitive workflow files

Contributors provide evidence and focused patches; maintainers control what ships.

### 7. Treat UI evidence as mandatory

For UI changes, require:

- Before/after screenshots
- Short video for interactions or motion
- Manual verification steps
- Platform notes where relevant

This appears in T3 Code, Superset, Hermes, cmux, and OpenClaw.

### 8. Add an AI contribution policy

The projects span a spectrum:

- OpenClaw: AI PRs explicitly welcome, no disclosure label required, but evidence and understanding are required.
- Superset/T3 Code: AI assists internal triage under tool restrictions.
- Ghostty: AI disclosure and human review are mandatory.
- Herdr: automated trust gating is emphasized.

Orca should decide whether disclosure is required, but should require in all cases:

- Human ownership of the change
- Understanding of the code
- Reproducible validation
- No secrets in generated text
- Human approval before posting external comments/issues

## Suggested Orca operating model

A balanced model based on these projects would be:

1. Keep GitHub Issues for actionable bugs and accepted work.
2. Route questions and early feature ideas to Discussions/Discord.
3. Add structured bug, feature, support, and security forms.
4. Add a `via-triage` path for agent-assisted diagnosis.
5. Run read-only AI triage automatically on new issues.
6. Label by area, severity, regression status, and readiness.
7. Require evidence and before/after visuals for UI PRs.
8. Allow small bug PRs directly; require an issue for larger changes.
9. Redirect extensibility requests to a plugin/skill registry.
10. Add stale automation with generous exemptions for active/assigned/security work.
11. Add a contributor vouch or gradual-trust mechanism if review capacity becomes constrained.
12. Keep release, workflow, signing, and changelog changes maintainer-controlled.
13. Use idempotent automation comments and explicit queue limits.
14. Require explicit user approval before any agent posts an issue, comment, or PR.

The key design choice is governance posture: Herdr and Ghostty optimize for maintainer attention and trust; Superset and OpenClaw optimize for scalable automated routing; T3 Code optimizes for evidence-based support; Hermes optimizes for architectural boundaries. Orca can combine these without copying any one project wholesale.
