/**
 * The execution's steps over the wallet's own seams, in the submission's
 * shape: the countdown and its execution in flight in the records, the
 * execution call the client prepares for the attempt and the payload that
 * started it, the shared gas check on the same sending key, the send through
 * the request queue by route, the receipt wait, the manager's events for a
 * claim with no hash, and the node's read of a hash.
 *
 * Every update of the countdown reads it first and passes the revision it
 * read; where another page moved it meanwhile, the update is tried again over
 * a fresh read while the countdown is there.
 */
import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'
import {
  accountBatchTransactionOf,
  newSendRequestId,
  sameAddress
} from '@web/modules/social-recovery/shared/client'
import { isSessionRevisionConflict } from '@web/modules/social-recovery/shared/records'
import type {
  CountdownRead,
  ExecutionInFlightRecord,
  SessionRevision
} from '@web/modules/social-recovery/shared/records'
import {
  assertWriteDoor,
  checkGas,
  driveAccountBatch,
  driveSend,
  gasTransactionOf,
  receiptOf,
  walletAccountRefOf
} from '@web/modules/social-recovery/shared/writes'

import { COUNTDOWN_CONFLICT_RETRIES } from './constants'
import { isAttemptOf } from './read'
import type { ExecuteSteps, ExecuteStepsInput } from './types'

export const executeStepsOf = (input: ExecuteStepsInput): ExecuteSteps => {
  const { records, chainId, account, landed, client, plan, network, reads, receipts, port } = input
  const { attempt, payload } = input
  const countdown = records.countdown(chainId, account)

  // A block number that is not a safe integer of zero or more reads as a failed read.
  const blockNumber = async (): Promise<number> => {
    const block = await receipts.blockNumber()
    if (!Number.isSafeInteger(block) || block < 0) {
      throw new Error(`The chain answered no usable block number: ${String(block)}`)
    }
    return block
  }

  // An update over a fresh read of the countdown, read and tried again where another page moved it.
  const withFreshRevision = async <T>(
    update: (
      revision: SessionRevision,
      execution: ExecutionInFlightRecord | undefined
    ) => Promise<T>,
    tries = 0
  ): Promise<T> => {
    const read = await countdown.read()
    if (read.status !== 'present') {
      throw new Error(`No countdown for ${account}`)
    }
    try {
      return await update(read.revision, read.value.execution)
    } catch (error: unknown) {
      if (!isSessionRevisionConflict(error) || tries >= COUNTDOWN_CONFLICT_RETRIES) {
        throw error
      }
      return withFreshRevision(update, tries + 1)
    }
  }

  const receiptsFrom = (startBlock: number) => ({
    blockNumber: () => Promise.resolve(startBlock),
    wait: (transactionHash: Hex, from: number) => receipts.wait(transactionHash, from)
  })

  return {
    readCountdown: (): Promise<CountdownRead> => countdown.read(),
    async prepare() {
      const prepared = await client.recovery.prepareExecuteHandover(attempt, payload)
      assertWriteDoor('execution', prepared)
      return prepared
    },
    checkGas: (prepared) =>
      plan.kind === 'key'
        ? checkGas({
            write: 'execution',
            prepared,
            key: plan.key,
            reads,
            network,
            fastTrack: true
          })
        : checkGas({
            write: 'execution',
            prepared,
            key: plan.key,
            reads,
            network,
            transaction: accountBatchTransactionOf(plan.facts, plan.key, [prepared]),
            operates: walletAccountRefOf(plan.facts)
          }),
    blockNumber,
    newRequestId: newSendRequestId,
    claim: (claim) => withFreshRevision((revision) => countdown.claimExecution(claim, revision)),
    async markSent(claim, transactionHash) {
      await withFreshRevision(async (revision, execution) => {
        if (execution?.requestId === claim.requestId) {
          await countdown.setExecutionHash(claim.requestId, transactionHash, revision)
          return
        }
        // Another page released the claim while the wallet still held the send: written back with its hash.
        if (!execution) {
          const written = await countdown.claimExecution(claim, revision)
          if (written.claimed) {
            await countdown.setExecutionHash(
              claim.requestId,
              transactionHash,
              written.record.revision
            )
          }
        }
      })
    },
    async release(requestId) {
      await withFreshRevision((revision) => countdown.releaseExecution(requestId, revision))
    },
    send: (prepared, dispatch, run, startBlock, requestId) =>
      plan.kind === 'key'
        ? driveSend({
            dispatch,
            run,
            receipts: receiptsFrom(startBlock),
            port,
            key: plan.key,
            transaction: gasTransactionOf({ prepared, key: plan.key })
          })
        : driveAccountBatch({
            dispatch,
            run,
            receipts: receiptsFrom(startBlock),
            port,
            account: plan.facts.account.addr as Address,
            calls: [prepared],
            requestId
          }),
    async waitAgain(transactionHash, startBlock, dispatch, run) {
      try {
        const from = startBlock ?? (await blockNumber())
        const receipt = receiptOf(await receipts.wait(transactionHash, from))
        // A receipt with no status reads neither way, so the write keeps its hash.
        if (receipt) {
          dispatch({ type: 'receipt', run, receipt })
        }
      } catch (error: unknown) {
        dispatch({ type: 'error', run, error, transactionHash })
      }
    },
    async consumedSince(startBlock) {
      const state = await client.recovery.recoveryState()
      if (state.attempt.state === 'Consumed' && isAttemptOf(state.attempt, landed)) {
        return true
      }
      const to = state.block.number
      if (to < startBlock) {
        throw new Error(`The node reads block ${to}, before the claim's block ${startBlock}.`)
      }
      const { events } = client.recovery
      const notifications = await events.fetch(events.accountFilter(), { from: startBlock, to })
      return notifications.some(
        (notification) =>
          notification.kind === 'attempt-consumed' &&
          !notification.at.removed &&
          notification.attemptId === landed.attemptId &&
          sameAddress(notification.account, account)
      )
    },
    transactionKnown: (transactionHash) => receipts.transactionKnown(transactionHash),
    now: input.now
  }
}
