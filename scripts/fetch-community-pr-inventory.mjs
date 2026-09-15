import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const repo = 'stablyai/orca'
const rangeStart = new Date('2026-08-01T21:15:00Z')
const rangeEnd = new Date('2026-08-29T21:15:00Z')
const outputPath = '/tmp/orca-community-pr-inventory.json'

const query = String.raw`
  query($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 25, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number title url createdAt updatedAt isDraft
          author { login url ... on User { name } }
          authorAssociation
          additions deletions changedFiles
          baseRefName headRefName mergeable mergeStateStatus reviewDecision
          labels(first: 30) { nodes { name color } }
          files(first: 20) { nodes { path additions deletions } pageInfo { hasNextPage } }
          closingIssuesReferences(first: 30) { nodes { number title url state } }
          commits(last: 1) {
            nodes {
              commit {
                oid messageHeadline messageBody url committedDate
                statusCheckRollup {
                  state
                }
              }
            }
          }
        }
      }
    }
  }
`

function iso(date) {
  return date.toISOString().replace('.000Z', 'Z')
}

function request(searchQuery, cursor) {
  const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `searchQuery=${searchQuery}`]
  if (cursor) args.push('-F', `cursor=${cursor}`)
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 }))
    } catch (error) {
      if (attempt === 4) throw error
    }
  }
}

const pullRequests = []
for (let start = new Date(rangeStart); start < rangeEnd; start.setUTCDate(start.getUTCDate() + 1)) {
  const end = new Date(Math.min(start.getTime() + 24 * 60 * 60 * 1000, rangeEnd.getTime()))
  const searchQuery = `repo:${repo} is:pr is:open created:${iso(start)}..${iso(end)}`
  let cursor
  do {
    const response = request(searchQuery, cursor)
    const search = response.data.search
    pullRequests.push(...search.nodes.filter(Boolean))
    cursor = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : undefined
  } while (cursor)
}

const unique = [...new Map(pullRequests.map((pr) => [pr.number, pr])).values()]
  .filter((pr) => {
    const created = new Date(pr.createdAt)
    return created >= rangeStart && created <= rangeEnd
  })
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

writeFileSync(outputPath, JSON.stringify({
  repository: repo,
  rangeStart: iso(rangeStart),
  rangeEnd: iso(rangeEnd),
  fetchedAt: new Date().toISOString(),
  count: unique.length,
  pullRequests: unique,
}, null, 2))

console.log(JSON.stringify({ outputPath, count: unique.length }))
