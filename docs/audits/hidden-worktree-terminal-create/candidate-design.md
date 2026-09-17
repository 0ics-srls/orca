# Focused-create design boundary (not promoted)

The narrow safe distinction is positive hidden-worktree evidence versus incomplete catalog state. A known, authoritatively detected checkout that current visibility policy excludes has no renderable surface; rejecting that focused create before `createTab` avoids allocating an unreachable launch. A merely absent or hydrating catalog can still acquire a real surface, so the upstream background guard cannot simply be expanded to every focused request.

Any focused hidden-row guard must use current visibility and the resolved execution host. A stale `visible:false` result after a show/import action, a visible same-ID owner on another host, or an incomplete refresh must not be used as affirmative refusal evidence. Existing worktree owner and visibility helpers should supply this distinction; no new independent owner map or arbitrary row cap is indicated. Folder, floating and ephemeral setup surfaces require their existing special handling.

This guard would cover the proven ordinary hidden-policy trigger. It would not solve every accepted create whose catalog never arrives. The latter requires either pre-admission hydration that is fenced against the main request deadline, or an exact request/tab/queued-command ownership token that can retire before any native spawn starts. Simply awaiting a refresh and then creating is unsafe: the main IPC reply deadline may have expired during that await. Merely deleting a queued command after timeout also breaks legitimate late mounts.

No product candidate was applied. Root will review the frozen source/caller evidence before choosing a focused-path change. Existing open PR #18290 owns the background guard and should not be duplicated.
