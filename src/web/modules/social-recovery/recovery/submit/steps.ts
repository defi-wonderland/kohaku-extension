/**
 * The submission's steps over the wallet's own seams: the session and its
 * claim in the records, the attempt read and the prepare through the client,
 * the shared gas check on the sending key, the send through the request queue
 * by route, the receipt wait, the manager's events for a claim with no hash,
 * and the landing of the session.
 *
 * Every update of the session reads it first and passes the revision it read;
 * where another tab moved it meanwhile (a reply poll, a note), the update is
 * tried again over a fresh read while the session is live.
 */
import { keccak256 } from 'viem'

import type { Address, Hex, RecoveryState } from '@web/modules/social-recovery/sdk-interfaces'
import {
  accountBatchTransactionOf,
  newSendRequestId,
  sameAddress
} from '@web/modules/social-recovery/shared/client'
import { isSessionRevisionConflict } from '@web/modules/social-recovery/shared/records'
import type { SessionRevision } from '@web/modules/social-recovery/shared/records'
import {
  assertWriteDoor,
  checkGas,
  driveAccountBatch,
  driveSend,
  gasTransactionOf,
  receiptOf,
  walletAccountRefOf
} from '@web/modules/social-recovery/shared/writes'

import { CONFLICT_RETRIES } from './constants'
import type { AttemptReading, SubmitSteps, SubmitStepsInput } from './types'

export const submitStepsOf = (input: SubmitStepsInput): SubmitSteps => {
  const { client, records, chainId, account, gathering, plan, network, reads } = input
  const session = records.recoverySession(chainId, account)
  const attemptId = BigInt(gathering.request.attemptId)
  const setupNonce = BigInt(gathering.request.setupNonce)
  // The manager keeps the hash of the payload the start carried, the request's own.
  const payloadHash = keccak256(gathering.request.payload ?? '0x')

  // A block number that is not a safe integer of zero or more reads as a failed read.
  const blockNumber = async (): Promise<number> => {
    const block = await input.receipts.blockNumber()
    if (!Number.isSafeInteger(block) || block < 0) {
      throw new Error(`The chain answered no usable block number: ${String(block)}`)
    }
    return block
  }

  // An update over a fresh read of the session, read and tried again where another tab moved it.
  const withFreshRevision = async <T>(
    update: (revision: SessionRevision) => Promise<T>,
    tries = 0
  ): Promise<T> => {
    const read = await session.read()
    if (read.status !== 'present') {
      throw new Error(`No recovery session for ${account}`)
    }
    try {
      return await update(read.revision)
    } catch (error: unknown) {
      if (!isSessionRevisionConflict(error) || tries >= CONFLICT_RETRIES) {
        throw error
      }
      return withFreshRevision(update, tries + 1)
    }
  }

  /**
   * This request's attempt: waiting under its attempt number, its setup
   * number and the hash of its payload. A rival attempt under the same number
   * carries another payload, so it reads as another attempt.
   */
  const attemptOf = ({ attempt }: RecoveryState): AttemptReading => {
    if (attempt.state !== 'Waiting') {
      return 'none'
    }
    const ours =
      attempt.attemptId === attemptId &&
      attempt.setupNonce === setupNonce &&
      attempt.payloadHash.toLowerCase() === payloadHash.toLowerCase()
    return ours ? 'ours' : 'other'
  }

  const receiptsFrom = (startBlock: number) => ({
    blockNumber: () => Promise.resolve(startBlock),
    wait: (transactionHash: Hex, from: number) => input.receipts.wait(transactionHash, from)
  })

  return {
    readSession: () => session.read(),
    attemptRead: () => client.recovery.recoveryState(),
    attemptOf,
    async prepare() {
      const now = Math.floor(input.now() / 1000)
      // The client picks the smallest set of approvals that satisfies the rule.
      const request = client.recovery.complete(gathering, undefined, now)
      if (!('payload' in request)) {
        throw new Error('The gathering completed to no start request.')
      }
      const prepared = await client.recovery.prepareStartAttempt(request, now)
      assertWriteDoor('submission', prepared)
      return prepared
    },
    checkGas: (prepared) =>
      plan.kind === 'key'
        ? checkGas({
            write: 'submission',
            prepared,
            key: plan.key,
            reads,
            network,
            fastTrack: true
          })
        : checkGas({
            write: 'submission',
            prepared,
            key: plan.key,
            reads,
            network,
            transaction: accountBatchTransactionOf(plan.facts, plan.key, [prepared]),
            operates: walletAccountRefOf(plan.facts)
          }),
    blockNumber,
    newRequestId: newSendRequestId,
    now: input.now,
    claim: (claim) => withFreshRevision((revision) => session.claimSubmission(claim, revision)),
    async markSent(requestId, transactionHash) {
      await withFreshRevision((revision) =>
        session.setSubmissionHash(requestId, transactionHash, revision)
      )
    },
    async release(requestId) {
      await withFreshRevision((revision) => session.releaseSubmission(requestId, revision))
    },
    send: (prepared, dispatch, run, startBlock, requestId) =>
      plan.kind === 'key'
        ? driveSend({
            dispatch,
            run,
            receipts: receiptsFrom(startBlock),
            port: input.port,
            key: plan.key,
            transaction: gasTransactionOf({ prepared, key: plan.key })
          })
        : driveAccountBatch({
            dispatch,
            run,
            receipts: receiptsFrom(startBlock),
            port: input.port,
            account: plan.facts.account.addr as Address,
            calls: [prepared],
            requestId
          }),
    async waitAgain(transactionHash, startBlock, dispatch, run) {
      try {
        const from = startBlock ?? (await blockNumber())
        const receipt = receiptOf(await input.receipts.wait(transactionHash, from))
        // A receipt with no status reads neither way, so the write keeps its hash.
        if (receipt) {
          dispatch({ type: 'receipt', run, receipt })
        }
      } catch (error: unknown) {
        dispatch({ type: 'error', run, error, transactionHash })
      }
    },
    async startedSince(claim) {
      const state = await client.recovery.recoveryState()
      if (attemptOf(state) === 'ours') {
        return true
      }
      const to = state.block.number
      if (to < claim.startBlock) {
        throw new Error(`The node reads block ${to}, before the claim's block ${claim.startBlock}.`)
      }
      const { events } = client.recovery
      const notifications = await events.fetch(events.accountFilter(), {
        from: claim.startBlock,
        to
      })
      return notifications.some(
        (notification) =>
          notification.kind === 'attempt-started' &&
          !notification.at.removed &&
          notification.attemptId === attemptId &&
          sameAddress(notification.account, account) &&
          keccak256(notification.payload).toLowerCase() === payloadHash.toLowerCase()
      )
    },
    async land() {
      const read = await session.read()
      if (read.status === 'present' && read.value.state === 'landed') {
        return
      }
      await withFreshRevision((revision) => records.landSubmission(chainId, account, revision))
    }
  }
}
