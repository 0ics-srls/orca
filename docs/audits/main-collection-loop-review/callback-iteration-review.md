# Callback iteration follow-up

This is a targeted static follow-up for five production `forEach` callers, plus watcher teardown support. It is not a complete callback/alias analysis or a runtime reproduction. Source identities are in `callback-iteration-review.json`.

| Primary path | Owner and mutation reviewed | Conclusion and limits |
| --- | --- | --- |
| `src/main/daemon/degraded-daemon-pty-provider.ts` | Data/exit listeners are arrays; callbacks can unsubscribe through splice. Provider disposal removes source subscriptions. | Array iteration uses its initial length; appending does not produce an ever-growing same-turn loop. Unsubscription can skip another listener. No additional retained callback owner was demonstrated here. |
| `src/relay/relay-filesystem-watch-registry.ts` | Dispose and client release iterate the watches Map; close delegates to the teardown tracker and identity-checks removal. | The direct callback only removes an existing watch. Teardown retains failed native custody intentionally; setup retries occur through separate async paths. This does not prove every externally supplied callback cannot re-enter admission. |
| `src/shared/agent-status-legacy-adapter.ts` | Readonly view forwards `forEach` to a private live Map. `admit({moveToEnd:true})` can delete and reinsert through the adapter API. | An artificial callback could extend iteration through that API, but no ordinary producer doing so was found in the searched main/shared/relay callers. `move` itself iterates an Array snapshot. No production growing-loop finding is claimed. |
| `src/shared/browser-annotation-viewport-bridge.ts` | Embedded JavaScript iterates the marker array to create elements, then iterates the element Map to remove obsolete entries. | The second loop does not add entries to its own Map. Empty markers clear the overlay. The script string is outside the earlier TypeScript AST loop scan, so this is a separate manual read. |
| `src/relay/ssh-pty-source-credit-adapter.ts` | Disposal iterates the grace-timer Map, calling `clearTimeout`, then clears it. | The callback does not add timers or invoke their callbacks. Other source-credit ownership and disconnect authority were not changed by this review. |

The watcher tracker marks a state closed, clears client maps, and removes its active registry entry before joining setup/unsubscription. Its later promise handlers manage separate pending/failed maps. Those pending owners must not be discarded merely because a logical close returned or a remote connection disappeared.

No new product change follows from these five static reads. They narrow selected synchronous growth hypotheses without identifying the allocator in #19768 or proving a repository-wide absence of non-progressing callbacks.
