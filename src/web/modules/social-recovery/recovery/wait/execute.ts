/**
 * The execution's run: the shared write machine for the gas check, the
 * deposit step, the send and the receipt.
 *
 *   idle ──start──▶ checkingGas: the prepare, the gas check
 *                     ├─ deposit ──▶ needsDeposit ──the balance read again──▶ the send
 *                     └─ enough ───▶ submitting ──▶ failedNotSent | failedReverted | landed
 *
 * The session keeps no claim once the submission landed, so the run guards
 * the send itself: one store per chain and account, kept while work is in
 * flight, so a second press, a remount or a retry never sends a second
 * execution while one is on its way. A landed receipt is not the screen's
 * done: the wait's poll reads the attempt consumed before the done screen
 * renders. A send whose hashes no node knows past the dropped age, while the
 * attempt read still disagrees, is dropped and execute is offered again.
 * Every answer carries its run, so the answer of a run left behind moves
 * nothing.
 */
import {
  initialWriteState,
  mayStillLand,
  writeReducer
} from '@web/modules/social-recovery/shared/writes'
import type { WriteEvent } from '@web/modules/social-recovery/shared/writes'
import { DROPPED_AFTER_MS } from '@web/modules/social-recovery/setup/arm'

import { EXECUTE_BALANCE_POLL_MS } from './constants'
import type { ExecuteEvent, ExecuteState, ExecuteSteps, ExecuteStore } from './types'

/** The execution before anything ran. */
export const initialExecuteState = (): ExecuteState => ({ write: initialWriteState('execution') })

const inRun = (state: ExecuteState, run: number): boolean => state.write.run === run

/** The execution's reducer. Pure: an event a state does not take leaves it as it was (the same object). */
export const executeReducer = (state: ExecuteState, event: ExecuteEvent): ExecuteState => {
  switch (event.type) {
    case 'write': {
      const write = writeReducer(state.write, event.event)
      if (write === state.write) {
        return state
      }
      if (write.run !== state.write.run || write.status === 'idle') {
        return { write }
      }
      const next: ExecuteState = { ...state, write }
      if (write.status !== 'needsDeposit') {
        delete next.balance
      }
      return next
    }
    case 'prepared':
      if (!inRun(state, event.run) || state.write.status !== 'checkingGas') {
        return state
      }
      return { ...state, prepared: event.prepared }
    case 'balance':
      if (
        !inRun(state, event.run) ||
        state.write.status !== 'needsDeposit' ||
        state.balance === event.balance
      ) {
        return state
      }
      return { ...state, balance: event.balance }
    case 'sentAt':
      if (!inRun(state, event.run) || state.write.status !== 'submitting' || state.sentAt) {
        return state
      }
      return { ...state, sentAt: event.at }
    default:
      return state
  }
}

/** A store over the reducer. */
export const createExecuteStore = (initial: ExecuteState = initialExecuteState()): ExecuteStore => {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    state: () => current,
    dispatch(event) {
      const next = executeReducer(current, event)
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

/** Whether the run has work in flight a new start must not repeat. */
export const isExecuting = (state: ExecuteState): boolean => {
  const { status } = state.write
  return status === 'checkingGas' || status === 'needsDeposit' || status === 'submitting'
}

/** Whether the screen keeps the run when it leaves it: work in flight, a landing, or a send that may still land. */
export const outlivesWait = (state: ExecuteState): boolean =>
  isExecuting(state) || state.write.status === 'landed' || mayStillLand(state.write)

// The steps of the screen attached to each store, while one is.
const ATTACHED = new WeakMap<ExecuteStore, ExecuteSteps>()
const POLLING = new WeakSet<ExecuteStore>()
const DROP_CHECKS = new WeakSet<ExecuteStore>()

export const detachExecuteSteps = (store: ExecuteStore, steps: ExecuteSteps): void => {
  if (ATTACHED.get(store) === steps) {
    ATTACHED.delete(store)
  }
}

const writeEvent = (store: ExecuteStore) => (event: WriteEvent) =>
  store.dispatch({ type: 'write', event })

const rest = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** The send of the run's prepared execution, its first hash's moment kept for the dropped reading. */
const send = async (store: ExecuteStore, steps: ExecuteSteps, run: number): Promise<void> => {
  const { prepared } = store.state()
  if (!prepared || !inRun(store.state(), run) || store.state().write.status !== 'submitting') {
    return
  }
  const dispatch = (event: WriteEvent) => {
    writeEvent(store)(event)
    if (event.type === 'sent' && event.run === run) {
      store.dispatch({ type: 'sentAt', run, at: steps.now() })
    }
  }
  try {
    await steps.send(prepared, dispatch, run)
  } catch (error: unknown) {
    writeEvent(store)({ type: 'error', run, error })
  }
}

/**
 * While the deposit step shows and a screen is attached: the gas check again
 * every `EXECUTE_BALANCE_POLL_MS` on the same prepared call. Enough goes on to
 * the send by itself; short keeps the step with the latest balance; a read
 * that fails reads as the gas check's failure, with its retry.
 */
const pollDeposit = async (store: ExecuteStore): Promise<void> => {
  if (POLLING.has(store)) {
    return
  }
  POLLING.add(store)
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      await rest(EXECUTE_BALANCE_POLL_MS)
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
        await send(store, steps, run)
        return
      }
      store.dispatch({ type: 'balance', run, balance: check.step.balance })
    }
  } finally {
    POLLING.delete(store)
  }
}

/** Attaches the steps of the screen that now holds the store; a deposit step's reads go on through them. */
export const attachExecuteSteps = (store: ExecuteStore, steps: ExecuteSteps): void => {
  ATTACHED.set(store, steps)
  if (store.state().write.status === 'needsDeposit') {
    pollDeposit(store).catch(() => undefined)
  }
}

/**
 * Starts the execution, from nothing or from a state that offers the retry:
 * the prepare, the gas check, then the deposit step or the send. Does nothing
 * while work is in flight, after a landing, or after a send that may still land.
 */
export const startExecution = async (store: ExecuteStore, steps: ExecuteSteps): Promise<void> => {
  const state = store.state()
  if (isExecuting(state) || state.write.status === 'landed' || mayStillLand(state.write)) {
    return
  }
  const before = state.write.run
  writeEvent(store)({ type: 'start' })
  const { run } = store.state().write
  if (run === before) {
    return
  }
  const fail = (error: unknown) => writeEvent(store)({ type: 'error', run, error })
  try {
    const prepared = await steps.prepare()
    store.dispatch({ type: 'prepared', run, prepared })
  } catch (error: unknown) {
    fail(error)
    return
  }
  const { prepared } = store.state()
  if (!prepared || !inRun(store.state(), run) || store.state().write.status !== 'checkingGas') {
    return
  }
  try {
    writeEvent(store)({ type: 'gasChecked', run, check: await steps.checkGas(prepared) })
  } catch (error: unknown) {
    fail(error)
    return
  }
  if (store.state().write.status === 'needsDeposit') {
    pollDeposit(store).catch(() => undefined)
    return
  }
  await send(store, steps, run)
}

/**
 * The dropped reading, called where the attempt read still disagrees with a
 * send (the attempt is not consumed): past `DROPPED_AFTER_MS` since its first
 * hash, by the clock read before the reads, where the node knows none of the
 * run's hashes, the send is dropped and execute is offered again. A read that
 * fails decides nothing.
 */
export const checkDropped = async (store: ExecuteStore, steps: ExecuteSteps): Promise<void> => {
  const clock = steps.now()
  const state = store.state()
  const { write } = state
  if (
    DROP_CHECKS.has(store) ||
    write.status !== 'submitting' ||
    !write.transactionHash ||
    state.sentAt === undefined ||
    clock - state.sentAt < DROPPED_AFTER_MS
  ) {
    return
  }
  DROP_CHECKS.add(store)
  try {
    const hashes = write.sentHashes ?? [write.transactionHash]
    const known = await Promise.all(hashes.map((hash) => steps.transactionKnown(hash)))
    if (known.every((reading) => reading === 'unknown') && store.state().write === write) {
      writeEvent(store)({ type: 'reset' })
    }
  } catch {
    // A failed read is no answer; the next poll asks again.
  } finally {
    DROP_CHECKS.delete(store)
  }
}
