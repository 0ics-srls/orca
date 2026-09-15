import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const rangeStart = new Date('2026-08-01T21:15:00Z')
const rangeEnd = new Date('2026-08-29T21:15:00Z')
const query = String.raw`
  query($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 25, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number body
          reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login url } ... on Team { name url } } } }
          reviews(last: 10) { nodes { author { login url } state submittedAt url body } }
          comments(last: 10) { nodes { author { login url } createdAt url body } }
        }
      }
    }
  }
`

const iso = (date) => date.toISOString().replace('.000Z', 'Z')

function request(searchQuery, cursor) {
  const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `searchQuery=${searchQuery}`]
  if (cursor) args.push('-F', `cursor=${cursor}`)
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 100 }))
    } catch (error) {
      if (attempt === 4) throw error
    }
  }
}

const entries = []
for (let start = new Date(rangeStart); start < rangeEnd; start.setUTCDate(start.getUTCDate() + 1)) {
  const end = new Date(Math.min(start.getTime() + 86400000, rangeEnd.getTime()))
  const searchQuery = `repo:stablyai/orca is:pr is:open created:${iso(start)}..${iso(end)}`
  let cursor
  do {
    const search = request(searchQuery, cursor).data.search
    entries.push(...search.nodes.filter(Boolean))
    cursor = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : undefined
  } while (cursor)
}

const byNumber = Object.fromEntries(entries.map((entry) => [entry.number, entry]))
writeFileSync('/tmp/orca-community-pr-discussions.json', JSON.stringify(byNumber, null, 2))
console.log(JSON.stringify({ count: Object.keys(byNumber).length }))
