/**
 * One round of the page's chain reads: the account's recovery state and
 * whether the account authorizes the action, read together; then, only where
 * the round would read the request void with the attempt counter past it,
 * the account's attempt-started events from the manager's deployment block
 * to the block the state was read at, for the request's own submission. Each
 * of the two reads that throws or does not answer within its limit fails the
 * round. The clock the round judges by is read before its reads.
 */
import type { ApproverRequest } from '@web/modules/social-recovery/sdk-interfaces'
import { within } from '@web/modules/social-recovery/shared/client'

import { isOwnStart, submissionInQuestion } from './reading'
import type { ApprovalFacts, ApprovalKitClient } from './types'

export const readApprovalFacts = async (
  kit: ApprovalKitClient,
  request: ApproverRequest | null,
  limitMs: number
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
  const started = await within(
    () => events.fetch(events.accountFilter(), { from: kit.descriptor.deployedAt, to: read.block }),
    limitMs
  )
  if (!started) {
    return undefined
  }
  return { ...read.facts, submitted: started.some((log) => isOwnStart(request, log)) }
}
