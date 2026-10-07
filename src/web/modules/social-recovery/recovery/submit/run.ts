/**
 * The submission's run: the shared write machine for the gas check, the send
 * and the receipt, the claim of the submission on the live session, and after
 * a landed receipt the attempt read that decides whether the session lands.
 *
 *   idle ──start──▶ checkingGas: the session read, the attempt read, the prepare, the gas check
 *                     ├─ a claim on the session ─▶ followed (nothing sent)
 *                     ├─ this request's attempt started ─▶ the landing
 *                     ├─ another attempt runs ─▶ already running (no retry)
 *                     ├─ deposit ──▶ needsDeposit ──the balance read again──▶ the claim
 *                     └─ enough ───▶ the claim
 *                                     ├─ another page's claim ─▶ followed (nothing sent)
 *                                     └─ its own ──▶ submitting ──▶ failedNotSent | failedReverted | landed
 *   followed, a hash ──▶ its receipt, as after a send
 *   followed, no hash ──▶ the session read again until a hash arrives, the
 *                         claim goes, or the claim grows older than the
 *                         steps' claim age: where the wallet no longer holds
 *                         the request, the manager's events then name the
 *                         attempt started (the landing) or not (the claim
 *                         released where it still carries no hash, the start
 *                         offered again)
 *   followed, the session wiped or gone ──▶ back to the checklist
 *   submitting with a hash, on arrival or check again, the claim older than
 *   `DROPPED_AFTER_MS`, the node knowing none of its hashes and the manager
 *   no attempt ──▶ dropped: the claim released, the start offered again
 *   reverted as already running ──▶ the attempt read: ours is the landing
 *   the prepare's set not the one verified ──▶ back to the checklist
 *   landed ──▶ confirming: the attempt read names this request's attempt ──▶ the session landed ──▶ landed
 *                         └──▶ unread ──reread──▶ confirming
 *
 * The session is read before anything is prepared, so a retry, a reload or a
 * second tab never sends a second submission for the same request: a claim
 * the session carries is followed, never sent again, and a page sends only
 * under the claim it wrote itself, with nothing awaited between the claim and
 * the hand-over to the wallet. The claim is released where the run ended with
 * nothing on its way to the chain (a send the wallet refused, a replaced
 * transaction, a revert). A send that may still land keeps it. The session
 * lands, and the screen reads landed, only after the attempt read agrees with
 * the request of this run. Every answer carries its run, so the answer of a
 * run the holder left behind moves nothing.
 */
import type { SubmissionInFlightRecord } from '@web/modules/social-recovery/shared/records'
import {
  initialWriteState,
  mayStillLand,
  writeReducer
} from '@web/modules/social-recovery/shared/writes'
import type { WriteEvent } from '@web/modules/social-recovery/shared/writes'

import { BALANCE_POLL_MS, DROPPED_AFTER_MS, FOLLOW_REREAD_MS, READ_LIMIT_MS } from './constants'
import { preparedRefusalRunning, revertedRunning } from './refusal'
import type {
  FollowedClaim,
  OldClaimReading,
  SubmitEvent,
  SubmitState,
  SubmitSteps,
  SubmitStore
} from './types'

/** The submission before anything ran. */
export const initialSubmitState = (): SubmitState => ({
  write: initialWriteState('submission'),
  after: 'none'
})

const inRun = (state: SubmitState, run: number): boolean => state.write.run === run

/** Whether the run's start landed: its receipt, or its attempt found started while no page followed it. */
export const landedOf = (state: SubmitState): boolean =>
  state.write.status === 'landed' || !!state.landedUnseen

const landedIn = (state: SubmitState, run: number): boolean => inRun(state, run) && landedOf(state)

/** Whether the run submits with no hash yet: the wallet's window waits, or a followed claim is read. */
const awaitingHashIn = (state: SubmitState, run: number): boolean =>
  inRun(state, run) &&
  state.write.status === 'submitting' &&
  !state.write.transactionHash &&
  !state.landedUnseen

/** The hash of the run's start while it waits for its receipt. */
const pendingHashIn = (state: SubmitState, run: number) =>
  inRun(state, run) && state.write.status === 'submitting' && !state.landedUnseen
    ? state.write.transactionHash
    : undefined

/** The submission's reducer. Pure: an event a state does not take leaves it as it was (the same object). */
export const submitReducer = (state: SubmitState, event: SubmitEvent): SubmitState => {
  switch (event.type) {
    case 'write': {
      // The manager refused the start while another attempt runs: nothing starts it again.
      if (state.refusal) {
        return state
      }
      const write = writeReducer(state.write, event.event)
      if (write === state.write) {
        return state
      }
      if (write.run !== state.write.run) {
        return { write, after: 'none', ...(state.lookup ? { lookup: state.lookup } : {}) }
      }
      const next: SubmitState = { ...state, write }
      if (state.follow && (write.status !== 'submitting' || write.transactionHash)) {
        delete next.follow
      }
      if (write.status !== 'needsDeposit') {
        delete next.balance
      }
      return next
    }
    case 'lookup':
      if (
        !inRun(state, event.run) ||
        state.write.status !== 'idle' ||
        state.refusal ||
        state.lookup === event.reading
      ) {
        return state
      }
      return { ...state, lookup: event.reading }
    case 'prepared':
      if (!inRun(state, event.run) || state.write.status !== 'checkingGas') {
        return state
      }
      return { ...state, prepared: event.prepared }
    case 'claimed':
      if (!awaitingHashIn(state, event.run) || state.requestId || state.follow) {
        return state
      }
      return { ...state, requestId: event.requestId }
    case 'released': {
      if (!inRun(state, event.run) || !state.requestId) {
        return state
      }
      const { requestId, ...rest } = state
      return rest
    }
    case 'follow': {
      // From an idle run, or one whose send may still land, a new run follows
      // the claim; in a run whose own claim lost, the run follows it instead.
      const opens =
        inRun(state, event.run) &&
        !state.refusal &&
        !landedOf(state) &&
        (state.write.status === 'idle' || mayStillLand(state.write))
      if (!opens && (!awaitingHashIn(state, event.run) || state.requestId || state.follow)) {
        return state
      }
      const run = opens ? event.run + 1 : event.run
      const { claim } = event
      const hash = claim.transactionHash
      return {
        write: {
          status: 'submitting',
          write: 'submission',
          run,
          ...(hash
            ? { transactionHash: hash, sentHashes: [hash], startBlock: claim.startBlock }
            : {})
        },
        after: 'none',
        followed: claim.requestId,
        ...(hash
          ? {}
          : {
              follow: {
                requestId: claim.requestId,
                startBlock: claim.startBlock,
                claimedAt: claim.claimedAt
              }
            }),
        ...(state.lookup ? { lookup: state.lookup } : {}),
        ...(state.prepared ? { prepared: state.prepared } : {})
      }
    }
    case 'voided':
      // A followed claim that went, or that never went out: the start is offered again.
      if (!awaitingHashIn(state, event.run)) {
        return state
      }
      return { write: writeReducer(state.write, { type: 'reset' }), after: 'none', lookup: 'none' }
    case 'dropped':
      // A hash the node lost, with no attempt on the chain: the start is offered again.
      if (!pendingHashIn(state, event.run)) {
        return state
      }
      return { write: writeReducer(state.write, { type: 'reset' }), after: 'none', lookup: 'none' }
    case 'toChecklist':
      if (
        !inRun(state, event.run) ||
        (state.write.status !== 'checkingGas' && !awaitingHashIn(state, event.run))
      ) {
        return state
      }
      return {
        write: writeReducer(state.write, { type: 'reset' }),
        after: 'none',
        toChecklist: true
      }
    case 'refused':
      if (
        !inRun(state, event.run) ||
        (state.write.status !== 'checkingGas' && !awaitingHashIn(state, event.run))
      ) {
        return state
      }
      return {
        write: writeReducer(state.write, { type: 'reset' }),
        after: 'none',
        refusal: 'already-running'
      }
    case 'balance':
      if (
        !inRun(state, event.run) ||
        state.write.status !== 'needsDeposit' ||
        state.balance === event.balance
      ) {
        return state
      }
      return { ...state, balance: event.balance }
    case 'landedUnseen': {
      const { write } = state
      if (
        !inRun(state, event.run) ||
        state.landedUnseen ||
        state.after !== 'none' ||
        !(
          write.status === 'checkingGas' ||
          write.status === 'submitting' ||
          mayStillLand(write) ||
          revertedRunning(write)
        )
      ) {
        return state
      }
      const { follow, ...rest } = state
      return { ...rest, landedUnseen: true }
    }
    case 'confirming':
      if (!landedIn(state, event.run) || (state.after !== 'none' && state.after !== 'unread')) {
        return state
      }
      return { ...state, after: 'confirming' }
    case 'unread':
      if (!landedIn(state, event.run) || state.after !== 'confirming') {
        return state
      }
      return { ...state, after: 'unread' }
    case 'landed':
      if (!landedIn(state, event.run) || state.after !== 'confirming') {
        return state
      }
      return { ...state, after: 'landed' }
    default:
      return state
  }
}

/** A store over the reducer, starting from `initial` or from nothing. */
export const createSubmitStore = (initial: SubmitState = initialSubmitState()): SubmitStore => {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    state: () => current,
    dispatch(event) {
      const next = submitReducer(current, event)
      if (next !== current) {
        current = next
        listeners.forEach((listener) => listener())
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

/**
 * Whether the run still has work in flight a new start must not repeat: the
 * reads before the send, the deposit step's reads, the send or its receipt
 * wait, a followed claim, or the landing.
 */
export const isLive = (state: SubmitState): boolean => {
  if (state.refusal) {
    return false
  }
  if (landedOf(state)) {
    return state.after === 'none' || state.after === 'confirming'
  }
  const { status } = state.write
  return status === 'checkingGas' || status === 'needsDeposit' || status === 'submitting'
}

/**
 * Whether the screen keeps the run when it leaves it, so the next arrival
 * takes it up: work in flight, a send that may still land, and a landing whose
 * attempt read did not answer. Every other ended run is dropped, and the next
 * arrival reads the session again.
 */
export const outlivesScreen = (state: SubmitState): boolean =>
  isLive(state) || state.after === 'unread' || (!landedOf(state) && mayStillLand(state.write))

/** Whether the screen reads the submission as landed: only after the attempt read agreed and the session landed. */
export const isLanded = (state: SubmitState): boolean => state.after === 'landed'

const writeEvent = (store: SubmitStore) => (event: WriteEvent) =>
  store.dispatch({ type: 'write', event })

/** The answer of `read`, rejected where it does not answer within `limitMs`. */
const readWithin = <T>(read: () => Promise<T>, limitMs: number = READ_LIMIT_MS): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer in ${limitMs} ms.`)), limitMs)
    read().then(
      (answer) => {
        clearTimeout(timer)
        resolve(answer)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

// The steps of the screen attached to each store, while one is.
const ATTACHED = new WeakMap<SubmitStore, SubmitSteps>()

// The wake of a store's rest, so "check again" or a new screen reads at once.
const WAKES = new WeakMap<SubmitStore, () => void>()

// The stores whose followed claim is read now, and whose deposit step reads the balance now.
const FOLLOWING = new WeakSet<SubmitStore>()
const POLLING = new WeakSet<SubmitStore>()
const DROPPING = new WeakSet<SubmitStore>()

// The run and hash whose receipt each store waits for now.
const WAITING = new WeakMap<SubmitStore, string>()

/** Rests for `ms`, or until the holder asks to check again or a screen attaches. */
const rest = (store: SubmitStore, ms: number): Promise<void> =>
  new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      clearTimeout(timer)
      if (WAKES.get(store) === wake) {
        WAKES.delete(store)
      }
      resolve()
    }
    timer = setTimeout(wake, ms)
    WAKES.set(store, wake)
  })

/**
 * Whether the run ended with nothing on its way to the chain, so its claim
 * goes: a start never sent that cannot still land (refused, replaced), or a
 * revert. A landing, a send that may still land and a receipt wait keep it.
 */
const endedWithNothingInFlight = (state: SubmitState): boolean =>
  !landedOf(state) &&
  (state.write.status === 'failedReverted' ||
    (state.write.status === 'failedNotSent' && !mayStillLand(state.write)))

/** Releases the claim the run sent or followed where the run ended with nothing on its way to the chain. */
const releaseWhereEnded = async (store: SubmitStore, steps: SubmitSteps): Promise<void> => {
  const state = store.state()
  const requestId = state.requestId ?? state.followed
  if (!requestId || !endedWithNothingInFlight(state)) {
    return
  }
  store.dispatch({ type: 'released', run: state.write.run })
  await steps.release(requestId).catch(() => undefined)
}

/**
 * After a landing: the attempt read must name this request's attempt, under
 * its setup number; then the session lands as the countdown's record. A read
 * that fails, that disagrees, or a landing that fails reads unread, with the
 * read again on offer, never landed.
 */
const settle = async (store: SubmitStore, steps: SubmitSteps, run: number): Promise<void> => {
  if (!landedIn(store.state(), run)) {
    return
  }
  // Only the settle whose event moved the run goes on, so a second one never reads or lands again.
  const before = store.state()
  store.dispatch({ type: 'confirming', run })
  if (store.state() === before) {
    return
  }
  let agreed = false
  try {
    agreed = steps.attemptOf(await readWithin(() => steps.attemptRead())) === 'ours'
  } catch {
    agreed = false
  }
  if (!agreed) {
    store.dispatch({ type: 'unread', run })
    return
  }
  try {
    await steps.land()
  } catch {
    store.dispatch({ type: 'unread', run })
    return
  }
  store.dispatch({ type: 'landed', run })
}

/**
 * After a revert that names an attempt already running: the attempt read
 * decides whose. This request's own (its number, setup number and payload)
 * is the landing; another's, or a read that fails, keeps the refusal.
 */
const judgeRevert = async (store: SubmitStore, steps: SubmitSteps, run: number): Promise<void> => {
  if (!inRun(store.state(), run) || !revertedRunning(store.state().write)) {
    return
  }
  const attempt = await readWithin(() => steps.attemptRead()).then(
    (read) => steps.attemptOf(read),
    () => undefined
  )
  if (attempt === 'ours') {
    store.dispatch({ type: 'landedUnseen', run })
  }
}

/**
 * Whether the hash the run waits on was dropped: the claim it sends or
 * follows is older than `DROPPED_AFTER_MS` by the clock read before the
 * reads, the node knows none of the run's hashes, and the attempt read finds
 * no attempt; the claim is then released, unless it carries a hash the run
 * does not know, and the start offered again. This request's attempt found
 * started is the landing. A read that fails, or a run that moved meanwhile,
 * reads nothing as dropped. Answers whether the check ended the wait.
 */
const checkDropped = async (store: SubmitStore, steps: SubmitSteps): Promise<boolean> => {
  const state = store.state()
  const { write } = state
  const { run } = write
  const hash = pendingHashIn(state, run)
  const requestId = state.requestId ?? state.followed
  if (!hash || !requestId || write.status !== 'submitting' || DROPPING.has(store)) {
    return false
  }
  const hashes = write.sentHashes ?? [hash]
  const unmoved = () => pendingHashIn(store.state(), run) === hash
  DROPPING.add(store)
  try {
    const clock = steps.now()
    const read = await readWithin(() => steps.readSession()).catch(() => undefined)
    const held =
      read?.status === 'present' && read.value.state === 'live' ? read.value.submission : undefined
    if (
      !unmoved() ||
      !held ||
      held.requestId !== requestId ||
      clock - held.claimedAt < DROPPED_AFTER_MS
    ) {
      return false
    }
    const known = await readWithin(() =>
      Promise.all(hashes.map((one) => steps.transactionKnown(one)))
    ).catch(() => undefined)
    if (!unmoved() || !known || known.some((answer) => answer !== 'unknown')) {
      return false
    }
    const attempt = await readWithin(() => steps.attemptRead()).then(
      (answer) => steps.attemptOf(answer),
      () => undefined
    )
    if (!unmoved() || (attempt !== 'ours' && attempt !== 'none')) {
      return false
    }
    if (attempt === 'ours') {
      store.dispatch({ type: 'landedUnseen', run })
      await settle(store, steps, run)
      return true
    }
    const released = await steps.releaseClaim(requestId, hashes).catch(() => undefined)
    if (!unmoved() || released?.status !== 'released') {
      return false
    }
    store.dispatch({ type: 'dropped', run })
    return true
  } finally {
    DROPPING.delete(store)
  }
}

/**
 * Waits for the receipt of the hash the run holds, after the check for a
 * dropped hash, then releases where it ended, then the landing.
 */
const waitForReceipt = async (store: SubmitStore, steps: SubmitSteps): Promise<void> => {
  if (await checkDropped(store, steps)) {
    return
  }
  const state = store.state()
  const { run } = state.write
  const hash = pendingHashIn(state, run)
  const waiting = `${run}:${hash?.toLowerCase()}`
  if (!hash || WAITING.get(store) === waiting) {
    return
  }
  WAITING.set(store, waiting)
  try {
    const startBlock = state.write.status === 'submitting' ? state.write.startBlock : undefined
    await steps.waitAgain(hash, startBlock, writeEvent(store), run)
  } finally {
    if (WAITING.get(store) === waiting) {
      WAITING.delete(store)
    }
  }
  await judgeRevert(store, steps, run)
  await releaseWhereEnded(store, steps)
  await settle(store, steps, run)
}

/**
 * The judgement of a followed claim with no hash older than the steps' claim
 * age: where the wallet still holds its request, it is waited on; broadcast,
 * the hash is written on the claim and followed; else the manager's events
 * name the attempt started, or the claim is released where it still carries
 * no hash. A claim that took a hash meanwhile is followed under it.
 */
const judgeOldClaim = async (
  steps: SubmitSteps,
  follow: FollowedClaim
): Promise<OldClaimReading> => {
  const hold = await readWithin(() => steps.requestHold(follow.requestId)).catch(() => undefined)
  if (!hold || hold.status === 'held') {
    return { status: 'wait' }
  }
  if (hold.status === 'broadcast') {
    await steps.markSent(follow, hold.transactionHash).catch(() => undefined)
    return { status: 'hashed', transactionHash: hold.transactionHash }
  }
  const started = await readWithin(() => steps.startedSince(follow)).catch(() => undefined)
  if (started === undefined) {
    return { status: 'wait' }
  }
  if (started) {
    return { status: 'started' }
  }
  const released = await steps.releaseClaim(follow.requestId, []).catch(() => undefined)
  return released ?? { status: 'wait' }
}

/**
 * Reads the followed claim with no hash while a screen is attached: a hash
 * that arrives is waited on; a claim that went, or another page's claim in its
 * place, ends the follow (the latter is followed in turn); a landed session
 * lands here too. A claim older than `SUBMISSION_CLAIM_AGE_MS` by the clock
 * read before the session read is judged by the manager's events: an attempt
 * started under the request's attempt number is the landing, none means the
 * send never went out, and the claim is released and the start offered again.
 * A read that fails is read again after a rest, never taken as an answer.
 */
const readFollow = async (store: SubmitStore): Promise<void> => {
  if (FOLLOWING.has(store)) {
    return
  }
  FOLLOWING.add(store)
  let waitAfter = false
  try {
    for (;;) {
      const steps = ATTACHED.get(store)
      const state = store.state()
      const { follow } = state
      const { run } = state.write
      if (!steps || !follow || !awaitingHashIn(state, run)) {
        return
      }
      const clock = steps.now()
      // eslint-disable-next-line no-await-in-loop
      const read = await readWithin(() => steps.readSession()).catch(() => undefined)
      if (store.state().follow !== follow) {
        // eslint-disable-next-line no-continue
        continue
      }
      if (read?.status === 'present' && read.value.state === 'landed') {
        store.dispatch({ type: 'landedUnseen', run })
        // eslint-disable-next-line no-await-in-loop
        await settle(store, steps, run)
        return
      }
      if (
        read?.status === 'absent' ||
        (read?.status === 'present' && read.value.state !== 'live')
      ) {
        store.dispatch({ type: 'toChecklist', run })
        return
      }
      const held: SubmissionInFlightRecord | undefined =
        read?.status === 'present' && read.value.state === 'live'
          ? read.value.submission
          : undefined
      if (read && !held) {
        store.dispatch({ type: 'voided', run })
        return
      }
      if (held && held.requestId !== follow.requestId) {
        store.dispatch({ type: 'voided', run })
        store.dispatch({ type: 'follow', run, claim: held })
        if (held.transactionHash) {
          waitAfter = true
          return
        }
        // eslint-disable-next-line no-continue
        continue
      }
      if (held?.transactionHash) {
        writeEvent(store)({
          type: 'sent',
          run,
          transactionHash: held.transactionHash,
          startBlock: held.startBlock
        })
        waitAfter = true
        return
      }
      if (held && clock - held.claimedAt >= steps.claimAgeMs) {
        // eslint-disable-next-line no-await-in-loop
        const judged = await judgeOldClaim(steps, follow)
        if (store.state().follow !== follow) {
          // eslint-disable-next-line no-continue
          continue
        }
        if (judged.status === 'started') {
          store.dispatch({ type: 'landedUnseen', run })
          // eslint-disable-next-line no-await-in-loop
          await settle(store, steps, run)
          return
        }
        if (judged.status === 'hashed') {
          writeEvent(store)({
            type: 'sent',
            run,
            transactionHash: judged.transactionHash,
            startBlock: follow.startBlock
          })
          waitAfter = true
          return
        }
        if (judged.status === 'released') {
          store.dispatch({ type: 'voided', run })
          return
        }
        if (judged.status === 'gone') {
          // eslint-disable-next-line no-continue
          continue
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await rest(store, FOLLOW_REREAD_MS)
    }
  } finally {
    FOLLOWING.delete(store)
    if (waitAfter) {
      const steps = ATTACHED.get(store)
      if (steps) {
        waitForReceipt(store, steps).catch(() => undefined)
      }
    }
  }
}

/** Follows a claim in place of a send: under its hash its receipt is waited on, with none it is read. */
const followClaim = async (
  store: SubmitStore,
  steps: SubmitSteps,
  run: number,
  claim: SubmissionInFlightRecord
): Promise<void> => {
  const before = store.state()
  store.dispatch({ type: 'follow', run, claim })
  if (store.state() === before) {
    return
  }
  if (claim.transactionHash) {
    await waitForReceipt(store, steps)
    return
  }
  await readFollow(store)
}

/**
 * The claim of the submission on the live session under a new request id,
 * with the block read before it, then the send under that claim; where the
 * session already carries a claim, it is followed and nothing is sent. Nothing
 * is awaited between the claim and the hand-over to the wallet.
 */
const claimAndSend = async (store: SubmitStore, steps: SubmitSteps, run: number): Promise<void> => {
  const { prepared } = store.state()
  if (!prepared || !awaitingHashIn(store.state(), run)) {
    return
  }
  const dispatch = writeEvent(store)
  let startBlock: number
  try {
    startBlock = await readWithin(() => steps.blockNumber())
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  if (!awaitingHashIn(store.state(), run)) {
    return
  }
  const requestId = steps.newRequestId()
  const ours = { requestId, startBlock, claimedAt: steps.now() }
  let claim
  try {
    claim = await steps.claim(ours)
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  if (!claim.claimed) {
    await followClaim(store, steps, run, claim.submission)
    return
  }
  store.dispatch({ type: 'claimed', run, requestId })
  if (store.state().requestId !== requestId) {
    await steps.release(requestId).catch(() => undefined)
    return
  }
  const sendDispatch = (event: WriteEvent) => {
    dispatch(event)
    // Only a hash the run took goes on the claim, never one of a run that ended.
    if (
      event.type === 'sent' &&
      event.run === run &&
      pendingHashIn(store.state(), run) === event.transactionHash
    ) {
      steps.markSent(ours, event.transactionHash).catch(() => undefined)
    }
  }
  try {
    await steps.send(prepared, sendDispatch, run, startBlock, requestId)
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
  }
  await judgeRevert(store, steps, run)
  await releaseWhereEnded(store, steps)
  await settle(store, steps, run)
}

/** The gas check of the run's prepared start; where the key holds enough, the claim and the send. */
const checkAndSend = async (store: SubmitStore, steps: SubmitSteps, run: number): Promise<void> => {
  const { prepared } = store.state()
  if (!prepared || !inRun(store.state(), run) || store.state().write.status !== 'checkingGas') {
    return
  }
  try {
    const check = await steps.checkGas(prepared)
    writeEvent(store)({ type: 'gasChecked', run, check })
  } catch (error: unknown) {
    writeEvent(store)({ type: 'error', run, error })
    return
  }
  if (store.state().write.status === 'needsDeposit') {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    pollDeposit(store).catch(() => undefined)
    return
  }
  await claimAndSend(store, steps, run)
}

/**
 * While the deposit step shows and a screen is attached: the gas check again
 * every `BALANCE_POLL_MS` on the same prepared start. Enough goes on to the
 * claim and the send by itself; short keeps the step with the latest balance;
 * a read that fails reads as the gas check's failure, with its retry.
 */
const pollDeposit = async (store: SubmitStore): Promise<void> => {
  if (POLLING.has(store)) {
    return
  }
  POLLING.add(store)
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      await rest(store, BALANCE_POLL_MS)
      const steps = ATTACHED.get(store)
      const state = store.state()
      const { run } = state.write
      if (!steps || state.write.status !== 'needsDeposit' || !state.prepared) {
        return
      }
      let check
      try {
        // eslint-disable-next-line no-await-in-loop
        check = await steps.checkGas(state.prepared)
      } catch (error: unknown) {
        if (inRun(store.state(), run) && store.state().write.status === 'needsDeposit') {
          writeEvent(store)({ type: 'recheck' })
          writeEvent(store)({ type: 'error', run, error })
        }
        return
      }
      if (!inRun(store.state(), run) || store.state().write.status !== 'needsDeposit') {
        return
      }
      if (check.kind === 'enough') {
        writeEvent(store)({ type: 'recheck' })
        writeEvent(store)({ type: 'gasChecked', run, check })
        POLLING.delete(store)
        // eslint-disable-next-line no-await-in-loop
        await claimAndSend(store, steps, run)
        return
      }
      store.dispatch({ type: 'balance', run, balance: check.step.balance })
    }
  } finally {
    POLLING.delete(store)
  }
}

/**
 * Starts the submission, from nothing or from a state that offers the retry:
 * the session read (a claim it carries is followed), the attempt read (this
 * request's attempt already started is the landing; another running is the
 * refusal), the prepare from the smallest set, the gas check, the claim and
 * the send. Does nothing while work is in flight, after the refusal, or after
 * a send that may still land.
 */
export const startSubmission = async (store: SubmitStore, steps: SubmitSteps): Promise<void> => {
  const state = store.state()
  if (
    state.refusal ||
    state.lookup === 'reading' ||
    isLive(state) ||
    landedOf(state) ||
    mayStillLand(state.write)
  ) {
    return
  }
  await releaseWhereEnded(store, steps)
  const before = store.state().write.run
  writeEvent(store)({ type: 'start' })
  const { run } = store.state().write
  if (run === before) {
    return
  }
  const fail = (error: unknown) => writeEvent(store)({ type: 'error', run, error })
  const stillChecking = () =>
    inRun(store.state(), run) && store.state().write.status === 'checkingGas'

  let read
  try {
    read = await readWithin(() => steps.readSession())
  } catch (error: unknown) {
    fail(error)
    return
  }
  if (!stillChecking()) {
    return
  }
  if (read.status !== 'present' || read.value.state !== 'live') {
    fail(new Error('No live recovery session to submit.'))
    return
  }
  if (read.value.submission) {
    store.dispatch({ type: 'write', event: { type: 'reset' } })
    await followClaim(store, steps, run, read.value.submission)
    return
  }

  let attempt
  try {
    attempt = steps.attemptOf(await readWithin(() => steps.attemptRead()))
  } catch (error: unknown) {
    fail(error)
    return
  }
  if (!stillChecking()) {
    return
  }
  if (attempt === 'ours') {
    store.dispatch({ type: 'landedUnseen', run })
    await settle(store, steps, run)
    return
  }
  if (attempt === 'other') {
    store.dispatch({ type: 'refused', run })
    return
  }

  let outcome
  try {
    outcome = await steps.prepare()
  } catch (error: unknown) {
    if (preparedRefusalRunning(error)) {
      store.dispatch({ type: 'refused', run })
    } else {
      fail(error)
    }
    return
  }
  if (outcome.status === 'set-changed') {
    store.dispatch({ type: 'toChecklist', run })
    return
  }
  store.dispatch({ type: 'prepared', run, prepared: outcome.prepared })
  await checkAndSend(store, steps, run)
}

/**
 * Before the start is offered: reads the session and, where it carries a
 * claim, follows it in a new run with nothing sent. Reads once per idle run,
 * and again only after a read that failed.
 */
export const lookForClaim = async (store: SubmitStore, steps: SubmitSteps): Promise<void> => {
  const state = store.state()
  if (
    state.write.status !== 'idle' ||
    state.refusal ||
    (state.lookup !== undefined && state.lookup !== 'failed')
  ) {
    return
  }
  const { run } = state.write
  store.dispatch({ type: 'lookup', run, reading: 'reading' })
  let read
  try {
    read = await readWithin(() => steps.readSession())
  } catch {
    store.dispatch({ type: 'lookup', run, reading: 'failed' })
    return
  }
  const claim =
    read.status === 'present' && read.value.state === 'live' ? read.value.submission : undefined
  if (!claim) {
    store.dispatch({ type: 'lookup', run, reading: 'none' })
    return
  }
  await followClaim(store, steps, run, claim)
}

/**
 * Attaches the steps of the screen that now holds the store: a followed claim
 * and the deposit step's reads go on through them, and stop while no screen
 * is attached.
 */
export const attachSteps = (store: SubmitStore, steps: SubmitSteps): void => {
  ATTACHED.set(store, steps)
  WAKES.get(store)?.()
  readFollow(store).catch(() => undefined)
  if (store.state().write.status === 'needsDeposit') {
    pollDeposit(store).catch(() => undefined)
  }
}

/** Detaches the steps of a screen that went away, where they are still the attached ones. */
export const detachSteps = (store: SubmitStore, steps: SubmitSteps): void => {
  if (ATTACHED.get(store) === steps) {
    ATTACHED.delete(store)
  }
}

/**
 * From a stalled receipt wait: checks for a dropped hash, then waits for the
 * same hash once more. From a followed claim with no hash: reads it again at
 * once. From a send that may still land: reads the session's claim and
 * follows it.
 */
export const checkAgain = async (store: SubmitStore, steps: SubmitSteps): Promise<void> => {
  const state = store.state()
  const { run } = state.write
  if (state.follow && awaitingHashIn(state, run)) {
    WAKES.get(store)?.()
    return
  }
  if (pendingHashIn(state, run)) {
    await waitForReceipt(store, steps)
    return
  }
  if (!mayStillLand(state.write) || landedOf(state)) {
    return
  }
  const read = await readWithin(() => steps.readSession()).catch(() => undefined)
  const claim =
    read?.status === 'present' && read.value.state === 'live' ? read.value.submission : undefined
  if (read?.status === 'present' && read.value.state === 'landed') {
    store.dispatch({ type: 'landedUnseen', run })
    await settle(store, steps, run)
    return
  }
  if (claim && inRun(store.state(), run)) {
    await followClaim(store, steps, run, claim)
  }
}

/** Reads the attempt again where the landing's read did not answer or disagreed. */
export const rereadLanding = async (store: SubmitStore, steps: SubmitSteps): Promise<void> => {
  if (store.state().after !== 'unread') {
    return
  }
  await settle(store, steps, store.state().write.run)
}
