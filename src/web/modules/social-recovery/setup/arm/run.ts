/**
 * The save's run: the shared write machine for the gas check, the send and
 * the receipt, and after a landed receipt the check that decides whether the
 * save reads as saved.
 *
 *   idle ──start──▶ checkingGas: prepare, then the gas check
 *                     ├─ deposit ──▶ needsDeposit ──recheck──▶ checkingGas
 *                     ├─ a refusal ─▶ failedNotSent (nothing sent)
 *                     └─ enough ───▶ submitting ──▶ failedNotSent | failedReverted | landed
 *   landed ──▶ confirming ──▶ saving (the records wiped) ──▶ saved
 *                         ├──▶ disagreed (the commitment, or the authorization)
 *                         └──▶ unread ──reread──▶ confirming
 *
 * The records are wiped, and the save reads as saved, only after the check
 * agreed on a landed receipt of the run. A failed or disagreed save wipes
 * nothing. Every event after the write's carries its run, so the answer of a
 * run the holder left behind moves nothing.
 */
import { initialWriteState, writeReducer } from '@web/modules/social-recovery/shared/writes'
import type { WriteEvent } from '@web/modules/social-recovery/shared/writes'

import { confirmOutcomeOf } from './outcome'
import type { ArmEvent, ArmState, ArmStore, ConfirmReadOptions, SaveSteps } from './types'

/** The save before anything ran. */
export const initialArmState = (): ArmState => ({
  write: initialWriteState('save'),
  after: { stage: 'none' }
})

const inRun = (state: ArmState, run: number): boolean => state.write.run === run

const landedIn = (state: ArmState, run: number): boolean =>
  inRun(state, run) && state.write.status === 'landed'

/** The save's reducer. Pure: an event a state does not take leaves it as it was (the same object). */
export const armReducer = (state: ArmState, event: ArmEvent): ArmState => {
  switch (event.type) {
    case 'write': {
      const write = writeReducer(state.write, event.event)
      if (write === state.write) {
        return state
      }
      // A new run starts from nothing: its own prepare, its own landing.
      if (write.run !== state.write.run) {
        return { write, after: { stage: 'none' } }
      }
      return { ...state, write }
    }
    case 'prepared':
      if (!inRun(state, event.run) || state.write.status !== 'checkingGas' || state.prepared) {
        return state
      }
      return { ...state, prepared: event.prepared }
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

const writeEvent = (store: ArmStore) => (event: WriteEvent) =>
  store.dispatch({ type: 'write', event })

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
  store.dispatch({ type: 'confirming', run })
  if (store.state().after.stage !== 'confirming') {
    return
  }
  const outcome = await confirmOutcomeOf(() => steps.confirm(prepared), options)
  store.dispatch({ type: 'confirmed', run, outcome })
  if (outcome.kind !== 'agreed' || store.state().after.stage !== 'saving') {
    return
  }
  try {
    await steps.wipe()
  } catch {
    // The setup is live whether or not this device could drop its draft.
  }
  store.dispatch({ type: 'wiped', run })
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
    await steps.send(prepared, dispatch, run)
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  await settle(store, steps, run, options)
}

/**
 * Starts the save, from nothing or from a state that offers the retry: a new
 * run prepares the save again, runs the gas check and sends. A refusal of the
 * prepare reads as never sent. Does nothing where the save cannot start.
 */
export const startSave = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  const before = store.state().write.run
  writeEvent(store)({ type: 'start' })
  const { run } = store.state().write
  if (run === before) {
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

/** From the deposit blocker: the gas check again on the same prepared save, then the send. */
export const recheckGas = async (
  store: ArmStore,
  steps: SaveSteps,
  options: ConfirmReadOptions = {}
): Promise<void> => {
  if (store.state().write.status !== 'needsDeposit') {
    return
  }
  writeEvent(store)({ type: 'recheck' })
  await checkAndSend(store, steps, store.state().write.run, options)
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
