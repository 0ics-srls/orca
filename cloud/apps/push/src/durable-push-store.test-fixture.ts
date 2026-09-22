import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { PushNotification } from '@orca-cloud/push-contract'
import { openInMemoryPushDatabase, openPushDatabase, type PushDatabase } from './push-database.js'
import { DurablePushStore } from './durable-push-store.js'

export const durablePushTestDatabaseUrl =
  process.env.ORCA_PUSH_DURABLE_TEST_POSTGRES_URL ?? process.env.ORCA_PUSH_TEST_DATABASE_URL

const cleanups: (() => Promise<void>)[] = []
export async function cleanupDurablePushFixtures(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
}
export const notification = (seq: number, kind: 'alert' | 'dismiss' = 'alert'): PushNotification => ({
  notificationId: `notification-${seq}`,
  notificationEpoch: 'epoch',
  notificationSeq: seq,
  source: 'agent-task-complete',
  agentState: 'finished',
  title: 'Done',
  body: '',
  kind
})
export async function fixture() {
  const databaseUrl = durablePushTestDatabaseUrl
  if (databaseUrl && !process.env.CI && new URL(databaseUrl).port !== '55440')
    throw new Error('isolated_postgres_port_required')
  let db: PushDatabase
  if (databaseUrl) {
    const admin = new pg.Client({ connectionString: databaseUrl })
    await admin.connect()
    const schema = `durable_${randomUUID().replaceAll('-', '')}`
    let scoped: PushDatabase | undefined
    cleanups.push(async () => {
      try {
        await scoped?.close()
      } finally {
        try {
          await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
        } finally {
          await admin.end()
        }
      }
    })
    await admin.query(`CREATE SCHEMA ${schema}`)
    const url = new URL(databaseUrl)
    url.searchParams.set('options', `-c search_path=${schema}`)
    db = scoped = await openPushDatabase({ databaseUrl: url.toString(), dataDir: '', poolMax: 4 })
  } else {
    db = await openInMemoryPushDatabase()
    cleanups.push(() => db.close())
  }
  let now = 1_000_000
  const clock = () => now
  return {
    db,
    store: new DurablePushStore(db, clock),
    clock,
    advance: (ms: number) => {
      now += ms
    }
  }
}
