/**
 * The receipt wait: a transaction the wallet broadcast, waited for over the
 * extension's own provider with ethers' own wait.
 *
 * The wait runs on ethers' transaction response, whose `wait()` answers the
 * receipt, throws `CALL_EXCEPTION` with the receipt for a transaction that
 * reverted, and throws `TRANSACTION_REPLACED` for one that another
 * transaction with the same nonce took the place of. ethers scans for that
 * replacement only from a block it is given, so the wait gives it the block
 * the wait starts at. Where the node does not know the transaction yet, the
 * wait falls back to the provider's `waitForTransaction`, which answers the
 * receipt, a reverted one included, but sees no replacement. Every error
 * comes through as ethers threw it.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'

import type { ReceiptProvider, ReceiptWait } from './types'

export const createReceiptWait =
  (provider: ReceiptProvider): ReceiptWait =>
  async (transactionHash: Hex) => {
    const [response, startBlock] = await Promise.all([
      provider.getTransaction(transactionHash),
      provider.getBlockNumber()
    ])
    const receipt = response
      ? await response.replaceableTransaction(startBlock).wait()
      : await provider.waitForTransaction(transactionHash)
    // ethers answers no receipt only for a wait of zero confirmations.
    if (!receipt) throw new Error(`No receipt came back for ${transactionHash}.`)
    return receipt
  }
