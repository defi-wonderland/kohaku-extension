/**
 * The save's run: the shared write machine for the gas check, the send and
 * the receipt, and after a landed receipt the check that decides whether the
 * save reads as saved.
 *
 *   idle ──start──▶ checkingGas: the setup read, the prepare, then the gas check
 *                     ├─ a setup found ─▶ already set up (the run ends, nothing sent)
 *                     ├─ deposit ──▶ needsDeposit ──recheck──▶ checkingGas: the setup read, the gas check
 *                     ├─ a refusal ─▶ failedNotSent (nothing sent)
 *                     └─ enough ───▶ submitting ──▶ failedNotSent | failedReverted | landed
 *   failedNotSent that may still land ──a setup read finds one──▶ already set up
 *   submitting with a hash, its first receipt wait past its limit ──▶ stalled
 *   submitting with a hash, its receipt wait failed ──▶ one more wait, time-limited ──▶ stalled
 *                                                  stalled ──check again──▶ the wait again
 *   failedNotSent after a short estimation of the sign screen ──▶ the gas check again,
 *                                                  and the deposit step where it is short
 *   landed ──▶ confirming ──▶ saving (the records wiped) ──▶ saved
 *                         ├──▶ disagreed (the commitment, or the authorization)
 *                         └──▶ unread ──reread──▶ confirming
 *
 * Every start reads the account's setup before it prepares, so a retry, a
 * second tab or an operation that landed after all never sends a second
 * setup. After the gas check reads enough, the run stores the save in flight
 * on this device under a new request id, and sends only where that claim
 * wrote it. A page that finds a stored save, on arrival or as the loser of a
 * claim, sends nothing and follows it: under its hash it waits for the
 * receipt; with no hash it reads where the wallet holds the request. The
 * stored save is released where the run ends with nothing on its way to the
 * chain, and the check's agreement removes it with the setup records. A
 * refusal whose operation may still land offers no retry, only a read of the
 * setup; a setup found then is checked as after a landed receipt. The records
 * are wiped, and the save reads as saved, only after the check agreed on a
 * landing of the run. A failed or disagreed save wipes nothing. Every event
 * after the write's carries its run, so the answer of a run the holder left
 * behind moves nothing.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'
import { accountBatchRefusal } from '@web/modules/social-recovery/shared/client'
import type { FeeReading, SendRequestState } from '@web/modules/social-recovery/shared/client'
import type { SaveInFlightRecord } from '@web/modules/social-recovery/shared/records'
import {
  initialWriteState,
  mayStillLand,
  writeReducer
} from '@web/modules/social-recovery/shared/writes'
import type { WriteEvent, WriteMachineState } from '@web/modules/social-recovery/shared/writes'

import { FOLLOW_REREAD_MS, GONE_GRACE_MS, RECEIPT_WAIT_MS } from './constants'
import { confirmOutcomeOf } from './outcome'
import type {
  ArmEvent,
  ArmState,
  ArmStore,
  ConfirmReadOptions,
  PreparedSave,
  SaveSteps
} from './types'

/** The save before anything ran. */
export const initialArmState = (): ArmState => ({
  write: initialWriteState('save'),
  after: { stage: 'none' }
})

const inRun = (state: ArmState, run: number): boolean => state.write.run === run

/** Whether the run's batch landed: its receipt, or the account's setup where no page followed its hash. */
const landedOf = (state: ArmState): boolean =>
  state.write.status === 'landed' || !!state.landedUnseen

const landedIn = (state: ArmState, run: number): boolean => inRun(state, run) && landedOf(state)

/** Whether the run submits with no hash yet: the wallet's window waits, or a followed request is read. */
const awaitingHashIn = (state: ArmState, run: number): boolean =>
  inRun(state, run) &&
  state.write.status === 'submitting' &&
  !state.write.transactionHash &&
  !state.landedUnseen

/** The submitting state a followed save starts in, under its hash where the stored save holds one. */
const followedWriteOf = (
  write: WriteMachineState,
  run: number,
  transactionHash: Hex | undefined,
  startBlock: number | undefined
): WriteMachineState => ({
  status: 'submitting',
  write: write.write,
  run,
  ...(transactionHash ? { transactionHash } : {}),
  ...(transactionHash && startBlock !== undefined ? { startBlock } : {})
})

/** The hash of the run's batch while it waits for its receipt. */
const pendingHashIn = (state: ArmState, run: number) =>
  inRun(state, run) && state.write.status === 'submitting' ? state.write.transactionHash : undefined

/** The save's reducer. Pure: an event a state does not take leaves it as it was (the same object). */
export const armReducer = (state: ArmState, event: ArmEvent): ArmState => {
  switch (event.type) {
    case 'write': {
      // A run that found a setup on the account ends there: nothing starts it again.
      if (state.stop) {
        return state
      }
      const write = writeReducer(state.write, event.event)
      if (write === state.write) {
        return state
      }
      // A new run starts from nothing: its own prepare, its own landing.
      if (write.run !== state.write.run) {
        return {
          write,
          after: { stage: 'none' },
          ...(state.lookup ? { lookup: state.lookup } : {})
        }
      }
      const next: ArmState = { ...state, write }
      // A stalled wait ends with the write's submitting: whatever settled it answered.
      if (state.stalled && write.status !== 'submitting') {
        next.stalled = false
      }
      // A followed request's reading ends with a hash, or with the write's submitting.
      if (state.follow && (write.status !== 'submitting' || write.transactionHash)) {
        delete next.follow
      }
      return next
    }
    case 'lookup':
      if (
        !inRun(state, event.run) ||
        state.write.status !== 'idle' ||
        state.stop ||
        state.lookup === event.reading
      ) {
        return state
      }
      return { ...state, lookup: event.reading }
    case 'claimed':
      if (!awaitingHashIn(state, event.run) || state.requestId) {
        return state
      }
      return { ...state, requestId: event.requestId }
    case 'follow': {
      // From the arrival, a new run follows the stored save; in a run whose
      // claim lost, the run follows it in place of its own.
      const fromArrival = state.write.status === 'idle' && !state.stop && inRun(state, event.run)
      if (!fromArrival && (!awaitingHashIn(state, event.run) || state.requestId)) {
        return state
      }
      const run = fromArrival ? event.run + 1 : event.run
      return {
        write: followedWriteOf(state.write, run, event.transactionHash, event.startBlock),
        after: { stage: 'none' },
        prepared: event.prepared,
        requestId: event.requestId,
        ...(state.lookup ? { lookup: state.lookup } : {})
      }
    }
    case 'followed':
      if (!awaitingHashIn(state, event.run) || !state.requestId || state.follow === event.reading) {
        return state
      }
      return { ...state, follow: event.reading }
    case 'landedUnseen': {
      const { write } = state
      if (
        !inRun(state, event.run) ||
        !state.prepared ||
        state.landedUnseen ||
        state.after.stage !== 'none' ||
        !(mayStillLand(write) || (write.status === 'submitting' && !write.transactionHash))
      ) {
        return state
      }
      const { follow, ...rest } = state
      return { ...rest, landedUnseen: true }
    }
    case 'released': {
      if (!inRun(state, event.run) || !state.requestId) {
        return state
      }
      const { requestId, ...rest } = state
      return rest
    }
    case 'voided':
      // A followed request no page can find, with no setup on the account: the save is offered again.
      if (!awaitingHashIn(state, event.run) || !state.requestId) {
        return state
      }
      return {
        write: writeReducer(state.write, { type: 'reset' }),
        after: { stage: 'none' },
        lookup: 'none'
      }
    case 'alreadySetUp':
      // Taken while the run reads the setup before it prepares or sends.
      if (!inRun(state, event.run) || state.write.status !== 'checkingGas') {
        return state
      }
      return {
        write: writeReducer(state.write, { type: 'reset' }),
        after: { stage: 'none' },
        stop: 'already-set-up'
      }
    case 'prepared':
      if (!inRun(state, event.run) || state.write.status !== 'checkingGas' || state.prepared) {
        return state
      }
      return { ...state, prepared: event.prepared }
    case 'estimated':
      if (!inRun(state, event.run) || state.write.status !== 'submitting') {
        return state
      }
      return { ...state, estimation: event.reading }
    case 'waitStalled':
      if (!pendingHashIn(state, event.run) || state.stalled) {
        return state
      }
      return { ...state, stalled: true }
    case 'waitResumed':
      if (!inRun(state, event.run) || !state.stalled) {
        return state
      }
      return { ...state, stalled: false }
    case 'confirming':
      if (
        !landedIn(state, event.run) ||
        (state.after.stage !== 'none' && state.after.stage !== 'unread')
      ) {
        return state
      }
      return { ...state, after: { stage: 'confirming' } }
    case 'confirmed': {
      if (!landedIn(state, event.run) || state.after.stage !== 'confirming') {
        return state
      }
      const { outcome } = event
      if (outcome.kind === 'agreed') {
        return { ...state, after: { stage: 'saving' } }
      }
      if (outcome.kind === 'disagreed') {
        return { ...state, after: { stage: 'disagreed', check: outcome.check } }
      }
      return { ...state, after: { stage: 'unread' } }
    }
    case 'wiped':
      if (!landedIn(state, event.run) || state.after.stage !== 'saving') {
        return state
      }
      return { ...state, after: { stage: 'saved' } }
    default:
      return state
  }
}

/** A store over the reducer, starting from `initial` or from nothing. */
export const createArmStore = (initial: ArmState = initialArmState()): ArmStore => {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    state: () => current,
    dispatch(event) {
      const next = armReducer(current, event)
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
 * Whether the run still has work in flight that a new start must not repeat:
 * the setup read, the prepare or the gas check, the send or its receipt wait,
 * a followed request, or the check after the landing and the wipe.
 */
export const isLive = (state: ArmState): boolean => {
  const { write, after } = state
  if (state.stop) {
    return false
  }
  if (landedOf(state)) {
    return after.stage === 'none' || after.stage === 'confirming' || after.stage === 'saving'
  }
  return write.status === 'checkingGas' || write.status === 'submitting'
}

/**
 * Whether the screen keeps the run when it leaves it, so the next arrival
 * takes it up instead of reading the chain and offering a new save: a run with
 * work in flight; a refusal whose operation may still reach the chain, which a
 * new save could repeat while the setup read finds nothing yet; and a landed
 * batch whose check did not answer, which holds the hash and the reread that
 * leads to saved and the wipe of the records. Every other ended run is dropped.
 */
export const outlivesScreen = (state: ArmState): boolean =>
  isLive(state) ||
  (!state.stop &&
    (state.after.stage === 'unread' || (!landedOf(state) && mayStillLand(state.write))))

const writeEvent = (store: ArmStore) => (event: WriteEvent) =>
  store.dispatch({ type: 'write', event })

/**
 * Whether the run ended with nothing on its way to the chain, so its stored
 * save in flight goes: a save never sent that cannot still land (refused,
 * replaced, refused for another request), a revert, or a landing whose check
 * disagreed. A send that may still land, a receipt wait in flight or stalled,
 * and a check that did not answer keep it.
 */
const endedWithNothingInFlight = (state: ArmState): boolean => {
  const { write, after } = state
  if (after.stage === 'disagreed') {
    return true
  }
  if (landedOf(state)) {
    return false
  }
  return (
    write.status === 'failedReverted' || (write.status === 'failedNotSent' && !mayStillLand(write))
  )
}

/** Releases the run's stored save in flight where the run ended with nothing on its way to the chain. */
const releaseWhereEnded = async (store: ArmStore, steps: SaveSteps): Promise<void> => {
  const state = store.state()
  const { requestId } = state
  if (!requestId || !endedWithNothingInFlight(state)) {
    return
  }
  store.dispatch({ type: 'released', run: state.write.run })
  await steps.release(requestId).catch(() => undefined)
}

// The receipt waits a store holds open, by hash, so a second wait on a hash takes up the first.
const OPEN_WAITS = new WeakMap<ArmStore, Map<string, Promise<void>>>()

const openWaitsOf = (store: ArmStore): Map<string, Promise<void>> => {
  const held = OPEN_WAITS.get(store)
  if (held) {
    return held
  }
  const created = new Map<string, Promise<void>>()
  OPEN_WAITS.set(store, created)
  return created
}

/** Holds `waiting` as the open wait of `hash` until it settles; answers the held wait. */
const holdWait = (store: ArmStore, hash: Hex, waiting: Promise<void>): Promise<void> => {
  const waits = openWaitsOf(store)
  const key = hash.toLowerCase()
  const held: Promise<void> = waiting.finally(() => {
    if (waits.get(key) === held) {
      waits.delete(key)
    }
  })
  waits.set(key, held)
  return held
}

const dropWait = (store: ArmStore, hash: Hex): void => {
  openWaitsOf(store).delete(hash.toLowerCase())
}

// The wake of a followed request's rest, so "check again" reads at once.
const WAKES = new WeakMap<ArmStore, () => void>()

/** Rests for `ms`, or until the holder asks to check again. */
const rest = (store: ArmStore, ms: number): Promise<void> =>
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

/** Reads the account's setup at the start of a run; a setup found ends the run with nothing prepared. */
const noSetupYet = async (store: ArmStore, steps: SaveSteps, run: number): Promise<boolean> => {
  try {
    if (await steps.hasSetup()) {
      store.dispatch({ type: 'alreadySetUp', run })
      return false
    }
  } catch (error: unknown) {
    writeEvent(store)({ type: 'error', run, error })
    return false
  }
  return inRun(store.state(), run) && store.state().write.status === 'checkingGas'
}

/**
 * After a landing: the check, then the wipe where it agreed. A wipe that
 * fails still reads as saved, since the setup is live on chain. A check that
 * disagreed releases the stored save in flight.
 */
const settle = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  options: ConfirmReadOptions
): Promise<void> => {
  try {
    const { prepared } = store.state()
    if (!prepared || !landedIn(store.state(), run)) {
      return
    }
    // Only the settle whose event moved the run goes on, so a second one never reads or wipes again.
    const before = store.state()
    store.dispatch({ type: 'confirming', run })
    if (store.state() === before || store.state().after.stage !== 'confirming') {
      return
    }
    const outcome = await confirmOutcomeOf(() => steps.confirm(prepared), {
      ...options,
      newBlock: steps.newBlock
    })
    const confirming = store.state()
    store.dispatch({ type: 'confirmed', run, outcome })
    if (
      outcome.kind !== 'agreed' ||
      store.state() === confirming ||
      store.state().after.stage !== 'saving'
    ) {
      return
    }
    try {
      await steps.wipe()
    } catch {
      // The setup is live whether or not this device could drop its draft.
    }
    store.dispatch({ type: 'wiped', run })
  } finally {
    await releaseWhereEnded(store, steps)
  }
}

/** Resolves true when `work` settles within `limitMs`, false when the limit passes first. */
const settlesWithin = (work: Promise<void>, limitMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), limitMs)
    work.then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      () => {
        clearTimeout(timer)
        resolve(true)
      }
    )
  })

/**
 * One more wait for the receipt of the hash the run holds, where its wait
 * failed and the batch may still land, or where the run follows a stored hash;
 * a wait already open on that hash is taken up rather than a second one
 * opened. A wait that fails again, or runs past `RECEIPT_WAIT_MS`, leaves the
 * run stalled under its hash until the holder asks to check again. A wait past
 * its limit goes on: a receipt it brings later is taken while the run still
 * submits that hash, and the check follows.
 */
const waitForReceipt = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  options: ConfirmReadOptions
): Promise<void> => {
  const transactionHash = pendingHashIn(store.state(), run)
  const { write } = store.state()
  if (!transactionHash || write.status !== 'submitting') {
    return
  }
  const waiting =
    openWaitsOf(store).get(transactionHash.toLowerCase()) ??
    holdWait(
      store,
      transactionHash,
      steps.waitAgain(transactionHash, write.startBlock, writeEvent(store), run)
    )
  const inTime = await settlesWithin(waiting, RECEIPT_WAIT_MS)
  store.dispatch({ type: 'waitStalled', run })
  if (inTime) {
    return
  }
  waiting
    .then(() => {
      if (store.state().after.stage === 'none') {
        return settle(store, steps, run, options)
      }
      return undefined
    })
    .catch(() => undefined)
}

/** Waits for the receipt of the run's hash, then the check where it landed. */
const reattach = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  options: ConfirmReadOptions
): Promise<void> => {
  await waitForReceipt(store, steps, run, options)
  await settle(store, steps, run, options)
}

/** Whether the run still follows `requestId` with no hash. */
const stillFollowing = (store: ArmStore, run: number, requestId: string): boolean =>
  awaitingHashIn(store.state(), run) && store.state().requestId === requestId

/**
 * Follows a stored save in flight that holds no hash, by where the wallet
 * holds its request: still queued, read again when the queue changes;
 * broadcast, its hash stored and its receipt waited for; on a route the wallet
 * cannot follow, the may-still-land state; a read that did not answer, read
 * again after a rest or on "check again", never taken as gone; gone, the
 * account's setup read: a setup found landed while no page watched and is
 * checked as after a receipt, and where none is found for `GONE_GRACE_MS`
 * after the first such reading, the stored save is void and released.
 */
const followRequest = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  options: ConfirmReadOptions,
  firstGone?: number
): Promise<void> => {
  const { requestId } = store.state()
  if (!requestId || !stillFollowing(store, run, requestId)) {
    return
  }
  const reading: SendRequestState = await steps
    .requestState(requestId)
    .catch((): SendRequestState => ({ status: 'unread' }))
  if (!stillFollowing(store, run, requestId)) {
    return
  }
  if (reading.status === 'broadcast') {
    const startBlock = await steps.blockNumber().catch(() => undefined)
    if (!stillFollowing(store, run, requestId)) {
      return
    }
    if (startBlock !== undefined) {
      await steps.markSent(requestId, reading.transactionHash, startBlock).catch(() => undefined)
    }
    writeEvent(store)({
      type: 'sent',
      run,
      transactionHash: reading.transactionHash,
      ...(startBlock !== undefined ? { startBlock } : {})
    })
    await reattach(store, steps, run, options)
    return
  }
  if (reading.status === 'untracked') {
    writeEvent(store)({
      type: 'error',
      run,
      error: accountBatchRefusal('not-a-transaction', steps.account)
    })
    return
  }
  if (reading.status === 'queued') {
    store.dispatch({ type: 'followed', run, reading: 'queued' })
    await steps.queueMoved(FOLLOW_REREAD_MS)
    await followRequest(store, steps, run, options)
    return
  }
  if (reading.status === 'unread') {
    store.dispatch({ type: 'followed', run, reading: 'unread' })
    await rest(store, FOLLOW_REREAD_MS)
    await followRequest(store, steps, run, options, firstGone)
    return
  }
  const goneSince = firstGone ?? Date.now()
  const found = await steps.hasSetup().catch(() => undefined)
  if (!stillFollowing(store, run, requestId)) {
    return
  }
  if (found) {
    store.dispatch({ type: 'landedUnseen', run })
    await settle(store, steps, run, options)
    return
  }
  if (found === false && Date.now() - goneSince >= GONE_GRACE_MS) {
    store.dispatch({ type: 'voided', run })
    await steps.release(requestId).catch(() => undefined)
    return
  }
  store.dispatch({ type: 'followed', run, reading: 'gone' })
  await rest(store, FOLLOW_REREAD_MS)
  await followRequest(store, steps, run, options, goneSince)
}

/**
 * Follows a stored save in flight in place of a send: from the arrival in a
 * new run, or in the run whose claim it beat. Under its hash the run waits for
 * the receipt and checks as after its own send; with no hash it follows the
 * request. Nothing is sent.
 */
const followSave = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  record: SaveInFlightRecord,
  options: ConfirmReadOptions
): Promise<void> => {
  const before = store.state()
  store.dispatch({
    type: 'follow',
    run,
    requestId: record.requestId,
    prepared: steps.followedSave(record.prepared),
    ...(record.transactionHash ? { transactionHash: record.transactionHash } : {}),
    ...(record.startBlock !== undefined ? { startBlock: record.startBlock } : {})
  })
  if (store.state() === before) {
    return
  }
  const followed = store.state().write.run
  if (record.transactionHash) {
    await reattach(store, steps, followed, options)
    return
  }
  await followRequest(store, steps, followed, options)
}

/** Whether the sign screen's estimation read no fee option the payer could cover, or an error. */
const shortAtSigning = (reading: FeeReading | undefined): boolean =>
  !!reading &&
  (reading.error !== undefined || !reading.options.some(({ available }) => available === true))

/**
 * After the sign screen read the batch short of gas and the save was not
 * sent: the gas check again on the same prepared save. Where the key is short,
 * a new run that reads the setup again shows the deposit step; where the
 * check reads enough, the not-sent state stays as it was.
 */
const recheckAfterShortSigning = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  prepared: PreparedSave
): Promise<void> => {
  const check = await steps.checkGas(prepared).catch(() => null)
  if (
    check?.kind !== 'deposit' ||
    !inRun(store.state(), run) ||
    store.state().write.status !== 'failedNotSent'
  ) {
    return
  }
  writeEvent(store)({ type: 'start' })
  const next = store.state().write.run
  if (next !== run + 1 || !(await noSetupYet(store, steps, next))) {
    return
  }
  store.dispatch({ type: 'prepared', run: next, prepared })
  writeEvent(store)({ type: 'gasChecked', run: next, check })
}

/** The send of a claimed save under its request id, with the first receipt wait's limit. */
const sendClaimed = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  prepared: PreparedSave,
  requestId: string
): Promise<boolean> => {
  const dispatch = writeEvent(store)
  // The first receipt wait runs inside the send; its limit starts when the hash arrives.
  let limit: ReturnType<typeof setTimeout> | undefined
  let ranOut = false
  let sentHash: Hex | undefined
  let sending: Promise<void> | undefined
  const sendDispatch = (event: WriteEvent) => {
    dispatch(event)
    if (event.type !== 'sent' || event.run !== run) {
      return
    }
    sentHash = event.transactionHash
    if (sending) {
      holdWait(store, event.transactionHash, sending).catch(() => undefined)
    }
    const { transactionHash, startBlock } = event
    const block = startBlock !== undefined ? Promise.resolve(startBlock) : steps.blockNumber()
    block.then((from) => steps.markSent(requestId, transactionHash, from)).catch(() => undefined)
    if (limit === undefined) {
      limit = setTimeout(() => {
        ranOut = true
        store.dispatch({ type: 'waitStalled', run })
      }, RECEIPT_WAIT_MS)
    }
  }
  try {
    sending = steps.send(prepared, sendDispatch, run, requestId, (reading) =>
      store.dispatch({ type: 'estimated', run, reading })
    )
    await sending
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
  } finally {
    clearTimeout(limit)
    if (sentHash) {
      dropWait(store, sentHash)
    }
  }
  return ranOut
}

/**
 * The gas check of the run's prepared save; where the key holds enough, the
 * claim of the save in flight, then the send under the claim's id, or, where
 * another page's save is stored, that save followed with nothing sent; then
 * the check.
 */
const checkAndSend = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  options: ConfirmReadOptions
): Promise<void> => {
  const { prepared } = store.state()
  if (!prepared || !inRun(store.state(), run) || store.state().write.status !== 'checkingGas') {
    return
  }
  const dispatch = writeEvent(store)
  try {
    const check = await steps.checkGas(prepared)
    dispatch({ type: 'gasChecked', run, check })
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  if (!awaitingHashIn(store.state(), run)) {
    return
  }
  const requestId = steps.newRequestId()
  let claim
  try {
    claim = await steps.claim(prepared, requestId)
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  if (!claim.claimed) {
    await followSave(store, steps, run, claim.record.value, options)
    return
  }
  store.dispatch({ type: 'claimed', run, requestId })
  if (store.state().requestId !== requestId) {
    await steps.release(requestId).catch(() => undefined)
    return
  }
  const ranOut = await sendClaimed(store, steps, run, prepared, requestId)
  // Past the first wait's limit, the holder's check again is the next wait, not one started here.
  if (!ranOut) {
    await waitForReceipt(store, steps, run, options)
  }
  await releaseWhereEnded(store, steps)
  const after = store.state()
  if (
    inRun(after, run) &&
    after.write.status === 'failedNotSent' &&
    !after.write.replaced &&
    !mayStillLand(after.write) &&
    shortAtSigning(after.estimation)
  ) {
    await recheckAfterShortSigning(store, steps, run, prepared)
    return
  }
  await settle(store, steps, run, options)
}

/**
 * Starts the save, from nothing or from a state that offers the retry: a new
 * run reads the account's setup, prepares the save again, runs the gas check,
 * claims the save in flight and sends. A setup already on the account ends
 * the run with nothing prepared; a refusal of the prepare reads as never sent.
 * Does nothing where the save cannot start, nor after a refusal whose
 * operation may still land.
 */
export const startSave = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  if (mayStillLand(store.state().write)) {
    return
  }
  await releaseWhereEnded(store, steps)
  const before = store.state().write.run
  writeEvent(store)({ type: 'start' })
  const { run } = store.state().write
  if (run === before || !(await noSetupYet(store, steps, run))) {
    return
  }
  try {
    const prepared = await steps.prepare()
    store.dispatch({ type: 'prepared', run, prepared })
  } catch (error: unknown) {
    writeEvent(store)({ type: 'error', run, error })
    return
  }
  await checkAndSend(store, steps, run, options)
}

/**
 * From the deposit blocker: the account's setup read again, then the gas check
 * again on the same prepared save, then the claim and the send. A setup found
 * meanwhile, by another tab, ends the run with nothing checked or sent.
 */
export const recheckGas = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  if (store.state().write.status !== 'needsDeposit') {
    return
  }
  writeEvent(store)({ type: 'recheck' })
  const { run } = store.state().write
  if (!(await noSetupYet(store, steps, run))) {
    return
  }
  await checkAndSend(store, steps, run, options)
}

/**
 * Before the save is offered: reads the save in flight stored on this device
 * and, where one is, follows it in a new run with nothing sent. Reads once per
 * run held, and again only after a read that failed.
 */
export const lookForSave = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  const state = store.state()
  if (
    state.write.status !== 'idle' ||
    state.stop ||
    (state.lookup !== undefined && state.lookup !== 'failed')
  ) {
    return
  }
  const { run } = state.write
  store.dispatch({ type: 'lookup', run, reading: 'reading' })
  let read
  try {
    read = await steps.readInFlight()
  } catch {
    store.dispatch({ type: 'lookup', run, reading: 'failed' })
    return
  }
  if (read.status !== 'present') {
    store.dispatch({ type: 'lookup', run, reading: 'none' })
    return
  }
  await followSave(store, steps, run, read.value, options)
}

/**
 * From a refusal whose operation may still land: where a read of the account's
 * setup found one, the save landed while no page followed it, and the check
 * runs with the run's save as after a landed receipt. No setup moves nothing.
 */
export const endWhereSetUp = async (
  store: ArmStore,
  steps: SaveSteps,
  hasSetup: boolean,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  const { write } = store.state()
  if (!hasSetup || !mayStillLand(write) || store.state().landedUnseen) {
    return
  }
  store.dispatch({ type: 'landedUnseen', run: write.run })
  await settle(store, steps, write.run, options)
}

/**
 * From a refusal whose operation may still land: reads the account's setup
 * again. A setup found leads to the check; no setup, or a read that fails,
 * leaves the run as it was, with nothing sent.
 */
export const checkSetupAgain = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  if (!mayStillLand(store.state().write) || store.state().landedUnseen) {
    return
  }
  const { run } = store.state().write
  let found: boolean
  try {
    found = await steps.hasSetup()
  } catch {
    return
  }
  if (inRun(store.state(), run)) {
    await endWhereSetUp(store, steps, found, options)
  }
}

/**
 * From a stalled receipt wait: waits for the same hash once more, taking up
 * the wait still open on it, then the check where it landed. From a followed
 * request whose read did not answer: reads it again at once.
 */
export const checkReceiptAgain = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  const state = store.state()
  const { run } = state.write
  if (state.follow === 'unread' && awaitingHashIn(state, run)) {
    WAKES.get(store)?.()
    return
  }
  if (!state.stalled || !pendingHashIn(state, run)) {
    return
  }
  store.dispatch({ type: 'waitResumed', run })
  await reattach(store, steps, run, options)
}

/** Reads the check again where it did not answer. */
export const rereadConfirmation = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  if (store.state().after.stage !== 'unread') {
    return
  }
  await settle(store, steps, store.state().write.run, options)
}

/** Whether the save reads as saved: only after the check agreed and the wipe ran. */
export const isSaved = (state: ArmState): boolean => state.after.stage === 'saved'
