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
 * setup. A refusal whose operation may still land offers no retry, only a
 * read of the setup that ends the run where the operation landed. The
 * records are wiped, and the save reads as saved, only after the check agreed
 * on a landed receipt of the run. A failed or disagreed save wipes nothing.
 * Every event after the write's carries its run, so the answer of a run the
 * holder left behind moves nothing.
 */
import type { FeeReading } from '@web/modules/social-recovery/shared/client'
import { initialWriteState, writeReducer } from '@web/modules/social-recovery/shared/writes'
import type { WriteEvent } from '@web/modules/social-recovery/shared/writes'

import { RECEIPT_WAIT_MS } from './constants'
import { confirmOutcomeOf } from './outcome'
import { mayStillLand } from './refusal'
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

const landedIn = (state: ArmState, run: number): boolean =>
  inRun(state, run) && state.write.status === 'landed'

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
        return { write, after: { stage: 'none' } }
      }
      // A stalled wait ends with the write's submitting: whatever settled it answered.
      if (state.stalled && write.status !== 'submitting') {
        return { ...state, write, stalled: false }
      }
      return { ...state, write }
    }
    case 'alreadySetUp':
      // Taken while the run reads the setup before it prepares or sends, and
      // after a refusal whose operation may still land, once a read finds it landed.
      if (
        !inRun(state, event.run) ||
        (state.write.status !== 'checkingGas' && !mayStillLand(state.write))
      ) {
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
 * or the check after the landing and the wipe.
 */
export const isLive = (state: ArmState): boolean => {
  const { write, after } = state
  if (state.stop) {
    return false
  }
  if (write.status === 'checkingGas' || write.status === 'submitting') {
    return true
  }
  return (
    write.status === 'landed' &&
    (after.stage === 'none' || after.stage === 'confirming' || after.stage === 'saving')
  )
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
  isLive(state) || (!state.stop && (mayStillLand(state.write) || state.after.stage === 'unread'))

const writeEvent = (store: ArmStore) => (event: WriteEvent) =>
  store.dispatch({ type: 'write', event })

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
 * After a landed receipt: the check, then the wipe where it agreed. A wipe
 * that fails still reads as saved, since the setup is live on chain.
 */
const settle = async (
  store: ArmStore,
  steps: SaveSteps,
  run: number,
  options: ConfirmReadOptions
): Promise<void> => {
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
 * failed and the batch may still land; a wait that fails again, or runs past
 * `RECEIPT_WAIT_MS`, leaves the run stalled under its hash until the holder
 * asks to check again. A wait past its limit goes on: a receipt it brings
 * later is taken while the run still submits that hash, and the check follows.
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
  const waiting = steps.waitAgain(transactionHash, write.startBlock, writeEvent(store), run)
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

/** The gas check of the run's prepared save, the send where the key holds enough, then the check. */
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
  if (!inRun(store.state(), run) || store.state().write.status !== 'submitting') {
    return
  }
  try {
    await steps.send(prepared, dispatch, run, (reading) =>
      store.dispatch({ type: 'estimated', run, reading })
    )
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  await waitForReceipt(store, steps, run, options)
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
 * run reads the account's setup, prepares the save again, runs the gas check
 * and sends. A setup already on the account ends the run with nothing
 * prepared; a refusal of the prepare reads as never sent. Does nothing where
 * the save cannot start, nor after a refusal whose operation may still land.
 */
export const startSave = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  if (mayStillLand(store.state().write)) {
    return
  }
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
 * again on the same prepared save, then the send. A setup found meanwhile, by
 * another tab, ends the run with nothing checked or sent.
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
 * Ends a refusal whose operation may still land as already set up, where a
 * read of the account's setup found one. Moves nothing in any other state.
 */
export const endWhereSetUp = (store: ArmStore, hasSetup: boolean): void => {
  const { write } = store.state()
  if (hasSetup && mayStillLand(write)) {
    store.dispatch({ type: 'alreadySetUp', run: write.run })
  }
}

/**
 * From a refusal whose operation may still land: reads the account's setup
 * again. A setup found ends the run as already set up; no setup, or a read
 * that fails, leaves the run as it was, with nothing sent.
 */
export const checkSetupAgain = async (store: ArmStore, steps: SaveSteps): Promise<void> => {
  if (!mayStillLand(store.state().write)) {
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
    endWhereSetUp(store, found)
  }
}

/** From a stalled receipt wait: waits for the same hash once more, then the check where it landed. */
export const checkReceiptAgain = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  const { run } = store.state().write
  if (!store.state().stalled || !pendingHashIn(store.state(), run)) {
    return
  }
  store.dispatch({ type: 'waitResumed', run })
  await waitForReceipt(store, steps, run, options)
  await settle(store, steps, run, options)
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
