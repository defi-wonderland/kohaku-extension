/**
 * The cancel's run: the shared write machine for the gas check, the send and
 * the receipt, and around it the reads that keep the cancel from being sent
 * twice or shown as done before the chain agrees.
 *
 *   idle ──start──▶ checkingGas: a stored cancel? ─yes─▶ followed (nothing sent)
 *                     └─ the attempt read ─ gone ─▶ idle with the gone reading (nothing sent)
 *                        └─ open ─▶ the prepare, the gas check
 *                                    ├─ deposit ─▶ needsDeposit ──recheck──▶ checkingGas
 *                                    └─ enough ─▶ the send's block, the claim
 *                                                 ├─ another's ─▶ followed (nothing sent)
 *                                                 └─ its own ─▶ the attempt read again
 *                                                               ├─ gone ─▶ idle with the gone reading (the claim released)
 *                                                               └─ open ─▶ submitting ─▶ landed | failedNotSent | failedReverted
 *   landed ──▶ reads until the attempt reads cancelled, by the owner or by another road ──▶ cancelled | otherRoad | unread
 *   failedReverted ──▶ reads until the attempt read names how it had ended (attemptRead)
 *
 * The cancel is stored on this device, under the lock of its key, before the
 * request goes to the wallet, and the wallet adds the request only while that
 * claim is still this run's with no hash. A page that finds a stored cancel,
 * on arrival or as the loser of a claim, sends nothing and follows it: under
 * its hash it waits for the receipt; with no hash it reads where the wallet
 * holds the request, and only a request the wallet holds nowhere and never
 * broadcast reads as not sent, so the claim is released and the start offered
 * again. The claim is released once the run ends with nothing on its way to
 * the chain, or once the receipt came back. A refusal whose operation may
 * still reach the chain keeps it.
 *
 * Every answer carries the run it belongs to, so the answer of a run the
 * holder left behind moves nothing, and no decision reads the device's clock.
 */
import {
  isProviderReadFailure,
  providerReadFailure,
  readWithin
} from '@web/modules/social-recovery/shared/client'
import {
  canRetry,
  initialWriteState,
  receiptOf,
  writeReducer
} from '@web/modules/social-recovery/shared/writes'
import type { WriteEvent, WriteMachineState } from '@web/modules/social-recovery/shared/writes'
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'
import type { WatcherReading } from '@web/modules/social-recovery/watcher'

import {
  AFTER_READ_PAUSE_MS,
  AFTER_READ_TRIES,
  CLAIMED_READ_MS,
  FOLLOW_POLL_MS,
  SEND_BLOCK_READ_MS
} from './constants'
import { attemptAfterOf, landedOutcomeOf, standingOf } from './readings'
import type { CancelClaim, CancelState, CancelSteps, CancelStore } from './types'

export const initialCancelState = (): CancelState => ({
  write: initialWriteState('cancel'),
  after: { stage: 'none' }
})

export const createCancelStore = (): CancelStore => {
  let current = initialCancelState()
  const listeners = new Set<() => void>()
  return {
    state: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update: (change) => {
      const next = change(current)
      if (next !== current) {
        current = next
        listeners.forEach((listener) => listener())
      }
    }
  }
}

/** The run's state after one write event; a new run starts from nothing but its target. */
export const applyWrite = (state: CancelState, event: WriteEvent): CancelState => {
  const write = writeReducer(state.write, event)
  if (write === state.write) {
    return state
  }
  if (write.run !== state.write.run) {
    return {
      write,
      after: { stage: 'none' },
      ...(state.target !== undefined ? { target: state.target } : {})
    }
  }
  const next: CancelState = { ...state, write }
  if (write.status !== 'submitting') {
    delete next.stalled
    delete next.follow
  } else if (write.transactionHash) {
    delete next.follow
  }
  return next
}

const dispatchTo =
  (store: CancelStore) =>
  (event: WriteEvent): void =>
    store.update((state) => applyWrite(state, event))

const inRun = (store: CancelStore, run: number): boolean => store.state().write.run === run

const changeInRun = (
  store: CancelStore,
  run: number,
  change: (state: CancelState) => CancelState
): void => store.update((state) => (state.write.run === run ? change(state) : state))

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const asReadFailure = (error: unknown) =>
  isProviderReadFailure(error) ? error : providerReadFailure('call', error)

/** The steps of the screens attached now; a followed request is read only through one of them. */
const ATTACHED = new Set<CancelSteps>()

/** The stores whose followed request is being read, so one loop reads it. */
const FOLLOWING = new WeakSet<CancelStore>()

// ---------------------------------------------------------------------------
// After the receipt
// ---------------------------------------------------------------------------

/** Reads after a landed cancel until the attempt reads cancelled, a bounded number of times. */
const readAfterLanding = async (
  store: CancelStore,
  steps: CancelSteps,
  run: number,
  tries = AFTER_READ_TRIES
): Promise<void> => {
  const { target } = store.state()
  if (target === undefined || !inRun(store, run)) {
    return
  }
  changeInRun(store, run, (state) => ({ ...state, after: { stage: 'reading' } }))
  const reading = await steps.readAttempt().catch(() => undefined)
  const outcome = reading ? landedOutcomeOf(reading, target) : undefined
  if (outcome) {
    changeInRun(store, run, (state) => ({ ...state, after: outcome }))
    return
  }
  if (tries <= 1) {
    changeInRun(store, run, (state) => ({ ...state, after: { stage: 'unread' } }))
    return
  }
  await pause(AFTER_READ_PAUSE_MS)
  await readAfterLanding(store, steps, run, tries - 1)
}

/**
 * Reads after a reverted cancel until the attempt read names how the attempt
 * stands, and after an execution the controller, a bounded number of times.
 */
const readAfterRevert = async (
  store: CancelStore,
  steps: CancelSteps,
  run: number,
  tries = AFTER_READ_TRIES
): Promise<void> => {
  const { target } = store.state()
  if (target === undefined || !inRun(store, run)) {
    return
  }
  const reading = await steps.readAttempt().catch(() => undefined)
  const attemptAfter = reading ? attemptAfterOf(reading, target) : undefined
  if (attemptAfter) {
    dispatchTo(store)({ type: 'attemptRead', run, attemptAfter })
  }
  const complete =
    !!attemptAfter && (attemptAfter.ended !== 'executed' || !!attemptAfter.controller)
  if (complete || tries <= 1) {
    return
  }
  await pause(AFTER_READ_PAUSE_MS)
  await readAfterRevert(store, steps, run, tries - 1)
}

/** What follows the end of a run's send or wait: the claim, and the reads after the receipt. */
const settle = async (
  store: CancelStore,
  steps: CancelSteps,
  run: number,
  requestId: string
): Promise<void> => {
  const { write } = store.state()
  if (write.run !== run) {
    return
  }
  const release = () => steps.claims.release(requestId).catch(() => undefined)
  switch (write.status) {
    case 'landed':
      await release()
      await readAfterLanding(store, steps, run)
      return
    case 'failedReverted':
      await release()
      await readAfterRevert(store, steps, run)
      return
    case 'failedNotSent':
      // A cancel that may still reach the chain keeps its claim, so no page sends another.
      if (!write.mayStillLand) {
        await release()
      }
      return
    case 'submitting':
      if (write.transactionHash) {
        changeInRun(store, run, (state) => ({ ...state, stalled: true }))
      }
      return
    default:
      await release()
  }
}

/** Waits for the receipt of a hash of the run, then settles the run. */
const waitHash = async (
  store: CancelStore,
  steps: CancelSteps,
  run: number,
  transactionHash: Hex,
  startBlock: number,
  requestId: string
): Promise<void> => {
  const dispatch = dispatchTo(store)
  try {
    const receipt = receiptOf(await steps.wait(transactionHash, startBlock))
    // A receipt with no status reads neither way, so the write keeps its hash.
    if (receipt) {
      dispatch({ type: 'receipt', run, receipt })
    }
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error, transactionHash })
  }
  await settle(store, steps, run, requestId)
}

// ---------------------------------------------------------------------------
// A stored cancel, followed
// ---------------------------------------------------------------------------

/** The submitting state a followed cancel starts in, under its hash where the claim holds one. */
const followedWriteOf = (run: number, claim: CancelClaim): WriteMachineState => ({
  status: 'submitting',
  write: 'cancel',
  run,
  ...(claim.transactionHash
    ? {
        transactionHash: claim.transactionHash,
        sentHashes: [claim.transactionHash],
        startBlock: claim.startBlock
      }
    : {})
})

/**
 * Reads where the wallet holds a followed request with no hash, while a screen
 * is attached: broadcast, it follows the hash; held nowhere, the cancel was
 * not sent, so the claim is released and the start offered again; held, or a
 * read with no answer, it reads again a moment later.
 */
const followHold = async (
  store: CancelStore,
  steps: CancelSteps,
  run: number,
  claim: CancelClaim
): Promise<void> => {
  const current = store.state().write
  if (!ATTACHED.has(steps) || current.run !== run || current.status !== 'submitting') {
    FOLLOWING.delete(store)
    return
  }
  if (current.transactionHash) {
    FOLLOWING.delete(store)
    return
  }
  const hold = await steps.requestHold(claim.requestId).catch(() => undefined)
  if (!inRun(store, run)) {
    FOLLOWING.delete(store)
    return
  }
  if (!hold || hold.status === 'held') {
    changeInRun(store, run, (state) => ({ ...state, follow: hold ? 'held' : 'unread' }))
    await pause(FOLLOW_POLL_MS)
    await followHold(store, steps, run, claim)
    return
  }
  FOLLOWING.delete(store)
  // Another page may have written the hash meanwhile: the claim's hash wins.
  const stored = await steps.claims.read().catch(() => undefined)
  const storedHash = stored?.requestId === claim.requestId ? stored.transactionHash : undefined
  const transactionHash = hold.status === 'broadcast' ? hold.transactionHash : storedHash
  if (transactionHash) {
    await steps.claims.markSent(claim.requestId, transactionHash).catch(() => undefined)
    dispatchTo(store)({ type: 'sent', run, transactionHash, startBlock: claim.startBlock })
    await waitHash(store, steps, run, transactionHash, claim.startBlock, claim.requestId)
    return
  }
  await steps.claims.release(claim.requestId).catch(() => undefined)
  changeInRun(store, run, (state) => {
    const { follow, requestId, ...rest } = applyWrite(state, { type: 'reset' })
    return rest
  })
}

/** Follows a stored cancel in a run of its own, sending nothing. */
export const followClaim = async (
  store: CancelStore,
  steps: CancelSteps,
  claim: CancelClaim
): Promise<void> => {
  const run = store.state().write.run + 1
  store.update(() => ({
    write: followedWriteOf(run, claim),
    target: claim.attemptId,
    after: { stage: 'none' },
    requestId: claim.requestId,
    // Until the wallet answers, a request with no hash reads as held.
    ...(claim.transactionHash ? {} : { follow: 'held' as const })
  }))
  if (claim.transactionHash) {
    await waitHash(store, steps, run, claim.transactionHash, claim.startBlock, claim.requestId)
    return
  }
  FOLLOWING.add(store)
  await followHold(store, steps, run, claim)
}

// ---------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------

/** The attempt read, the gas check, the claim, the read again and the send of one run. */
const checkAndSend = async (
  store: CancelStore,
  steps: CancelSteps,
  run: number,
  target: bigint
): Promise<void> => {
  const dispatch = dispatchTo(store)
  const fail = (error: unknown) => dispatch({ type: 'error', run, error })
  const gone = (reading: WatcherReading) =>
    changeInRun(store, run, (state) => ({ ...applyWrite(state, { type: 'reset' }), gone: reading }))

  let reading: WatcherReading
  try {
    reading = await steps.readAttempt()
  } catch (error: unknown) {
    fail(asReadFailure(error))
    return
  }
  if (!inRun(store, run)) {
    return
  }
  if (standingOf(reading, target).kind !== 'open') {
    gone(reading)
    return
  }
  try {
    const prepared = await steps.prepare()
    const check = await steps.checkGas(prepared)
    dispatch({ type: 'gasChecked', run, check })
    const checked = store.state().write
    if (checked.run !== run || checked.status !== 'submitting') {
      return
    }
    let startBlock: number
    try {
      startBlock = await readWithin(() => steps.blockNumber(), SEND_BLOCK_READ_MS)
    } catch (error: unknown) {
      fail(providerReadFailure('block', error))
      return
    }
    const requestId = steps.newRequestId()
    const answer = await steps.claims.claim({ attemptId: target, requestId, startBlock })
    if (!answer.claimed) {
      if (inRun(store, run)) {
        await followClaim(store, steps, answer.held)
      }
      return
    }
    changeInRun(store, run, (state) => ({ ...state, requestId }))
    const release = () => steps.claims.release(requestId).catch(() => undefined)
    // Read again once the claim is stored: a cancel another page landed meanwhile is not sent twice.
    let again: WatcherReading
    try {
      again = await readWithin(steps.readAttempt, CLAIMED_READ_MS)
    } catch (error: unknown) {
      await release()
      fail(asReadFailure(error))
      return
    }
    if (!inRun(store, run)) {
      await release()
      return
    }
    if (standingOf(again, target).kind !== 'open') {
      await release()
      gone(again)
      return
    }
    const ownsUnsent = async () => {
      const held = await steps.claims.read()
      return held?.requestId === requestId && !held.transactionHash
    }
    await steps.send({
      prepared,
      run,
      requestId,
      startBlock,
      canAdd: ownsUnsent,
      dispatch: (event) => {
        dispatch(event)
        if (event.type === 'sent' && event.run === run) {
          steps.claims.markSent(requestId, event.transactionHash).catch(() => undefined)
        }
      }
    })
    await settle(store, steps, run, requestId)
  } catch (error: unknown) {
    fail(error)
  }
}

/** Starts the cancel of `target`: from idle, or from a state that offers the retry. */
export const startCancel = async (
  store: CancelStore,
  steps: CancelSteps,
  target: bigint
): Promise<void> => {
  const { write } = store.state()
  if (write.status !== 'idle' && !canRetry(write)) {
    return
  }
  store.update((state) => ({ ...applyWrite(state, { type: 'start' }), target }))
  const { run } = store.state().write
  let held: CancelClaim | undefined
  try {
    held = await steps.claims.read()
  } catch (error: unknown) {
    dispatchTo(store)({ type: 'error', run, error: asReadFailure(error) })
    return
  }
  if (held) {
    if (inRun(store, run)) {
      await followClaim(store, steps, held)
    }
    return
  }
  await checkAndSend(store, steps, run, target)
}

/** From the deposit step: the attempt read and the gas check again, in the same run. */
export const recheckCancel = async (store: CancelStore, steps: CancelSteps): Promise<void> => {
  const { write, target } = store.state()
  if (write.status !== 'needsDeposit' || target === undefined) {
    return
  }
  dispatchTo(store)({ type: 'recheck' })
  await checkAndSend(store, steps, write.run, target)
}

/** Waits again for a stalled receipt, or reads again after a landing the reads did not confirm. */
export const checkCancelAgain = async (store: CancelStore, steps: CancelSteps): Promise<void> => {
  const state = store.state()
  const { write, requestId } = state
  if (write.status === 'landed' && state.after.stage === 'unread') {
    await readAfterLanding(store, steps, write.run)
    return
  }
  if (
    write.status === 'submitting' &&
    write.transactionHash &&
    state.stalled &&
    requestId !== undefined
  ) {
    const { run, transactionHash } = write
    changeInRun(store, run, (current) => {
      const { stalled, ...rest } = current
      return rest
    })
    const startBlock = write.startBlock ?? (await steps.blockNumber())
    await waitHash(store, steps, run, transactionHash, startBlock, requestId)
  }
}

/**
 * Attaches a screen's steps. A run that never started follows a cancel
 * stored on this device; a followed request whose reads paused with no screen
 * attached is read again through these steps.
 */
export const attachCancelSteps = async (store: CancelStore, steps: CancelSteps): Promise<void> => {
  ATTACHED.add(steps)
  const state = store.state()
  const untouched = state.write.status === 'idle' && state.write.run === 0 && !state.gone
  const pausedFollow =
    state.write.status === 'submitting' &&
    !state.write.transactionHash &&
    state.follow !== undefined &&
    !FOLLOWING.has(store)
  if (!untouched && !pausedFollow) {
    return
  }
  const held = await steps.claims.read().catch(() => undefined)
  if (!held) {
    return
  }
  const now = store.state()
  if (untouched && now.write.status === 'idle' && now.write.run === 0) {
    await followClaim(store, steps, held)
  } else if (
    pausedFollow &&
    now.write.run === state.write.run &&
    held.requestId === now.requestId
  ) {
    FOLLOWING.add(store)
    await followHold(store, steps, now.write.run, held)
  }
}

export const detachCancelSteps = (steps: CancelSteps): void => {
  ATTACHED.delete(steps)
}

/** Whether a run must outlive the screen that shows it: something is on its way, or being read. */
export const outlivesScreen = (state: CancelState): boolean =>
  state.write.status === 'checkingGas' ||
  state.write.status === 'submitting' ||
  (state.write.status === 'landed' && state.after.stage === 'reading')
