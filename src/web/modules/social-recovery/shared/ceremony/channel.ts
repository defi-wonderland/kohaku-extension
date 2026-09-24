/**
 * The return channel: how the ceremony tab hands its outcome back to the row
 * that opened it.
 *
 * The tab writes one report under `socialRecoveryCeremonyResult:<request id>`
 * in the extension's local storage (the `storage` of
 * `@web/extension-services/background/webapi/storage`, D-310), through the
 * visibility gate: a hidden tab writes nothing until it is shown again, so a
 * hand-off to a phone reports its result when the tab returns (D-316). The
 * caller reads the report when it mounts again, or listens for it, and takes
 * it once. No background controller is involved.
 *
 * Storage and the listener are parameters, so the channel runs under node.
 */
import type { CeremonyParams } from './request'
import { CeremonyCall, CeremonyOutcome, isCeremonyCall, isCeremonyVerdict } from './verdicts'
import type { VisibilityGate } from './visibility'

export const CEREMONY_RESULT_KEY_PREFIX = 'socialRecoveryCeremonyResult:'

export const ceremonyResultKey = (id: string): string => `${CEREMONY_RESULT_KEY_PREFIX}${id}`

/** One ceremony's outcome as the caller reads it. */
export interface CeremonyReport<T = unknown> {
  id: string
  call: CeremonyCall
  method: string
  outcome: CeremonyOutcome<T>
  reportedAt: number
}

/** The part of the extension's storage the channel uses. */
export interface ReportStore {
  get(key: string, defaultValue?: unknown): Promise<unknown>
  set(key: string, value: unknown): Promise<unknown>
  remove(key: string): Promise<unknown>
}

/** Subscribes to changes of one storage key; returns the unsubscribe. */
export type ReportSubscribe = (key: string, onValue: (value: unknown) => void) => () => void

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** Whether `value` is a well-formed report: one of the four verdicts or a dismissal. */
export const isCeremonyReport = (value: unknown): value is CeremonyReport => {
  if (typeof value !== 'object' || value === null) return false
  const report = value as Partial<CeremonyReport>
  if (typeof report.id !== 'string' || typeof report.method !== 'string') return false
  if (!isCeremonyCall(report.call) || typeof report.reportedAt !== 'number') return false
  const outcome = report.outcome as
    | { kind?: unknown; verdict?: unknown; note?: unknown }
    | undefined
  if (!outcome) return false
  if (outcome.kind === 'verdict') return isCeremonyVerdict(outcome.verdict)
  return (
    outcome.kind === 'dismissed' && (outcome.note === 'cancelled' || outcome.note === 'refused')
  )
}

/** The report the tab writes for `params`. */
export const ceremonyReport = <T>(
  params: Pick<CeremonyParams, 'id' | 'call' | 'method'>,
  outcome: CeremonyOutcome<T>,
  reportedAt: number
): CeremonyReport<T> => ({
  id: params.id,
  call: params.call,
  method: params.method,
  outcome,
  reportedAt
})

/**
 * Writes the report through the gate: at once where the tab is visible, when
 * it is shown again where it is hidden (D-316).
 */
export const sendCeremonyReport = (
  report: CeremonyReport,
  deps: { store: ReportStore; gate: VisibilityGate }
): Promise<unknown> =>
  deps.gate.dispatch(() => deps.store.set(ceremonyResultKey(report.id), report))

/** The report stored for `id`, or null. A malformed value reads null. */
export const readCeremonyReport = async (
  id: string,
  store: ReportStore
): Promise<CeremonyReport | null> => {
  const value = parseMaybeJson(await store.get(ceremonyResultKey(id), null))
  return isCeremonyReport(value) && value.id === id ? value : null
}

/** Reads the report for `id` and removes it, so a row applies an outcome once. */
export const takeCeremonyReport = async (
  id: string,
  store: ReportStore
): Promise<CeremonyReport | null> => {
  const report = await readCeremonyReport(id, store)
  if (report) await store.remove(ceremonyResultKey(id))
  return report
}

/** Calls `onReport` with each well-formed report written for `id`; returns the unsubscribe. */
export const listenForCeremonyReport = (
  id: string,
  subscribe: ReportSubscribe,
  onReport: (report: CeremonyReport) => void
): (() => void) =>
  subscribe(ceremonyResultKey(id), (value) => {
    const parsed = parseMaybeJson(value)
    if (isCeremonyReport(parsed) && parsed.id === id) onReport(parsed)
  })
