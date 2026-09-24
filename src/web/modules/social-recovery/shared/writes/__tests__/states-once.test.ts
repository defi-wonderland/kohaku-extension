/**
 * PT-039, done entry 1: the submitting state and the failed state exist once,
 * and every write of the chapter renders them. The module exports exactly one
 * submitting state and one failed state type with two readings, and the two
 * readings are distinct states, never one state with a flag.
 *
 * Sources: docs/social-recovery/tasks/PT-039-the-shared-write-states-and-the-gas-step.md
 * ("Done"), briefs/PT-039.md ("Shape", "Test expectations"), design/ux.md
 * D-319 ("It gets the shared submitting and failed states every owner-signed
 * write shares") and D-307 (the cancel gets the same failure state).
 */
import fs from 'fs'
import path from 'path'

import {
  CHAPTER_WRITES,
  CONTROLLER,
  copyOfState,
  failBeforeHash,
  FAILED_STATUSES,
  FailedState,
  FailedStatus,
  failThrown,
  failWithReceipt,
  kitError,
  minedAndReverted,
  SubmittingState,
  submittingFor,
  UNRESOLVED,
  userRejected,
  WRITE_KINDS,
  WRITE_STATUSES,
  WriteState
} from './harness'

// Type-level: `tsc --noEmit` fails where the failed state type is not exactly
// the two readings, or the submitting state is not the one status.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const FAILED_IS_TWO_READINGS: Equals<FailedState['status'], 'failedNotSent' | 'failedReverted'> =
  true
const FAILED_STATUS_IS_THE_TYPE: Equals<FailedStatus, FailedState['status']> = true
const ONE_SUBMITTING: Equals<SubmittingState['status'], 'submitting'> = true
const SUBMITTING_IN_THE_UNION: Equals<
  Extract<WriteState['status'], `${string}ubmit${string}`>,
  'submitting'
> = true
const FAILED_IN_THE_UNION: Equals<
  Extract<WriteState['status'], `${string}ail${string}`>,
  FailedState['status']
> = true

const LANE = path.resolve(__dirname, '..')

const sourcesOf = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourcesOf(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })

describe('the shared write states exist once', () => {
  it('holds at type level (checked by tsc)', () => {
    expect([
      FAILED_IS_TWO_READINGS,
      FAILED_STATUS_IS_THE_TYPE,
      ONE_SUBMITTING,
      SUBMITTING_IN_THE_UNION,
      FAILED_IN_THE_UNION
    ]).toEqual([true, true, true, true, true])
  })

  it('exports exactly one submitting state', () => {
    expect(WRITE_STATUSES.filter((status) => /submit/i.test(status))).toEqual(['submitting'])
  })

  it('exports one failed state type with exactly two readings', () => {
    expect(FAILED_STATUSES).toHaveLength(2)
    expect(WRITE_STATUSES.filter((status) => /fail/i.test(status)).sort()).toEqual(
      [...FAILED_STATUSES].sort()
    )
  })

  it('the two readings are distinct states, never one state with a flag', () => {
    const notSent = failBeforeHash('save', userRejected())
    const reverted = failWithReceipt('save', kitError('WrongSetupNonce'))
    expect(notSent.status).not.toEqual(reverted.status)
    expect([notSent.status, reverted.status].sort()).toEqual([...FAILED_STATUSES].sort())
  })

  it('every failure of every write lands in one of those two readings, the reverted cancel included', () => {
    const statuses = new Set(
      WRITE_KINDS.flatMap((write) => [
        failBeforeHash(write, userRejected()).status,
        failWithReceipt(write, kitError('NoActiveAttempt'), {
          ended: 'executed',
          controller: CONTROLLER
        }).status,
        failThrown(write, minedAndReverted()).status
      ])
    )
    expect([...statuses].sort()).toEqual([...FAILED_STATUSES].sort())
  })

  it('the writes the chapter names are writes of this module', () => {
    expect(WRITE_KINDS).toEqual(expect.arrayContaining(CHAPTER_WRITES))
  })

  WRITE_KINDS.forEach((write) =>
    it(`${write} enters the one submitting state and renders it through en.json`, () => {
      const state = submittingFor(write)
      expect(state.status).toBe('submitting')
      const rendered = copyOfState(state)
      expect(rendered.length).toBeGreaterThan(1)
      expect(rendered.filter((s) => UNRESOLVED.test(s))).toEqual([])
    })
  )

  it('no source of the lane names a second submitting or failed state', () => {
    const literals = new Set(
      sourcesOf(LANE).flatMap((file) => {
        const code = fs
          .readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        return (code.match(/['"`](?:submitting|failed\w*)['"`]/gi) ?? []).map((literal) =>
          literal.slice(1, -1)
        )
      })
    )
    expect([...literals].sort()).toEqual(['submitting', ...FAILED_STATUSES].sort())
  })
})
