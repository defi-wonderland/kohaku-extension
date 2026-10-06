/**
 * The execution's run: the shared write machine for the gas check, the
 * deposit step, the send and the receipt, and the claim of the execution on
 * the countdown's record.
 *
 *   idle ──start──▶ checkingGas: the countdown read, the prepare, the gas check
 *                     ├─ a claim on the countdown ─▶ followed (nothing sent)
 *                     ├─ deposit ──▶ needsDeposit ──the balance read again──▶ the claim
 *                     └─ enough ───▶ the claim
 *                                     ├─ another page's claim ─▶ followed (nothing sent)
 *                                     └─ its own ──▶ submitting ──▶ failedNotSent | failedReverted | landed
 *   followed, a hash ──▶ its receipt, as after a send
 *   followed, no hash ──▶ the countdown read again until a hash arrives, the
 *                         claim goes, or the claim grows older than
 *                         `SUBMISSION_CLAIM_AGE_MS`: the manager's events from
 *                         the claim's block then name the attempt consumed
 *                         (the poll goes on to the done screen) or not (the
 *                         claim released, execute offered again)
 *
 * The countdown is read before anything is prepared, so a retry, a reload or
 * a second tab never sends a second execution for the same attempt: a claim
 * the countdown carries is followed, never sent again, and a page sends only
 * under the claim it wrote itself, with nothing awaited between the claim and
 * the hand-over to the wallet. The claim is released where the run ended with
 * nothing on its way to the chain (a send the wallet refused, a replaced
 * transaction, a revert, a send no node knows past the dropped age). A send
 * that may still land, and a landed one, keep it until the countdown ends.
 *
 * The store is kept per chain, account and attempt while work is in flight,
 * so a second press or a remount takes up the run instead of starting one. A
 * landed receipt is not the screen's done: the wait's poll reads the attempt
 * consumed before the done screen renders. Every answer carries its run, so
 * the answer of a run left behind moves nothing.
 */
import type {
  ExecutionInFlightClaim,
  ExecutionInFlightRecord
} from '@web/modules/social-recovery/shared/records'
import {
  initialWriteState,
  mayStillLand,
  writeReducer
} from '@web/modules/social-recovery/shared/writes'
import type { WriteEvent } from '@web/modules/social-recovery/shared/writes'
import { DROPPED_AFTER_MS } from '@web/modules/social-recovery/setup/arm'
import {
  FOLLOW_REREAD_MS,
  SUBMISSION_CLAIM_AGE_MS
} from '@web/modules/social-recovery/recovery/submit'

import { EXECUTE_BALANCE_POLL_MS } from './constants'
import type { ExecuteEvent, ExecuteState, ExecuteSteps, ExecuteStore } from './types'

/** The execution before anything ran. */
export const initialExecuteState = (): ExecuteState => ({ write: initialWriteState('execution') })

const inRun = (state: ExecuteState, run: number): boolean => state.write.run === run

/** Whether the run sends with no hash yet: the wallet's window waits, or a followed claim is read. */
const awaitingHashIn = (state: ExecuteState, run: number): boolean =>
  inRun(state, run) && state.write.status === 'submitting' && !state.write.transactionHash

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
      if (state.follow && (write.status !== 'submitting' || write.transactionHash)) {
        delete next.follow
      }
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
    case 'claimed':
      if (!awaitingHashIn(state, event.run) || state.requestId || state.followed) {
        return state
      }
      return { ...state, requestId: event.requestId }
    case 'released': {
      if (!inRun(state, event.run) || (!state.requestId && !state.followed)) {
        return state
      }
      const { requestId, followed, ...rest } = state
      return rest
    }
    case 'follow': {
      // From an idle run, or one whose send may still land, a new run follows
      // the claim; in a run whose own claim lost, the run follows it instead.
      const opens =
        inRun(state, event.run) && (state.write.status === 'idle' || mayStillLand(state.write))
      if (!opens && (!awaitingHashIn(state, event.run) || state.requestId || state.followed)) {
        return state
      }
      const run = opens ? event.run + 1 : event.run
      const { claim } = event
      const hash = claim.transactionHash
      return {
        write: {
          status: 'submitting',
          write: 'execution',
          run,
          ...(hash
            ? { transactionHash: hash, sentHashes: [hash], startBlock: claim.startBlock }
            : {})
        },
        followed: claim.requestId,
        // The claim's moment is the earliest its send went out, for the dropped reading.
        ...(hash ? { sentAt: claim.claimedAt } : {}),
        ...(hash
          ? {}
          : {
              follow: {
                requestId: claim.requestId,
                startBlock: claim.startBlock,
                claimedAt: claim.claimedAt
              }
            }),
        ...(state.prepared ? { prepared: state.prepared } : {})
      }
    }
    case 'voided':
      // A followed claim that went, or that never went out: execute is offered again.
      if (!awaitingHashIn(state, event.run) || !state.follow) {
        return state
      }
      return { write: writeReducer(state.write, { type: 'reset' }) }
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
const FOLLOWING = new WeakSet<ExecuteStore>()
const WAITING = new WeakSet<ExecuteStore>()
// The idle run whose countdown was read for a claim, so each idle run reads it once.
const LOOKED = new WeakMap<ExecuteStore, number>()

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

/**
 * Whether the run ended with nothing on its way to the chain, so its claim
 * goes: a send never made that cannot still land (refused, replaced), or a
 * revert. A landing, a send that may still land and a receipt wait keep it.
 */
const endedWithNothingInFlight = (state: ExecuteState): boolean =>
  state.write.status === 'failedReverted' ||
  (state.write.status === 'failedNotSent' && !mayStillLand(state.write))

/** Releases the claim the run sent or followed where the run ended with nothing on its way to the chain. */
const releaseWhereEnded = async (store: ExecuteStore, steps: ExecuteSteps): Promise<void> => {
  const state = store.state()
  const requestId = state.requestId ?? state.followed
  if (!requestId || !endedWithNothingInFlight(state)) {
    return
  }
  store.dispatch({ type: 'released', run: state.write.run })
  await steps.release(requestId).catch(() => undefined)
}

/** Waits for the receipt of the hash the run follows, then releases where it ended. */
const waitForReceipt = async (store: ExecuteStore, steps: ExecuteSteps): Promise<void> => {
  const state = store.state()
  const { write } = state
  if (write.status !== 'submitting' || !write.transactionHash || WAITING.has(store)) {
    return
  }
  WAITING.add(store)
  try {
    await steps.waitAgain(write.transactionHash, write.startBlock, writeEvent(store), write.run)
  } finally {
    WAITING.delete(store)
  }
  await releaseWhereEnded(store, steps)
}

/**
 * Reads the followed claim with no hash while a screen is attached: a hash
 * that arrives is waited on; a claim that went, or another page's claim in its
 * place, ends the follow (the latter is followed in turn). A claim older than
 * `SUBMISSION_CLAIM_AGE_MS` by the clock read before the countdown read is
 * judged by the manager's events from the claim's block: the attempt consumed
 * leaves the done screen to the poll; none means the send never went out, and
 * where the claim still carries no hash it is released and execute offered
 * again. A read that fails is read again after a rest, never taken as an
 * answer.
 */
const readFollow = async (store: ExecuteStore): Promise<void> => {
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
      const read = await steps.readCountdown().catch(() => undefined)
      if (store.state().follow !== follow) {
        // eslint-disable-next-line no-continue
        continue
      }
      const held: ExecutionInFlightRecord | undefined =
        read?.status === 'present' ? read.value.execution : undefined
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
        store.dispatch({ type: 'sentAt', run, at: held.claimedAt })
        waitAfter = true
        return
      }
      if (held && clock - held.claimedAt >= SUBMISSION_CLAIM_AGE_MS) {
        // eslint-disable-next-line no-await-in-loop
        const consumed = await steps.consumedSince(follow.startBlock).catch(() => undefined)
        if (store.state().follow !== follow) {
          // eslint-disable-next-line no-continue
          continue
        }
        if (consumed === true) {
          return
        }
        if (consumed === false) {
          // A hash written meanwhile is followed, never released.
          // eslint-disable-next-line no-await-in-loop
          const again = await steps.readCountdown().catch(() => undefined)
          const now = again?.status === 'present' ? again.value.execution : undefined
          if (store.state().follow !== follow) {
            // eslint-disable-next-line no-continue
            continue
          }
          if (now?.requestId === follow.requestId && !now.transactionHash) {
            // eslint-disable-next-line no-await-in-loop
            const released = await steps.release(follow.requestId).then(
              () => true,
              () => false
            )
            if (released && store.state().follow === follow) {
              store.dispatch({ type: 'voided', run })
              return
            }
          } else if (again) {
            // eslint-disable-next-line no-continue
            continue
          }
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await rest(FOLLOW_REREAD_MS)
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
  store: ExecuteStore,
  steps: ExecuteSteps,
  run: number,
  claim: ExecutionInFlightRecord
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
 * The claim of the execution on the countdown under a new request id, with
 * the block read before it, then the send under that claim; where the
 * countdown already carries a claim, it is followed and nothing is sent.
 * Nothing is awaited between the claim and the hand-over to the wallet. The
 * hash is written on the claim before the run's end releases it.
 */
const claimAndSend = async (
  store: ExecuteStore,
  steps: ExecuteSteps,
  run: number
): Promise<void> => {
  const { prepared } = store.state()
  if (!prepared || !awaitingHashIn(store.state(), run)) {
    return
  }
  const dispatch = writeEvent(store)
  let startBlock: number
  try {
    startBlock = await steps.blockNumber()
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  if (!awaitingHashIn(store.state(), run)) {
    return
  }
  const claim: ExecutionInFlightClaim = {
    requestId: steps.newRequestId(),
    startBlock,
    claimedAt: steps.now()
  }
  let written
  try {
    written = await steps.claim(claim)
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  if (!written.claimed) {
    await followClaim(store, steps, run, written.execution)
    return
  }
  store.dispatch({ type: 'claimed', run, requestId: claim.requestId })
  if (store.state().requestId !== claim.requestId) {
    await steps.release(claim.requestId).catch(() => undefined)
    return
  }
  let marking: Promise<void> = Promise.resolve()
  const sendDispatch = (event: WriteEvent) => {
    dispatch(event)
    if (event.type === 'sent' && event.run === run) {
      store.dispatch({ type: 'sentAt', run, at: steps.now() })
      marking = steps.markSent(claim, event.transactionHash).catch(() => undefined)
    }
  }
  try {
    await steps.send(prepared, sendDispatch, run, startBlock, claim.requestId)
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
  }
  await marking
  await releaseWhereEnded(store, steps)
}

/**
 * While the deposit step shows and a screen is attached: the gas check again
 * every `EXECUTE_BALANCE_POLL_MS` on the same prepared call. Enough goes on to
 * the claim and the send by itself; short keeps the step with the latest
 * balance; a read that fails reads as the gas check's failure, with its retry.
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
 * Before execute is offered: reads the countdown and, where it carries a
 * claim, follows it in a new run with nothing sent. Reads once per idle run,
 * and again after a read that failed.
 */
const lookForClaim = async (store: ExecuteStore, steps: ExecuteSteps): Promise<void> => {
  const state = store.state()
  const { run } = state.write
  if (state.write.status !== 'idle' || LOOKED.get(store) === run) {
    return
  }
  LOOKED.set(store, run)
  const read = await steps.readCountdown().catch(() => undefined)
  if (!read) {
    if (LOOKED.get(store) === run) {
      LOOKED.delete(store)
    }
    return
  }
  const claim = read.status === 'present' ? read.value.execution : undefined
  if (claim) {
    await followClaim(store, steps, run, claim)
  }
}

/**
 * Attaches the steps of the screen that now holds the store: a claim the
 * countdown carries is looked for, and a followed claim and the deposit
 * step's reads go on through them.
 */
export const attachExecuteSteps = (store: ExecuteStore, steps: ExecuteSteps): void => {
  ATTACHED.set(store, steps)
  lookForClaim(store, steps).catch(() => undefined)
  readFollow(store).catch(() => undefined)
  if (store.state().write.status === 'needsDeposit') {
    pollDeposit(store).catch(() => undefined)
  }
}

/**
 * Starts the execution, from nothing or from a state that offers the retry:
 * the countdown read (a claim it carries is followed), the prepare, the gas
 * check, then the deposit step or the claim and the send. The write machine
 * refuses the start while work is in flight, after a landing, and after a
 * send that may still land; a refused start does nothing.
 */
export const startExecution = async (store: ExecuteStore, steps: ExecuteSteps): Promise<void> => {
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
    read = await steps.readCountdown()
  } catch (error: unknown) {
    fail(error)
    return
  }
  if (!stillChecking()) {
    return
  }
  if (read.status !== 'present') {
    fail(new Error('No countdown to execute.'))
    return
  }
  if (read.value.execution) {
    writeEvent(store)({ type: 'reset' })
    await followClaim(store, steps, run, read.value.execution)
    return
  }

  try {
    const prepared = await steps.prepare()
    store.dispatch({ type: 'prepared', run, prepared })
  } catch (error: unknown) {
    fail(error)
    return
  }
  const { prepared } = store.state()
  if (!prepared || !stillChecking()) {
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
  await claimAndSend(store, steps, run)
}

/**
 * The dropped reading, called where the attempt read still disagrees with a
 * send (the attempt is not consumed): past `DROPPED_AFTER_MS` since its first
 * hash, by the clock read before the reads, where the node knows none of the
 * run's hashes, the claim is released and execute is offered again. A read
 * that fails, or a release that fails, decides nothing.
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
    if (!known.every((reading) => reading === 'unknown') || store.state().write !== write) {
      return
    }
    const requestId = state.requestId ?? state.followed
    if (requestId) {
      await steps.release(requestId)
    }
    if (store.state().write === write) {
      writeEvent(store)({ type: 'reset' })
    }
  } catch {
    // A failed read is no answer; the next poll asks again.
  } finally {
    DROP_CHECKS.delete(store)
  }
}
