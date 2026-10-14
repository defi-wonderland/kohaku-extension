/**
 * One round of the page's chain reads: the account's recovery state and
 * whether the account authorizes the action, read together; then, only where
 * the round would read the request void with the attempt counter past it,
 * the account's attempt-started events, for the request's own submission.
 * The events are read backwards from the block the state was read at, one
 * chunk of blocks after the other, and the scan stops at the first chunk
 * that holds a start of this account and action at or below the request's
 * attempt id, or at the manager's deployment block. Attempt ids only grow,
 * so that chunk is near the newest end. Each of the two reads that throws or
 * does not answer within its limit fails the round, and a scan past its limit
 * reads no further chunk. The clock the round judges by is read before its
 * reads.
 */
import type { ApproverRequest, BlockRange } from '@web/modules/social-recovery/sdk-interfaces'
import { within } from '@web/modules/social-recovery/shared/client'

import { isOwnStart, startedAtOrBelow, submissionInQuestion } from './reading'
import type { ApprovalFacts, ApprovalKitClient } from './types'

/** The chunk of at most `width` blocks that ends at `to` and starts no lower than `floor`. */
const chunkEndingAt = (to: number, floor: number, width: number): BlockRange => ({
  from: Math.max(floor, to - width + 1),
  to
})

export const readApprovalFacts = async (
  kit: ApprovalKitClient,
  request: ApproverRequest | null,
  limitMs: number,
  chunkWidth: number
): Promise<ApprovalFacts | undefined> => {
  const clock = Date.now()
  const read = await within(async () => {
    const [state, authorized] = await Promise.all([
      kit.recovery.recoveryState(),
      kit.action.isAuthorized()
    ])
    const facts: ApprovalFacts = {
      attempt: state.attempt,
      nextAttemptId: state.nextAttemptId,
      setupNonce: state.setupNonce,
      authorized
    }
    return { facts, block: state.block.number }
  }, limitMs)
  if (!read || !request || !submissionInQuestion(request, read.facts, clock)) {
    return read?.facts
  }
  const { events } = kit.recovery
  const filter = events.accountFilter()
  const floor = kit.descriptor.deployedAt
  let abandoned = false
  const scanFrom = async (to: number): Promise<boolean> => {
    if (abandoned || to < floor) {
      return false
    }
    const range = chunkEndingAt(to, floor, chunkWidth)
    const started = (await events.fetch(filter, range)).filter((log) =>
      startedAtOrBelow(request, log)
    )
    if (started.length > 0) {
      return started.some((log) => isOwnStart(request, log))
    }
    return scanFrom(range.from - 1)
  }
  const submitted = await within(() => scanFrom(read.block), limitMs)
  if (submitted === undefined) {
    abandoned = true
    return undefined
  }
  return { ...read.facts, submitted }
}
