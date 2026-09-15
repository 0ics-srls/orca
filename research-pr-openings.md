# How Open-Source Projects Handle Opening Pull Requests

Research date: 2026-08-30

## Conversation included

**User:** output this to a .md doc

**Assistant:** What content would you like me to put into the `.md` document?

**User:** the conversation you just had, research on how open source projects handles PR openings

## Executive summary

Mature open-source projects treat opening a pull request (PR) as the start of a review workflow, not as a request to merge immediately. The common path is:

1. Check the project’s contribution guide, issue tracker, and code of conduct.
2. Discuss or link an issue for non-trivial changes; confirm the proposed scope.
3. Create a focused branch and a small, reviewable PR against the documented base branch.
4. Use the PR template, explain the problem and solution, and include tests/documentation.
5. Let required automation run, respond to reviewer feedback, and keep the PR mergeable.
6. A maintainer or authorized reviewer approves and merges it according to project policy.

## What the projects do

| Project / guidance | How a PR is opened and prepared | What happens after opening |
| --- | --- | --- |
| GitHub collaborative-development guidance | Describes pull requests as a proposed change that can be reviewed before it is merged. Contributors work on a branch and open the PR against a target branch. | Reviewers comment, request changes, or approve; repository rules and checks can gate merging. |
| Kubernetes | The contributor guide asks authors to understand project conventions, keep PRs small, use a clear description, and mark unfinished work as a draft/WIP. | Automated presubmits and reviewer/approver assignments drive review. The PR is updated until required checks and approvals pass. |
| CPython | The lifecycle is explicit: create a branch, make changes, push the branch, and create a PR. The author is expected to run tests and ensure there are no failures. | Core developers review, request revisions, and eventually accept/merge. Buildbots and test results are part of the decision. |
| Rust | Contribution guidance routes bug reports and proposals through issue templates and asks contributors to understand and verify every change, including AI-generated changes. | Maintainers review the PR and may close changes that the author cannot personally explain, test, and verify. |
| Node.js | The contributor guide separates issues from PRs, calls PRs the way concrete code/documentation changes are made, and links dedicated instructions for review and large PRs. It also sets contributor/Collaborator expectations and requires sign-off (DCO). | Review follows project review rules; large or risky changes receive extra scrutiny, and authorized Collaborators land changes. |

## Repeated design patterns

### 1. Issue-first discussion for substantial work

Projects commonly use issues to establish the problem, desired behavior, and scope before code arrives. This prevents duplicate or unwanted work. Small, obvious fixes may go directly to a PR when the project permits it.

### 2. Focused, small PRs

Kubernetes and Node.js explicitly document small PRs and separate fixes from generic features. Narrow PRs are easier to test, review, backport, and revert.

### 3. Draft PRs for unfinished work

Draft/WIP status communicates that feedback is welcome but the author is not yet requesting final approval. This keeps incomplete work out of the merge queue.

### 4. Standardized metadata

PR templates and checklists collect the same high-value fields: linked issue, user impact, change summary, tests run, documentation, compatibility or migration notes, and screenshots/logs where relevant. GitHub documents templates as a way to standardize useful information.

### 5. Automation is part of the gate

CI, linting, unit/integration tests, build checks, security checks, and sometimes platform-specific jobs run after opening. Authors are expected to fix failures rather than ask reviewers to infer correctness.

### 6. Human review and explicit ownership

Projects distinguish contributors from maintainers/approvers/Collaborators. Reviewers validate design and risk; authorized maintainers perform the merge. Some projects require multiple approvals or area owners.

### 7. Contribution/legal requirements

Projects may require a Developer Certificate of Origin (DCO) sign-off, a Contributor License Agreement (CLA), copyright headers, or a code-of-conduct acknowledgement. These checks often run automatically and can block merging.

### 8. Traceability and release handling

Good PRs link issues and identify user-visible impact. Maintainers may label a PR for release notes, backports, milestones, or changelog entries. The merge strategy (merge commit, squash, or rebase) is project-specific.

## Practical PR-opening checklist

- Read `CONTRIBUTING.md`, the code of conduct, and any subsystem-specific guide.
- Search existing issues and PRs; link an issue when the change is non-trivial.
- Confirm the target/base branch and compatibility requirements.
- Keep one problem or coherent feature per PR; split unrelated cleanup.
- Start from an up-to-date branch and avoid committing generated/local files.
- Fill every PR-template item, including testing and documentation.
- Add or update regression tests; run the project’s required checks locally.
- Open as **Draft** if the implementation or design is still under discussion.
- In the description, state: problem, solution, alternatives, risks, rollout/migration, and how reviewers can test it.
- Watch CI, respond to review comments, and update the PR rather than opening parallel duplicates.
- Confirm required approvals, legal checks, and labels before asking for merge.

## Implications for a project designing its own PR process

The minimum effective workflow is an issue template plus a PR template, draft support, required CI, clear reviewer ownership, and a documented merge policy. Keep the author’s burden proportional: require detailed design discussion for risky changes, but make small documentation or typo fixes quick to submit. Publish what “ready to merge” means so contributors do not have to guess.

## Sources

- GitHub Docs, “About collaborative development models”: <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/getting-started/about-collaborative-development-models>
- GitHub Docs, “About issue and pull request templates”: <https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates>
- Kubernetes Contributors, “Pull Request Process”: <https://www.kubernetes.dev/docs/guide/pull-requests/>
- CPython Developer’s Guide, “Lifecycle of a pull request”: <https://devguide.python.org/getting-started/pull-request-lifecycle/>
- Rust repository, `CONTRIBUTING.md`: <https://github.com/rust-lang/rust/blob/master/CONTRIBUTING.md>
- Node.js repository, `CONTRIBUTING.md`: <https://github.com/nodejs/node/blob/main/CONTRIBUTING.md>

