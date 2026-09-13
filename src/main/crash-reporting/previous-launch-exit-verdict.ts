// Answers one question the crash report could never answer before: did the main
// process that recorded the previous session's reports exit, or was it killed?
// The evidence is the durable-breadcrumb trail already in the NDJSON trace file —
// a launch that ends without `main_process_quit_committed` died abruptly.

import { open } from 'node:fs/promises'
import type { CrashReportDetailValue } from '../../shared/crash-reporting'
import { listRotatedFiles } from '../observability/local-file-sink'
import { getTraceFilePath } from '../observability/logs-directory'
import { readLinesNewestFirst } from '../observability/ndjson-line-scan'
import { COMMITTED_QUIT_BREADCRUMB_NAME } from './committed-quit-breadcrumb'
import type { CrashReportStore } from './crash-report-store'
import { getMainProcessLifecycleIdentity } from './main-process-lifecycle-identity'

export type PreviousLaunchExit = {
  previousLaunchId: string
  diedAbruptly: boolean
}

const BREADCRUMB_SPAN_NAME = 'crash.breadcrumb'
/** Enough tail to hold a launch's closing crumbs without reading a 10 MB file. */
const TRACE_TAIL_BYTES = 512 * 1024
/** The newest file plus the one rotation a launch boundary can fall across. */
const TRACE_FILES_SCANNED = 2
// Why bounded yet conclusive: the quit crumb is written the moment quit commits, so
// only teardown-time crumbs can follow it. Its absence from a launch's newest crumbs
// is its absence from the launch.
const PREVIOUS_LAUNCH_CRUMB_SCAN_LIMIT = 200

type TracedBreadcrumb = { name: string; launchId: string }

function tracedBreadcrumb(line: string): TracedBreadcrumb | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    // A tail read starts mid-line, and a killed process leaves a half-line.
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const record = parsed as { name?: unknown; attributes?: unknown }
  if (record.name !== BREADCRUMB_SPAN_NAME || !record.attributes) {
    return null
  }
  const attributes = record.attributes as Record<string, unknown>
  const name = attributes['breadcrumb.name']
  const data = attributes['breadcrumb.data'] as Record<string, unknown> | undefined
  const launchId = data?.mainProcessLaunchId
  if (typeof name !== 'string' || typeof launchId !== 'string' || !launchId) {
    return null
  }
  return { name, launchId }
}

/** Scans a trace tail newest-first for the launch that preceded `currentLaunchId`.
 *  Returns null when no other launch left a breadcrumb in the tail. */
export function findPreviousLaunchExit(
  traceTail: string,
  currentLaunchId: string
): PreviousLaunchExit | null {
  let previousLaunchId: string | undefined
  let scanned = 0
  for (const line of readLinesNewestFirst(traceTail)) {
    const crumb = tracedBreadcrumb(line)
    if (!crumb || crumb.launchId === currentLaunchId) {
      continue
    }
    if (previousLaunchId === undefined) {
      previousLaunchId = crumb.launchId
    } else if (crumb.launchId !== previousLaunchId) {
      break
    }
    if (crumb.name === COMMITTED_QUIT_BREADCRUMB_NAME) {
      return { previousLaunchId, diedAbruptly: false }
    }
    scanned += 1
    if (scanned >= PREVIOUS_LAUNCH_CRUMB_SCAN_LIMIT) {
      break
    }
  }
  return previousLaunchId === undefined ? null : { previousLaunchId, diedAbruptly: true }
}

async function readTraceTail(filePath: string, maxBytes: number): Promise<string | null> {
  let handle
  try {
    handle = await open(filePath, 'r')
  } catch {
    return null
  }
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, maxBytes)
    if (length <= 0) {
      return null
    }
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

export async function loadPreviousLaunchExit(
  currentLaunchId: string,
  traceFilePaths: string[]
): Promise<PreviousLaunchExit | null> {
  for (const filePath of traceFilePaths) {
    const tail = await readTraceTail(filePath, TRACE_TAIL_BYTES)
    if (tail === null) {
      continue
    }
    const exit = findPreviousLaunchExit(tail, currentLaunchId)
    if (exit) {
      return exit
    }
  }
  return null
}

let previousLaunchExit: PreviousLaunchExit | null = null

/** Reports this session records name the previous launch's fate, so an abrupt
 *  whole-app death is visible even in the run that followed it. */
export function previousLaunchExitDetails(): Record<string, CrashReportDetailValue> {
  if (!previousLaunchExit) {
    return {}
  }
  return {
    previousMainProcessLaunchId: previousLaunchExit.previousLaunchId,
    previousMainProcessDiedAbruptly: previousLaunchExit.diedAbruptly
  }
}

/** Backfills the reports the dead launch itself recorded — the ones a triager
 *  actually opens, whose post-death process census reads as "the browser survived". */
export async function annotateAbruptlyEndedLaunchReports(
  store: Pick<CrashReportStore, 'listRecent' | 'attachDetails'>,
  exit: PreviousLaunchExit | null = previousLaunchExit
): Promise<void> {
  if (!exit?.diedAbruptly) {
    return
  }
  for (const report of await store.listRecent()) {
    if (
      report.details.mainProcessLaunchId !== exit.previousLaunchId ||
      report.details.mainProcessDiedAbruptly === true
    ) {
      continue
    }
    await store.attachDetails(report.id, { mainProcessDiedAbruptly: true })
  }
}

/** Startup entry point: resolve the previous launch's fate, then stamp it onto the
 *  reports it left behind. Diagnostics only — never fails a launch. */
export async function initPreviousLaunchExitVerdict(
  store: Pick<CrashReportStore, 'listRecent' | 'attachDetails'> | null
): Promise<void> {
  try {
    previousLaunchExit = await loadPreviousLaunchExit(
      getMainProcessLifecycleIdentity().mainProcessLaunchId,
      listRotatedFiles(getTraceFilePath(), TRACE_FILES_SCANNED)
    )
    if (store) {
      await annotateAbruptlyEndedLaunchReports(store)
    }
  } catch (error) {
    console.warn('[crash-reporting] previous-launch exit verdict unavailable:', error)
  }
}

export function setPreviousLaunchExitForTest(exit: PreviousLaunchExit | null): void {
  previousLaunchExit = exit
}
