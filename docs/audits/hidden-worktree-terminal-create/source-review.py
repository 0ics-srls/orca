import hashlib
import json
import subprocess
from pathlib import Path

root = Path.cwd()
out = root / 'docs/audits/hidden-worktree-terminal-create'
refs = {
    'main291b': '291b4ddd6f1c1af480169885e0fda7f9c78ff053',
    'reportedV194': '5d709e45f6b0ba51d62c5b81870895be65c60177',
    'reportSourceV191': '6b48a370d9d363f3b7d997573eaef5490381a946'
}
paths = [
    'src/cli/handlers/terminal.ts',
    'src/cli/codex-command-classification.ts',
    'src/main/runtime/rpc/methods/terminal/terminal-lifecycle-methods.ts',
    'src/main/runtime/orca-runtime-create-terminal.ts',
    'src/main/runtime/orca-runtime-terminal-create-deduplication.ts',
    'src/main/runtime/orca-runtime-create-terminal-desktop.ts',
    'src/main/runtime/orca-runtime-restore-live-paired-renderer-session-owned-mobile-terminals.ts',
    'src/main/runtime/orca-runtime-resolve-worktree-selector.ts',
    'src/main/runtime/orca-runtime-resolve-browser-network-execution-host-for-worktree.ts',
    'src/main/runtime/orca-runtime-list-known-resolved-worktrees-for-explicit-target.ts',
    'src/main/runtime/repo-worktree-row-resolution.ts',
    'src/main/ipc/worktrees/listing/register-worktree-catalog-handlers.ts',
    'src/main/ipc/worktrees/listing/ssh-worktree-fallback.ts',
    'src/shared/worktree/ownership.ts',
    'src/shared/worktree-visibility-resolution.ts',
    'src/shared/external-worktree-visibility.ts',
    'src/renderer/src/components/sidebar/worktree-list/navigation/use-pending-reveal.ts',
    'src/renderer/src/hooks/ipc-events/terminal-request-ipc-bridge.ts',
    'src/renderer/src/hooks/ipc-events/terminal-command-state.ts',
    'src/renderer/src/lib/terminal-worktree-route.ts',
    'src/renderer/src/lib/worktree-operation-route.ts',
    'src/renderer/src/store/slices/worktrees/listing/fetched-worktree-merge.ts',
    'src/renderer/src/store/slices/worktrees/listing/worktree-host-ownership.ts',
    'src/renderer/src/store/slices/worktrees/listing/fetch-worktrees.ts',
    'src/renderer/src/store/terminals/terminal-tab-creation.ts',
    'src/renderer/src/store/terminals/terminal-startup-queues.ts',
    'src/renderer/src/store/slices/terminal-orphan-helpers.ts',
    'src/renderer/src/store/slices/worktrees/session/set-active-worktree.ts',
    'src/renderer/src/components/Terminal.tsx',
    'src/renderer/src/components/use-terminal-workspace-foundation.ts',
    'src/renderer/src/components/workspace-surface-projection.ts',
    'src/renderer/src/components/TerminalSplitWorkspaceSurfaces.tsx',
    'src/renderer/src/components/TerminalLegacyTerminalPanes.tsx',
    'src/renderer/src/components/terminal/background-terminal-worktree-mount.ts',
    'src/main/runtime/orca-runtime.ts'
]


def get(ref, path):
    if ref == 'working':
        p = root / path
        return p.read_text() if p.exists() else None
    result = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest() if text is not None else None


source = {}
for name, ref in {'working': 'working', **refs}.items():
    source[name] = {p: get(ref, p) for p in paths}

comparisons = []
for name in refs:
    for p in paths:
        text = source[name][p]
        comparisons.append({
            'name': name, 'commit': refs[name], 'path': p,
            'sha256': sha(text), 'workingSha256': sha(source['working'][p]),
            'byteEqualToWorking': text is not None and text == source['working'][p]
        })

excerpts = {}
for name in ['working', *refs]:
    monolith = source[name]['src/main/runtime/orca-runtime.ts'] or ''
    selector = source[name]['src/main/runtime/orca-runtime-resolve-worktree-selector.ts'] or monolith
    wait = source[name]['src/main/runtime/orca-runtime-restore-live-paired-renderer-session-owned-mobile-terminals.ts'] or monolith
    selector_offset = selector.find('resolveWorktreeSelector(selector:')
    fallback_offset = selector.find('const fallback =', selector_offset)
    wait_offset = wait.find('waitForTerminalHandle(tabId: string, timeoutMs')
    assert fallback_offset >= 0 and wait_offset >= 0, (name, selector_offset, fallback_offset, wait_offset)
    guard = selector[fallback_offset:fallback_offset + 270]
    wait_end = wait.find('\n  }', wait_offset)
    wait_text = wait[wait_offset:wait_end + 4]
    assert 'repo?.connectionId && this.store?.getWorktreeMeta(worktreeId)' in guard
    assert 'this.graphSyncCallbacks.splice(idx, 1)' in wait_text
    assert 'Timed out waiting for terminal handle after creation' in wait_text
    excerpts[name] = {
        'localMetadataGuard': guard,
        'waitForTerminalHandle': wait_text,
        'waitMethodSha256': sha(wait_text)
    }

assert len({x['waitForTerminalHandle'] for x in excerpts.values()}) == 1
result = {
    'scope': f'{len(paths)} explicitly selected source paths at current worktree and three named refs; null means absent at that ref. Historical monolithic wait/selector excerpts are read directly from Git objects. Method signature/body comparison excludes the private/protected visibility modifier. No whole historical release execution is claimed.',
    'refs': refs,
    'comparisons': comparisons,
    'currentPaths': {p: sha(s) for p, s in source['working'].items()},
    'waitMethodSignatureAndBodyIdenticalAcrossAllFour': True,
    'excerpts': excerpts
}
(out / 'source-versions.json').write_text(json.dumps(result, indent=2) + '\n')
(out / 'main-sources.json').write_text(json.dumps(source['main291b']) + '\n')
print(f'Verified {len(paths) * len(refs)} named path identities; wait signature/body identical across working/main/v194/v191; SSH-only metadata guard present in all four.')
