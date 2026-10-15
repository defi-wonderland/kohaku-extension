/**
 * The cancel's steps over the wallet's own seams: the owner's cancel prepared
 * through the client as one call the account sends, the shared gas check of
 * that call as the account's own operation from its key, the send through the
 * request queue, the receipt wait, the wallet's reading of a queued request,
 * and the cancel in flight stored on this device.
 */
import {
  accountBatchTransactionOf,
  newSendRequestId
} from '@web/modules/social-recovery/shared/client'
import {
  assertWriteDoor,
  checkGas,
  driveAccountBatch,
  requestHoldOf,
  walletAccountRefOf
} from '@web/modules/social-recovery/shared/writes'

import { cancelClaimsOf } from './claim'
import type { CancelSteps, CancelStepsInput } from './types'

export const cancelStepsOf = (input: CancelStepsInput): CancelSteps => {
  const { account, chainId, client, facts, key, receipts, port } = input
  return {
    readAttempt: input.readAttempt,
    async prepare() {
      const prepared = await client.recovery.prepareCancelByOwner()
      assertWriteDoor('cancel', prepared)
      return prepared
    },
    checkGas: (prepared) =>
      checkGas({
        write: 'cancel',
        prepared,
        key,
        reads: input.chainReads,
        network: facts.network,
        transaction: accountBatchTransactionOf(facts, key, [prepared]),
        operates: walletAccountRefOf(facts)
      }),
    newRequestId: newSendRequestId,
    blockNumber: () => receipts.blockNumber(),
    claims: cancelClaimsOf(input.storage, chainId, account),
    send: ({ prepared, dispatch, run, requestId, startBlock, canAdd }) =>
      driveAccountBatch({
        dispatch,
        run,
        // The drive starts from the block the run already holds, so it reads
        // nothing from the network before it hands the request to the wallet.
        receipts: {
          blockNumber: () => Promise.resolve(startBlock),
          wait: (transactionHash, from) => receipts.wait(transactionHash, from)
        },
        port,
        account,
        calls: [prepared],
        requestId,
        canAdd
      }),
    wait: (transactionHash, startBlock) => receipts.wait(transactionHash, startBlock),
    requestHold: (requestId) => requestHoldOf(input.requests, requestId, account, chainId)
  }
}
