/**
 * The execution's steps over the wallet's own seams, in the submission's
 * shape: the execution call the client prepares for the attempt and the
 * payload that started it, the shared gas check on the same sending key, the
 * send through the request queue by route, and the node's read of a hash.
 */
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { accountBatchTransactionOf } from '@web/modules/social-recovery/shared/client'
import {
  assertWriteDoor,
  checkGas,
  driveAccountBatch,
  driveSend,
  gasTransactionOf,
  walletAccountRefOf
} from '@web/modules/social-recovery/shared/writes'

import type { ExecuteSteps, ExecuteStepsInput } from './types'

export const executeStepsOf = (input: ExecuteStepsInput): ExecuteSteps => {
  const { client, plan, network, reads, receipts, port, attempt, payload } = input
  return {
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
    send: (prepared, dispatch, run) =>
      plan.kind === 'key'
        ? driveSend({
            dispatch,
            run,
            receipts,
            port,
            key: plan.key,
            transaction: gasTransactionOf({ prepared, key: plan.key })
          })
        : driveAccountBatch({
            dispatch,
            run,
            receipts,
            port,
            account: plan.facts.account.addr as Address,
            calls: [prepared]
          }),
    transactionKnown: (transactionHash) => receipts.transactionKnown(transactionHash),
    now: input.now
  }
}
