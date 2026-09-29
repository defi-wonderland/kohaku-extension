/**
 * The receipt wait: a transaction the wallet broadcast, waited for over the
 * extension's own provider with ethers' own wait.
 *
 * The wait runs on ethers' transaction response, whose `wait()` answers the
 * receipt, throws `CALL_EXCEPTION` with the receipt for a transaction that
 * reverted, and throws `TRANSACTION_REPLACED` for one that another
 * transaction with the same nonce took the place of. ethers scans for that
 * replacement only from the block it is given, so the caller reads the block
 * before the send, as ethers' own signer does before it broadcasts. Where the
 * node does not know the transaction yet, the wait asks again at each new
 * block. Every error comes through as ethers threw it.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'

import type { ProviderTransaction, ReceiptProvider, ReceiptWait } from './types'

/**
 * How long the wait asks for a transaction the node does not know before it
 * gives up: the time after which the wallet's own activity calls a broadcast
 * with no transaction and no receipt stuck.
 */
export const UNKNOWN_TRANSACTION_MS = 15 * 60 * 1000

/** The transaction once the node knows it, asked again at each new block. */
const knownTransaction = (provider: ReceiptProvider, hash: Hex): Promise<ProviderTransaction> =>
  new Promise<ProviderTransaction>((resolve, reject) => {
    const started = Date.now()
    const ask = async (): Promise<void> => {
      try {
        const transaction = await provider.getTransaction(hash)
        if (transaction) {
          resolve(transaction)
        } else if (Date.now() - started >= UNKNOWN_TRANSACTION_MS) {
          reject(new Error(`The node does not know transaction ${hash}.`))
        } else {
          await provider.once('block', ask)
        }
      } catch (thrown) {
        reject(thrown)
      }
    }
    ask().catch(reject)
  })

export const createReceiptWait = (provider: ReceiptProvider): ReceiptWait => ({
  blockNumber: () => provider.getBlockNumber(),

  async wait(transactionHash: Hex, startBlock: number) {
    const transaction = await knownTransaction(provider, transactionHash)
    const receipt = await transaction.replaceableTransaction(startBlock).wait()
    // ethers answers no receipt only for a wait of zero confirmations.
    if (!receipt) throw new Error(`No receipt came back for ${transactionHash}.`)
    return receipt
  }
})
