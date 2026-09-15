import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const source = JSON.parse(readFileSync('/tmp/orca-community-pr-inventory.json', 'utf8'))
const discussions = existsSync('/tmp/orca-community-pr-discussions.json')
  ? JSON.parse(readFileSync('/tmp/orca-community-pr-discussions.json', 'utf8'))
  : {}

const stop = new Set('a an and are as at be by for from in into is it of on or the this to with add adds allow allows fix fixes make makes keep keeps stop stops ensure ensures support supports'.split(' '))
const stack = [
  ['Plugins', /\b(plugin|plugins|skill|skills|mcp)\b/i, 1],
  ['Automated release pipeline', /\b(release|updater|update|packag|build|ci|notari|signing)\b/i, 2],
  ['Agent management and search', /\b(agent|agents|sidebar|session|ai.vault|search)\b/i, 3],
  ['SSH/remote re-architecture', /\b(ssh|remote|relay|orcad|daemon|runtime|wsl)\b/i, 4],
  ['Cloud VMs', /\b(cloud|vercel|sandbox|vm|environment recipe)\b/i, 5],
  ['Profile and resource management', /\b(profile|account|resource|quota|usage|rate.limit)\b/i, 6],
  ['Open-source Relay', /\brelay\b/i, 7],
  ['Chat UI', /\b(chat|composer|prompt|attachment|message)\b/i, 8],
  ['Enterprise governance', /\b(enterprise|governance|policy|audit|permission|security)\b/i, 9],
  ['Orchestration and Orca CLI', /\b(orchestrat|worker|task|cli|command)\b/i, 10],
  ['Mobile', /\b(mobile|phone|android|ios|ota)\b/i, 11],
  ['Inbound and outbound endpoints', /\b(webhook|endpoint|slack|discord|jira|linear|github|gitlab|odoo|plane)\b/i, 12],
  ['Guides and onboarding', /\b(doc|docs|readme|guide|onboard|quickstart|typo)\b/i, 13],
]

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function textFor(pr) {
  const detail = discussions[pr.number]
  return [pr.title, detail?.body, ...(detail?.comments?.nodes || []).map((x) => x.body), ...pr.commits.nodes.map((x) => `${x.commit.messageHeadline} ${x.commit.messageBody}`), ...pr.files.nodes.map((x) => x.path)].filter(Boolean).join(' ')
}

function domainFor(pr) {
  const text = textFor(pr)
  return stack.find(([, pattern]) => pattern.test(text)) || ['Other product work', /.*/, 99]
}

function tokens(title) {
  return title.toLowerCase()
    .replace(/^\s*(fix|feat|chore|docs|test|perf|refactor|revert)(\([^)]*\))?!?:\s*/, '')
    .replace(/#\d+|\b(sta|option)\s*[-#]?\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word))
}

function similarity(left, right) {
  const a = new Set(left)
  const b = new Set(right)
  if (Math.min(a.size, b.size) < 3) return 0
  const shared = [...a].filter((item) => b.has(item)).length
  return shared / (a.size + b.size - shared)
}

function mentionedIssues(pr) {
  const closing = pr.closingIssuesReferences.nodes.map((issue) => ({ ...issue, relationship: 'Fixes' }))
  const known = new Set(closing.map((issue) => issue.number))
  const numbers = [...textFor(pr).matchAll(/(?:^|[^\w/])#(\d{2,6})\b/g)].map((match) => Number(match[1]))
  for (const number of numbers) {
    if (number !== pr.number && !known.has(number)) {
      closing.push({ number, title: 'Title unavailable', url: `https://github.com/stablyai/orca/issues/${number}`, state: 'Unknown', relationship: 'Unclear' })
      known.add(number)
    }
  }
  return closing.slice(0, 20)
}

const prs = source.pullRequests.map((pr) => {
  const [domain, , rank] = domainFor(pr)
  return { ...pr, detail: discussions[pr.number] || {}, domain, rank, tokens: tokens(pr.title), issues: mentionedIssues(pr) }
})

const parent = new Map(prs.map((pr) => [pr.number, pr.number]))
const find = (id) => parent.get(id) === id ? id : (parent.set(id, find(parent.get(id))), parent.get(id))
const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra) }
const issueOwners = new Map()
for (const pr of prs) {
  for (const issue of pr.issues.filter((x) => x.relationship === 'Fixes')) {
    if (issueOwners.has(issue.number)) union(pr.number, issueOwners.get(issue.number))
    else issueOwners.set(issue.number, pr.number)
  }
}
for (let i = 0; i < prs.length; i += 1) {
  for (let j = i + 1; j < prs.length; j += 1) {
    if (prs[i].domain !== prs[j].domain) continue
    const score = similarity(prs[i].tokens, prs[j].tokens)
    if (score >= 0.72) union(prs[i].number, prs[j].number)
  }
}

const grouped = new Map()
for (const pr of prs) {
  const root = find(pr.number)
  if (!grouped.has(root)) grouped.set(root, [])
  grouped.get(root).push(pr)
}

function sourceFor(pr) {
  if (/\[bot\]$|bot$/i.test(pr.author?.login || '')) return 'Automation'
  if (['OWNER', 'MEMBER'].includes(pr.authorAssociation)) return 'Core team'
  if (['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE'].includes(pr.authorAssociation)) return 'Community'
  return 'Unknown'
}

function relationship(items) {
  if (items.length === 1) return 'Standalone'
  const titles = items.map((pr) => pr.title).join(' ')
  if (/option [a-z]|alternative|instead|versus| vs\b/i.test(titles)) return 'Competing'
  if (/supersede|duplicate|revert/i.test(titles)) return 'Duplicate'
  const fileSets = items.map((pr) => new Set(pr.files.nodes.map((file) => file.path)))
  const overlaps = fileSets.some((set, index) => fileSets.slice(index + 1).some((other) => [...set].some((file) => other.has(file))))
  return overlaps ? 'Overlapping' : 'Related'
}

function priority(pr, rel) {
  const text = textFor(pr)
  const title = pr.title
  if (/\b(CVE-\d|security vulnerability|data loss|credential leak|auth(?:entication|orization)? bypass|release.block)\b/i.test(title)) return 'P0'
  if (/\b(crash|hang|wedge|deadlock|unusable|cannot start|fails to start|lost work|corrupt|exposure)\b/i.test(title)) return 'P1'
  if (pr.rank <= 4 && /^feat/i.test(title) && (pr.changedFiles >= 8 || pr.additions >= 500)) return 'P1'
  if (pr.rank <= 4 && /\b(unblock|widespread|all users|enterprise|critical|severe)\b/i.test(`${title} ${pr.detail.body || ''}`)) return 'P1'
  if (rel === 'Duplicate' || /\btypo\b|stale|obsolete/i.test(title)) return 'P3'
  return 'P2'
}

function readiness(pr) {
  if (pr.isDraft) return 'Draft/early'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'Substantial changes needed'
  const checks = pr.commits.nodes[0]?.commit.statusCheckRollup?.state || 'UNKNOWN'
  if (pr.mergeable === 'CONFLICTING' || checks === 'FAILURE') return 'Blocked'
  if (pr.mergeable === 'MERGEABLE' && checks === 'SUCCESS') return 'Ready'
  if (checks === 'SUCCESS') return 'Minor changes needed'
  return 'Unclear'
}

function size(pr) {
  if (pr.changedFiles > 20 || pr.additions + pr.deletions > 1200) return 'L'
  if (pr.changedFiles > 5 || pr.additions + pr.deletions > 250) return 'M'
  return 'S'
}

function recommendation(pr, rel) {
  const ready = readiness(pr)
  const level = priority(pr, rel)
  if (rel === 'Duplicate') return 'Supersede'
  if (rel === 'Competing') return 'Needs product decision'
  if (ready === 'Blocked') return 'Request changes'
  if (ready === 'Draft/early') return 'Defer'
  if (level === 'P0') return 'Review immediately'
  if (level === 'P1') return 'Review soon'
  if (level === 'P3') return 'Consider closing'
  return ready === 'Ready' && size(pr) === 'S' ? 'Merge' : 'Review soon'
}

const clusters = [...grouped.values()].map((items) => {
  items.sort((a, b) => a.number - b.number)
  const rel = relationship(items)
  for (const pr of items) {
    pr.source = sourceFor(pr)
    pr.priority = priority(pr, rel)
    pr.readiness = readiness(pr)
    pr.size = size(pr)
    pr.recommendation = recommendation(pr, rel)
    pr.confidence = discussions[pr.number] ? 'Medium' : 'Low'
  }
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 }
  const clusterPriority = items.map((pr) => pr.priority).sort((a, b) => order[a] - order[b])[0]
  const leader = items[0]
  const name = leader.title.replace(/^\s*(fix|feat|chore|docs|test|perf|refactor)(\([^)]*\))?!?:\s*/i, '').slice(0, 92)
  return {
    id: `cluster-${leader.number}`,
    name,
    domain: leader.domain,
    rank: Math.min(...items.map((pr) => pr.rank)),
    priority: clusterPriority,
    relationship: rel,
    items,
  }
}).sort((a, b) => ({ P0: 0, P1: 1, P2: 2, P3: 3 })[a.priority] - ({ P0: 0, P1: 1, P2: 2, P3: 3 })[b.priority] || a.rank - b.rank || a.name.localeCompare(b.name))

const counts = (values) => Object.fromEntries(values.map((value) => [value, prs.filter((pr) => pr[value]).length]))
const priorityCounts = Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((value) => [value, prs.filter((pr) => pr.priority === value).length]))
const sourceCounts = Object.fromEntries(['Core team', 'Community', 'Unknown', 'Automation'].map((value) => [value, prs.filter((pr) => pr.source === value).length]))
const readinessValues = ['Ready', 'Minor changes needed', 'Substantial changes needed', 'Blocked', 'Draft/early', 'Unclear']
const readinessCounts = Object.fromEntries(readinessValues.map((value) => [value, prs.filter((pr) => pr.readiness === value).length]))
const generated = new Date().toISOString()
const rangeLabel = 'August 1, 2026 2:15 PM through August 29, 2026 2:15 PM (America/Phoenix, MST, UTC−07:00)'

function optionList(values) { return values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('') }
function issueList(pr) {
  if (!pr.issues.length) return 'None found'
  return pr.issues.map((issue) => `<a href="${esc(issue.url)}">#${issue.number} ${esc(issue.title)}</a> <small>${esc(issue.relationship)} · ${esc(issue.state || 'Unknown')}</small>`).join('<br>')
}
function evidence(pr) {
  const checks = pr.commits.nodes[0]?.commit.statusCheckRollup?.state || 'Unknown'
  const reviews = pr.detail.reviews?.nodes || []
  const unresolved = reviews.filter((review) => review.state === 'CHANGES_REQUESTED')
  const paths = pr.files.nodes.slice(0, 8).map((file) => `<code>${esc(file.path)}</code>`).join(', ') || 'Unknown'
  return `<div class="detail-grid"><div><h5>Evidence</h5><p><a href="${esc(pr.url)}">PR conversation</a> · <a href="${esc(pr.url)}/files">Diff</a> · <a href="${esc(pr.url)}/checks">Checks</a></p><p>Changed paths: ${paths}${pr.files.pageInfo.hasNextPage ? ' …' : ''}</p></div><div><h5>Tests and reviews</h5><p>Latest check rollup: <b>${esc(checks)}</b>. Review decision: <b>${esc(pr.reviewDecision || 'None')}</b>. Unresolved changes-requested reviews observed: ${unresolved.length}.</p></div><div><h5>Architecture and risk</h5><p>${esc(pr.changedFiles)} files, +${esc(pr.additions)}/−${esc(pr.deletions)}. Local, folder-workspace, SSH/remote, mixed-version, and cross-platform implications require reviewer confirmation where touched paths cross those boundaries.</p></div><div><h5>Confidence</h5><p>${esc(pr.confidence)} — ${pr.confidence === 'Low' ? 'description/discussion evidence was unavailable in the batch inventory; assessment is metadata-level.' : 'description and recent discussion metadata were available, but full unresolved-thread state still requires GitHub review.'}</p></div></div>`
}

function row(pr, cluster) {
  const author = pr.author || { login: 'ghost', url: 'https://github.com/ghost' }
  const body = (pr.detail.body || '').replace(/\s+/g, ' ').trim().slice(0, 220)
  const behavior = body || `${pr.title}; changes ${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'} across ${pr.files.nodes.slice(0, 3).map((file) => file.path).join(', ') || 'unavailable paths'}.`
  const rationale = pr.priority === 'P0' ? 'Potential security, data-loss, or release-blocking signal requires immediate validation.' : pr.priority === 'P1' ? `Meaningful core-workflow impact with strategic alignment to ${pr.domain}.` : pr.priority === 'P2' ? `Useful scoped improvement; aligned with ${pr.domain} but no verified emergency.` : 'Low-value, stale, or potentially superseded signal; validate before further investment.'
  const search = `${pr.number} ${pr.title} ${author.login} ${body} ${cluster.name} ${pr.issues.map((x) => `${x.number} ${x.title}`).join(' ')}`.toLowerCase()
  return `<tbody class="pr-block" data-search="${esc(search)}" data-priority="${pr.priority}" data-readiness="${esc(pr.readiness)}" data-source="${esc(pr.source)}" data-recommendation="${esc(pr.recommendation)}" data-relationship="${cluster.relationship}" data-size="${pr.size}" data-confidence="${pr.confidence}" data-author="${esc(author.login.toLowerCase())}" data-age="${Date.parse(pr.createdAt)}"><tr><td><a href="${esc(pr.url)}"><b>#${pr.number}</b> ${esc(pr.title)}</a>${pr.isDraft ? '<span class="pill">Draft</span>' : ''}</td><td><a href="${esc(author.url)}">${esc(author.name || author.login)}</a><br><small>${esc(pr.source)} · ${esc(pr.authorAssociation)}</small></td><td>${issueList(pr)}</td><td>${cluster.items.length > 1 ? (cluster.relationship === 'Competing' ? 'Alternative implementation' : 'Cluster contribution') : 'Standalone change'}</td><td>${esc(behavior)}</td><td><span class="badge ${pr.priority.toLowerCase()}">${pr.priority}</span> ${esc(rationale)}</td><td><b>${esc(pr.readiness)}</b> · ${pr.size}<br><small>${esc(pr.isDraft ? 'Draft' : 'Open')} · checks ${esc(pr.commits.nodes[0]?.commit.statusCheckRollup?.state || 'Unknown')} · review ${esc(pr.reviewDecision || 'None')}</small></td><td><b>${esc(pr.recommendation)}</b></td></tr><tr class="expand"><td colspan="8"><details><summary>Evidence, tests, review state, risks, and uncertainty</summary>${evidence(pr)}</details></td></tr></tbody>`
}

function clusterSection(cluster) {
  const issueMap = new Map(cluster.items.flatMap((pr) => pr.issues).map((issue) => [issue.number, issue]))
  const issues = issueMap.size ? [...issueMap.values()].map((x) => `<a href="${esc(x.url)}">#${x.number} ${esc(x.title)}</a> (${esc(x.relationship)}, ${esc(x.state || 'Unknown')})`).join('; ') : 'None found'
  const decision = cluster.relationship === 'Competing' ? 'Choose one implementation after a product and technical comparison; do not land alternatives together.' : cluster.relationship === 'Duplicate' ? 'Confirm the preferred implementation and supersede redundant work.' : cluster.items.length > 1 ? 'Review together; if diffs do not conflict, land the smallest foundation first, then rerun CI before each follow-up.' : cluster.items[0].recommendation
  const open = ['P0', 'P1'].includes(cluster.priority) || cluster.relationship === 'Competing'
  return `<details class="cluster" id="${cluster.id}" data-cluster-priority="${cluster.priority}" ${open ? 'open' : ''}><summary><span class="badge ${cluster.priority.toLowerCase()}">${cluster.priority}</span><span>${esc(cluster.name)}</span><small>${cluster.items.length} PR${cluster.items.length === 1 ? '' : 's'} · ${cluster.relationship} · ${esc(cluster.domain)}</small><a class="anchor" href="#${cluster.id}" aria-label="Link to cluster">#</a></summary><div class="cluster-summary"><p><b>Problem:</b> ${esc(cluster.name)}.</p><p><b>Combined impact:</b> ${esc(cluster.items.length > 1 ? `Coordinates ${cluster.items.length} proposals for the same narrowly inferred outcome.` : 'A standalone change with no strong in-scope duplicate detected by linked-issue and title-similarity evidence.')}</p><p><b>Strategic alignment:</b> ${esc(cluster.domain)}${cluster.rank < 99 ? ` (stack rank ${cluster.rank})` : ''}.</p><p><b>Relationship:</b> ${cluster.relationship}. <b>Linked issues:</b> ${issues}.</p><p><b>Related older PRs:</b> None found in the completed deep-review evidence; metadata-only clusters remain unverified.</p><p><b>Recommended approach:</b> ${esc(decision)}</p><p><b>Landing/consolidation:</b> ${esc(cluster.items.length > 1 ? 'Review together. Resolve overlap and conflicts first; land foundations before follow-ups, with CI between merges.' : 'Review independently; no in-scope dependency detected.')}</p><p><b>Risks/dependencies:</b> ${esc(cluster.items.some((pr) => pr.mergeable === 'CONFLICTING') ? 'At least one PR is currently conflicting. ' : '')}${esc(cluster.items.some((pr) => pr.commits.nodes[0]?.commit.statusCheckRollup?.state === 'FAILURE') ? 'At least one latest check rollup is failing. ' : '')}Execution-host, folder-workspace, mixed-version, Git-provider, and cross-platform boundaries require targeted review when relevant.</p><p><b>Confidence:</b> ${cluster.items.every((pr) => pr.confidence !== 'Low') ? 'Medium' : 'Low for at least one PR due to missing deep evidence.'}</p>${cluster.items.length > 1 ? `<div class="review-plan"><h4>Cluster review plan</h4><ol><li>Review together: Yes.</li><li>Can multiple land: ${cluster.relationship === 'Competing' || cluster.relationship === 'Duplicate' ? 'Not until one implementation is chosen.' : 'Potentially, after overlap and CI validation.'}</li><li>Order: smallest required foundation, then follow-ups.</li><li>Conflict risk: ${cluster.relationship === 'Overlapping' || cluster.relationship === 'Competing' ? 'Elevated.' : 'Verify in diff review.'}</li><li>Preferred implementation: choose the most complete, tested, architecture-aligned option.</li><li>Redundancy: ${cluster.relationship === 'Duplicate' ? 'Likely.' : 'Not established.'}</li><li>Decision first: ${cluster.relationship === 'Competing' ? 'Product and technical decision required.' : 'Only if deep review reveals incompatible direction.'}</li></ol></div>` : ''}</div><div class="table-wrap"><table class="detail-table"><thead><tr><th>PR</th><th>Author / source</th><th>Linked issues</th><th>Role in cluster</th><th>What it does</th><th>Priority and rationale</th><th>Readiness / size</th><th>Recommendation</th></tr></thead>${cluster.items.map((pr) => row(pr, cluster)).join('')}</table></div></details>`
}

const recommendationValues = [...new Set(prs.map((pr) => pr.recommendation))].sort()
const relationValues = [...new Set(clusters.map((cluster) => cluster.relationship))].sort()
const limitations = `${Object.keys(discussions).length}/${prs.length} PR descriptions and recent discussions were available at generation time; missing evidence is marked Low confidence. Files are capped at 20 per PR in the inventory. Check rollups are summarized, not a substitute for inspecting every job. Mergeability Unknown is not treated as safe. Older-overlap search is complete only for deep-reviewed clusters.`

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Community PR triage · stablyai/orca</title><style>
:root{color-scheme:light dark;--bg:#0b1020;--panel:#141b2d;--panel2:#1d263b;--text:#eef3ff;--muted:#aab5ce;--line:#34405b;--focus:#66d9ff;--p0:#ff6b6b;--p1:#ffb86b;--p2:#6bd6a5;--p3:#9aa7bf}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}a{color:#83d5ff}a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.wrap{max-width:1800px;margin:auto;padding:24px}.hero,.controls,.queue,.cluster{background:var(--panel);border:1px solid var(--line);border-radius:14px;margin-bottom:18px}.hero,.controls,.queue{padding:20px}h1{margin:0 0 6px;font-size:clamp(25px,4vw,44px)}h2{margin-top:0}.meta{color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:18px 0}.stat{padding:12px;background:var(--panel2);border-radius:10px}.stat b{display:block;font-size:21px}.limitations{border-left:4px solid var(--p1);padding:9px 12px;background:#211b19}.control-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.control-grid label{display:grid;gap:4px;color:var(--muted)}input,select,button{border:1px solid var(--line);border-radius:8px;background:var(--panel2);color:var(--text);padding:9px;font:inherit}button{cursor:pointer}.actions{display:flex;gap:10px;align-items:end}.matches{font-size:17px;margin-top:12px}.presets{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.presets a{padding:6px 9px;border:1px solid var(--line);border-radius:999px;text-decoration:none}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:1100px}th,td{padding:9px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{position:sticky;top:0;background:var(--panel2);z-index:1}.badge,.pill{display:inline-block;padding:2px 7px;border-radius:999px;font-weight:700;margin-right:5px}.p0{background:var(--p0);color:#210000}.p1{background:var(--p1);color:#241000}.p2{background:var(--p2);color:#042015}.p3{background:var(--p3);color:#101522}.pill{border:1px solid var(--line);font-size:11px}.cluster>summary{display:grid;grid-template-columns:auto minmax(240px,1fr) auto auto;gap:10px;align-items:center;padding:15px;cursor:pointer;font-size:17px}.cluster>summary small{color:var(--muted)}.anchor{padding:6px}.cluster-summary{padding:0 18px 12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:0 18px;background:var(--panel2)}.review-plan{grid-column:1/-1}.detail-table{font-size:13px}.detail-table td:first-child{min-width:230px}.detail-table td:nth-child(5),.detail-table td:nth-child(6){min-width:240px}.expand td{padding:0 10px 10px}.expand summary{cursor:pointer;color:#83d5ff}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;padding:10px;background:var(--panel2)}code{word-break:break-all}.hidden{display:none!important}@media(max-width:760px){.wrap{padding:10px}.cluster>summary{grid-template-columns:auto 1fr}.cluster>summary small{grid-column:2}.cluster-summary{grid-template-columns:1fr}.hero,.controls,.queue{padding:14px}}@media print{body{background:#fff;color:#111}.hero,.controls,.queue,.cluster{border-color:#bbb}.controls{display:none}a{color:#0645ad}.cluster:not([open])>*:not(summary){display:block}.cluster-summary{background:#fff}}
</style></head><body><main class="wrap"><section class="hero"><p class="meta">Decision-ready inventory · partial deep-review evidence is explicitly labeled</p><h1>Community PR triage</h1><p><b>Repository:</b> <a href="https://github.com/stablyai/orca">stablyai/orca</a><br><b>Four-week range:</b> ${rangeLabel}<br><b>Generated:</b> ${esc(generated)}</p><div class="stats"><div class="stat"><b>${prs.length}</b>in-scope PRs</div><div class="stat"><b>${clusters.length}</b>clusters</div>${['P0','P1','P2','P3'].map((x)=>`<div class="stat"><b>${priorityCounts[x]}</b>${x} PRs</div>`).join('')}${['Core team','Community','Unknown','Automation'].map((x)=>`<div class="stat"><b>${sourceCounts[x]}</b>${x}</div>`).join('')}${readinessValues.map((x)=>`<div class="stat"><b>${readinessCounts[x]}</b>${esc(x)}</div>`).join('')}</div><p class="limitations"><b>Limitations:</b> ${esc(limitations)}</p></section>
<section class="controls" aria-labelledby="controls-title"><h2 id="controls-title">Find and filter</h2><div class="control-grid"><label>Search<input id="search" type="search" placeholder="PR, title, author, issue, description, cluster"></label><label>Priority<select id="priority"><option value="">All</option>${optionList(['P0','P1','P2','P3'])}</select></label><label>Readiness<select id="readiness"><option value="">All</option>${optionList(readinessValues)}</select></label><label>Source<select id="source"><option value="">All</option>${optionList(['Core team','Community','Unknown','Automation'])}</select></label><label>Recommendation<select id="recommendation"><option value="">All</option>${optionList(recommendationValues)}</select></label><label>Relationship<select id="relationship"><option value="">All</option>${optionList(relationValues)}</select></label><label>Review size<select id="size"><option value="">All</option>${optionList(['S','M','L'])}</select></label><label>Confidence<select id="confidence"><option value="">All</option>${optionList(['High','Medium','Low'])}</select></label><label>Sort<select id="sort"><option value="priority">Priority / impact</option><option value="readiness">Readiness</option><option value="size">Review size</option><option value="author">Author</option><option value="age">PR age</option></select></label><div class="actions"><button id="clear" type="button">Clear all filters</button></div></div><p class="matches" id="matches" aria-live="polite">Showing ${prs.length} PRs in ${clusters.length} clusters</p><nav class="presets" aria-label="Summary views"><a href="#queue" data-preset="together">Review together now</a><a href="#queue" data-preset="sequence">Merge in sequence</a><a href="#queue" data-preset="competing">Choose between competing implementations</a><a href="#queue" data-preset="overlap">Consolidate overlapping PRs</a><a href="#queue" data-preset="quick">Quick standalone wins</a><a href="#queue" data-preset="product">Product decisions needed</a><a href="#queue" data-preset="technical">Technical decisions needed</a><a href="#queue" data-preset="community">Community PRs awaiting a response</a><a href="#queue" data-preset="close">Potential closure candidates</a></nav></section>
<section class="queue" id="queue"><h2>Cluster decision queue</h2><div class="table-wrap"><table><thead><tr><th>Priority</th><th>Cluster</th><th>PRs</th><th>Combined outcome</th><th>Relationship</th><th>Recommended decision</th><th>Confidence</th></tr></thead><tbody id="queue-body">${clusters.map((cluster)=>`<tr data-cluster="${cluster.id}"><td><span class="badge ${cluster.priority.toLowerCase()}">${cluster.priority}</span></td><td><a href="#${cluster.id}">${esc(cluster.name)}</a></td><td>${cluster.items.map((pr)=>`<a href="${esc(pr.url)}">#${pr.number}</a>`).join(' ')}</td><td>${esc(cluster.items.length > 1 ? `Coordinate ${cluster.items.length} proposals for ${cluster.name}.` : cluster.name)}</td><td>${cluster.relationship}</td><td>${esc(cluster.relationship === 'Competing' ? 'Choose one preferred solution' : cluster.relationship === 'Duplicate' ? 'Supersede redundant work' : cluster.items.length > 1 ? 'Review together; merge in sequence if compatible' : cluster.items[0].recommendation)}</td><td>${cluster.items.every((pr)=>pr.confidence!=='Low')?'Medium':'Low'}</td></tr>`).join('')}</tbody></table></div></section><section id="clusters" aria-label="Detailed clusters">${clusters.map(clusterSection).join('')}</section></main>
<script>(()=>{const controls=['search','priority','readiness','source','recommendation','relationship','size','confidence','sort'].reduce((a,id)=>(a[id]=document.getElementById(id),a),{});const clusters=[...document.querySelectorAll('.cluster')];const rank={P0:0,P1:1,P2:2,P3:3,Ready:0,'Minor changes needed':1,Unclear:2,'Draft/early':3,'Substantial changes needed':4,Blocked:5,S:0,M:1,L:2};function apply(){let shownPrs=0,shownClusters=0;for(const cluster of clusters){const blocks=[...cluster.querySelectorAll('.pr-block')];let count=0;for(const block of blocks){const match=(!controls.search.value||block.dataset.search.includes(controls.search.value.toLowerCase()))&&['priority','readiness','source','recommendation','relationship','size','confidence'].every(k=>!controls[k].value||block.dataset[k]===controls[k].value);block.classList.toggle('hidden',!match);if(match)count++}cluster.classList.toggle('hidden',count===0);document.querySelector('[data-cluster="'+cluster.id+'"]')?.classList.toggle('hidden',count===0);if(count){shownClusters++;shownPrs+=count}}document.getElementById('matches').textContent='Showing '+shownPrs+' PRs in '+shownClusters+' clusters';const key=controls.sort.value;clusters.sort((a,b)=>{const pa=a.querySelector('.pr-block'),pb=b.querySelector('.pr-block');if(key==='author')return pa.dataset.author.localeCompare(pb.dataset.author);if(key==='age')return Number(pa.dataset.age)-Number(pb.dataset.age);if(key==='priority')return rank[pa.dataset.priority]-rank[pb.dataset.priority];return rank[pa.dataset[key]]-rank[pb.dataset[key]]}).forEach(x=>document.getElementById('clusters').append(x))}Object.values(controls).forEach(x=>x.addEventListener(x.tagName==='INPUT'?'input':'change',apply));document.getElementById('clear').onclick=()=>{Object.values(controls).forEach(x=>x.value=x.id==='sort'?'priority':'');apply()};document.querySelectorAll('[data-preset]').forEach(a=>a.onclick=()=>{document.getElementById('clear').click();const p=a.dataset.preset;if(p==='competing')controls.relationship.value='Competing';if(p==='overlap'||p==='together'||p==='sequence')controls.relationship.value='Overlapping';if(p==='quick'){controls.relationship.value='Standalone';controls.size.value='S';controls.readiness.value='Ready'}if(p==='product')controls.recommendation.value='Needs product decision';if(p==='technical')controls.recommendation.value='Request changes';if(p==='community')controls.source.value='Community';if(p==='close')controls.recommendation.value='Consider closing';apply()});apply()})()</script></body></html>`

writeFileSync('community-pr-triage-report.html', html)
writeFileSync('/tmp/orca-community-pr-clusters.json', JSON.stringify(clusters.map((cluster) => ({ id: cluster.id, name: cluster.name, priority: cluster.priority, relationship: cluster.relationship, prs: cluster.items.map((pr) => pr.number) })), null, 2))
writeFileSync('/tmp/orca-community-pr-assessments.json', JSON.stringify(prs.map((pr) => ({ number: pr.number, title: pr.title, domain: pr.domain, source: pr.source, priority: pr.priority, readiness: pr.readiness, size: pr.size, recommendation: pr.recommendation, confidence: pr.confidence })), null, 2))
console.log(JSON.stringify({ report: 'community-pr-triage-report.html', prs: prs.length, clusters: clusters.length, discussionRecords: Object.keys(discussions).length, priorityCounts }))
