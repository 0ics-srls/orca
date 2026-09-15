# Community PR Triage Instructions

Review every currently open pull request created within the last four weeks, including drafts, and generate a decision-ready PR triage dashboard.

The instruction is Markdown, but the final report must be a standalone HTML file named `community-pr-triage-report.html`.

## Scope and Safety

- Calculate and state the exact four-week date range used, including the timezone.
- Include open PRs whose creation timestamp falls within that range.
- Do not include an older PR merely because it was recently updated.
- When an older open PR materially overlaps an in-scope PR, include it as related context without counting it in the four-week totals or full individual triage.
- Include draft PRs and clearly identify them as drafts.
- Do not merge, close, edit, label, approve, or comment on any PR.
- Do not send messages to PR authors or other people.

## Outcome

Make it easy to decide:

- What needs immediate attention
- Which PRs should be reviewed together
- Which PRs can be landed as a coordinated batch or sequence
- Which implementation to choose when PRs compete or overlap
- What should be reviewed or merged soon
- What needs a product or technical decision
- What can wait
- What should potentially be closed

The primary question is not merely “What should we do with each PR?” It is: **What is the best overall solution to each problem, and which combination of PRs gets us there?**

## Workflow

### Phase 1: Build the complete inventory

Before delegating detailed reviews:

1. Fetch the full list of in-scope PRs and record their number, title, URL, author, creation date, draft status, labels, changed files, linked issues, review state, checks, mergeability, and GitHub author association.
2. Preserve this inventory as the completeness checklist for the final reduce pass.
3. Batch GitHub requests where practical and avoid unnecessary API calls.
4. Mark unavailable or unverifiable information as `Unknown` rather than guessing.

### Phase 2: Form provisional clusters

Use the inventory, linked issues, affected workflows, changed files, and PR descriptions to form provisional problem-oriented clusters before assigning detailed work.

Do not split obviously duplicate, competing, dependent, overlapping, or complementary PRs across unrelated review batches.

### Phase 3: Divide and conquer

Use Codex sub-agents to investigate clusters in parallel:

- Assign whole clusters to sub-agents whenever possible.
- Batch unrelated standalone PRs only when needed for even distribution.
- Ask each sub-agent to review the diff, discussions, checks, linked issues, relevant code, impact, risks, readiness, and relationships within its assigned cluster.
- Require evidence links and structured findings so results can be compared consistently.

### Phase 4: Reduce, cross-check, and calibrate

The primary agent must perform a final pass that:

- Applies one consistent prioritization standard across all clusters
- Detects cross-cluster duplicates, dependencies, and competing implementations
- Moves PRs when the initial clustering was wrong
- Resolves inconsistent or conflicting sub-agent assessments
- Confirms every in-scope PR appears exactly once in one primary cluster
- Confirms every identifiable linked issue is included
- Separates business priority, implementation readiness, and review size
- Produces one cohesive report rather than concatenated sub-agent reports

## Evidence Required for Each PR

Do not rely only on the title or description. Inspect enough evidence to understand:

- The actual behavior added, removed, or changed in the diff
- The problem or opportunity addressed
- Reviews, discussions, and unresolved feedback
- CI checks and test coverage
- Linked and clearly related issues
- Issues mentioned in descriptions, comments, commit messages, or closing keywords
- Related, duplicate, dependent, or competing PRs
- Merge conflicts and GitHub mergeability state
- Relevant surrounding code and architectural fit
- Expected users, user impact, and business value
- Alignment with the current product stack
- Local, folder-workspace, SSH/remote, mixed-version, and cross-platform implications where relevant

Link material evidence in the report. Important conclusions should be traceable to a PR, issue, review, discussion, check, or relevant code location. Do not equate GitHub's mergeable state with being safe or ready to land.

## Linked Issues

For every linked or clearly related issue, capture:

- Clickable issue number
- Issue title
- Current status, when available
- Relationship to the PR: `Fixes`, `Partially addresses`, `Related`, or `Unclear`

If no issue can be identified, write `None found`. Do not invent an issue relationship.

## Clustering Rules

Group PRs by the underlying problem or product outcome they address. Do not cluster PRs merely because they touch the same files, use the same label, or belong to the same broad product area.

Classify relationships within each cluster:

- `Complementary`: PRs solve different parts of the same problem and may be landed together
- `Dependent`: one PR should land before another
- `Overlapping`: PRs implement some of the same behavior
- `Competing`: PRs propose different solutions to the same problem
- `Duplicate`: one PR likely supersedes another
- `Related`: PRs share context but can be reviewed independently
- `Standalone`: the PR has no meaningful relationship to another in-scope PR

Do not force unrelated PRs together. A cluster may contain one standalone PR.

For every multi-PR cluster, determine whether to:

- Review and land the PRs as a coordinated batch
- Land them in a specific dependency order
- Choose one implementation and supersede the others
- Ask authors to consolidate overlapping work
- Review the PRs independently
- Defer the cluster pending a product or architectural decision

“Land together” means a coordinated review and merge plan, not necessarily combining all commits into one PR. Account for dependencies, overlapping changes, merge conflicts, CI, regressions, and the safest landing order.

## Assessment Dimensions

Assess the cluster's combined priority and each PR's individual priority. PRs within one cluster do not need the same priority.

### Priority

#### P0 — Urgent or strategically critical

Assign P0 only when at least one of these applies:

- Fixes severe or widespread breakage in a core workflow, such as Claude Code, Codex, terminals, workspace creation, or remote execution being unusable for many users
- Addresses a serious security, data-loss, reliability, or release-blocking issue
- Delivers a time-sensitive enterprise or governance capability with strong business justification
- Directly unblocks a critical company initiative that cannot proceed without it

State the concrete urgency. Roadmap alignment alone does not make a PR P0.

#### P1 — High impact

Use P1 for:

- Major improvements to important workflows
- Fixes affecting a meaningful user segment
- High-value roadmap work with substantial expected impact
- Work that unlocks other high-priority development
- Significant enterprise or operational value that is not an immediate emergency

#### P2 — Useful and practical

Use P2 for:

- Clear but limited user or business value
- Small, safe, worthwhile improvements
- Quality, usability, maintainability, documentation, or edge-case improvements
- Nice-to-have work with reasonable business justification

#### P3 — Low value or questionable investment

Use P3 when:

- User or business justification is weak or absent
- The affected use case is extremely narrow
- The PR is stale, superseded, duplicative, or misaligned with current direction
- Maintenance or architectural cost appears greater than the benefit
- The PR may be an appropriate closure candidate

Explain whether the best next action is clarification, deferral, consolidation, superseding, or closure.

### Readiness

Use exactly one value:

- `Ready`
- `Minor changes needed`
- `Substantial changes needed`
- `Blocked`
- `Draft/early`
- `Unclear`

### Review Size

Estimate conceptual review and integration effort, not only changed-line count:

- `S`: contained change with a small review surface and low integration burden
- `M`: moderate scope, multiple components, or meaningful behavioral risk
- `L`: broad or architectural change requiring substantial review, coordination, or validation

### Confidence

Rate each assessment:

- `High`: supported by clear code, issue, review, and check evidence
- `Medium`: core behavior is understood but some impact or readiness details remain uncertain
- `Low`: important context is missing or the intent and effect cannot be verified confidently

Explain the uncertainty for every `Low` confidence assessment.

## Current Product Stack Rank

Use this ordering as strategic context, not as an automatic priority assignment. Severity and demonstrated user impact can override roadmap position.

1. Plugins
2. Automated release pipeline
3. Agent management and search
4. SSH/remote re-architecture
   - Create a non-Electron `orcad`
   - Decide whether `orcad` should also run locally
   - Evaluate moving it to Bun while accounting for native dependencies
   - Consolidate SSH logic
5. Cloud VMs, including Vercel Sandbox and enterprise support
6. Profile and resource management
   - Work and personal profiles
   - Per-server profiles
7. Open-source the Relay
   - Determine licensing
8. Chat UI
9. Enterprise governance
10. Orchestration and Orca CLI
11. Mobile
    - OTA re-architecture
12. Orca inbound and outbound endpoints
    - Manage Orca threads through tools such as Slack
    - Receive triggers such as GitHub or Slack webhooks
13. Guides and onboarding

## Author Classification

For every PR, show the author's name, clickable profile, and source classification.

Use these values:

- `Core team`: GitHub author association is `OWNER` or `MEMBER`, or membership is otherwise verified from an authoritative team source
- `Community`: GitHub author association is `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, or `NONE`, unless an authoritative team source shows otherwise
- `Unknown`: association is `COLLABORATOR` or team membership cannot be verified
- `Automation`: the author is a bot or automated account

Do not infer membership from familiarity, commit count, or writing style. Author identity must not influence priority.

## Final HTML Report

Create `community-pr-triage-report.html` as a self-contained UTF-8 file:

- Embed all CSS, JavaScript, and report data in the file.
- Do not require a server, build step, package installation, CDN, or external asset.
- It must work when opened directly through a `file://` URL.
- External navigation is allowed only for evidence links such as PRs, issues, authors, checks, and discussions.
- Escape untrusted GitHub content before placing it in HTML.
- Use an accessible, responsive layout with readable contrast, keyboard-operable controls, and visible focus states.
- Keep the useful report content readable when JavaScript is unavailable; JavaScript should enhance filtering and expansion rather than supply the only copy of the data.

### Dashboard Header

Show:

- Exact four-week date range and timezone
- Generation timestamp
- Repository name
- Total in-scope PRs
- Total clusters
- Counts of P0, P1, P2, and P3 PRs
- Counts of core-team, community, unknown, and automation PRs
- Counts by readiness
- Important limitations or unavailable evidence

### Controls

Provide:

- Full-text search across PR number, title, author, issue, description, and cluster
- Filters for priority, readiness, source, recommendation, cluster relationship, review size, and confidence
- Sort by priority, expected impact, readiness, review size, author, or PR age
- A clear-all-filters action
- A visible count of matching PRs and clusters
- Direct anchor links to every cluster

Filtering must work across both the cluster overview and detailed PR sections without hiding the context needed to understand a matching PR.

### Cluster Decision Queue

Place this compact, sortable table near the top:

| Priority | Cluster | PRs | Combined outcome | Relationship | Recommended decision | Confidence |
|---|---|---|---|---|---|---|

For each cluster:

- Use a short, descriptive name linked to its detailed section.
- Link every PR number.
- Summarize the combined user or business outcome.
- State how the PRs relate.
- Recommend batch review, merge sequence, consolidation, one preferred solution, independent review, deferral, or closure.
- Sort initially by priority and expected impact.

Do not add a second table that duplicates this decision queue. Use filters or linked summary views for `Review immediately`, `Review soon`, `Needs product decision`, `Needs technical direction`, and `Consider closing`.

### Detailed Cluster Sections

Render each cluster as a collapsible section. Expand P0, P1, and decision-blocked clusters by default; lower-priority clusters may start collapsed.

The cluster summary must show:

- Cluster priority
- Problem being solved
- Combined user and business impact
- Strategic alignment
- Relationship type
- Linked issues with title, relationship, and status
- Related older PRs or `None found`
- Recommended approach
- Proposed landing order or consolidation strategy
- Cluster-level risks and dependencies
- Assessment confidence

Within each cluster, include every in-scope PR as a table row. Each row must contain:

| PR | Author / source | Linked issues | Role in cluster | What it does | Priority and rationale | Readiness / size | Recommendation |
|---|---|---|---|---|---|---|---|

Requirements for every PR row:

- `PR`: clickable PR number and title
- `Author / source`: clickable profile plus `Core team`, `Community`, `Unknown`, or `Automation`
- `Linked issues`: clickable number and short title plus relationship and status, or `None found`
- `Role in cluster`: unique contribution such as `Core fix`, `Alternative implementation`, `Required foundation`, `Follow-up enhancement`, `Test coverage`, `UI portion`, or `Duplicate`
- `What it does`: plain-language description of actual behavior, not a restatement of the title
- `Priority and rationale`: P0–P3 plus specific evidence about impact, urgency, business value, and stack alignment
- `Readiness / size`: readiness value, `S`/`M`/`L`, draft state, and concise CI/review status
- `Recommendation`: `Merge`, `Review immediately`, `Review soon`, `Request changes`, `Needs product decision`, `Needs technical direction`, `Consolidate`, `Supersede`, `Defer`, or `Consider closing`

Each row must have an expandable detail area containing:

- Evidence links supporting the assessment
- Tests and check results
- Unresolved review comments
- Important implementation or architectural notes
- Cross-platform, folder-workspace, or SSH/remote implications when relevant
- Dependencies, conflicts, and regression risks
- Confidence and any uncertainty

Keep the collapsed row concise enough to scan without opening the details.

### Cluster Review Plan

Every multi-PR cluster must explicitly answer:

1. Should these PRs be reviewed together?
2. Can multiple PRs safely be landed?
3. If so, in what order?
4. Are the changes overlapping or likely to conflict?
5. Should one implementation be preferred?
6. Would landing one PR make another unnecessary?
7. Is a product or architectural decision required first?

### Summary Views

Provide linked summary views or filter presets for:

- Review together now
- Merge in sequence
- Choose between competing implementations
- Consolidate overlapping PRs
- Quick standalone wins
- Product decisions needed
- Technical decisions needed
- Community PRs awaiting a response
- Potential closure candidates

These views should filter or link to the canonical cluster and PR entries rather than duplicate their full content.

## Final Quality Check

Before returning the report:

- Reconcile the report against the original inventory.
- Confirm every in-scope PR appears exactly once in one primary cluster.
- Confirm the dashboard counts match the detailed entries.
- Confirm clusters represent shared problems or outcomes, not merely shared labels or files.
- Confirm all identifiable linked issues appear in the relevant PR rows.
- Search for older PRs that materially overlap current work.
- Identify duplicate and competing implementations explicitly.
- Verify proposed landing sequences against dependencies and overlapping changes.
- Normalize priorities across all sub-agent results.
- Keep cluster priority, individual PR priority, readiness, review size, and confidence separate.
- Do not recommend landing every PR in a cluster merely because they are related.
- Do not favor or penalize a PR because its author is core team or community.
- Clearly label uncertainty instead of inventing evidence or business justification.
- Test search, filters, sorting, collapsible sections, anchor links, and clear-all behavior.
- Open the final file locally and verify that it is readable, responsive, and functional without a server.
- Keep the report easy to scan while providing enough linked evidence to make decisions.

When finished, return the path to `community-pr-triage-report.html` and a one-sentence summary of the number of PRs and clusters reviewed. Do not reproduce the full report in chat.
