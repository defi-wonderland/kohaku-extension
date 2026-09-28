/**
 * The extension's own chain reads beside the provider adapter.
 *
 * The SDK's provider answers four reads and no balance, and the SDK estimates
 * nothing. The extension therefore reads the sending key's native balance and
 * estimates each transaction's gas itself, on the same provider the adapter
 * wraps. The gas step reads these; the SDK never sees them.
 */
import type { RPCProvider } from '@ambire-common/interfaces/provider'
import type {
  Address,
  BlockTag,
  Hex,
  PreparedCall
} from '@web/modules/social-recovery/sdk-interfaces'

import { attemptRead, callFailureOf, quantityOf } from './provider-adapter'

/** The members of the extension's provider the balance and gas reads use. */
export type ChainReadsProvider = Pick<RPCProvider, 'getBalance' | 'estimateGas' | 'send'>

/** One transaction a key the wallet holds would send, for its gas estimate. */
export interface GasEstimateCall {
  from: Address
  to: Address
  data: Hex
  value?: bigint
}

export interface ChainReads {
  /** The native balance of an address at a block tag (`latest` by default), in wei. */
  nativeBalance(address: Address, block?: BlockTag): Promise<bigint>
  /** The gas one transaction would use. A call that would revert rejects with its revert data. */
  estimateGas(call: GasEstimateCall): Promise<bigint>
  /** The node's gas price, in wei per gas. */
  gasPrice(): Promise<bigint>
}

/**
 * The balance and gas reads over the extension's provider: `getBalance`,
 * `estimateGas` and one `eth_gasPrice` request. A read the provider could not
 * make rejects with a `ProviderReadFailure`; an estimate of a call that would
 * revert rejects with a `RevertedCall`.
 */
export const createChainReads = (provider: ChainReadsProvider): ChainReads => ({
  nativeBalance(address: Address, block: BlockTag = 'latest'): Promise<bigint> {
    return attemptRead('nativeBalance', () => provider.getBalance(address, block))
  },

  async estimateGas(call: GasEstimateCall): Promise<bigint> {
    try {
      return await provider.estimateGas({
        from: call.from,
        to: call.to,
        data: call.data,
        value: call.value
      })
    } catch (thrown) {
      throw callFailureOf('estimateGas', thrown)
    }
  },

  gasPrice(): Promise<bigint> {
    // One raw request: ethers' getFeeData makes three.
    return attemptRead('gasPrice', async () => quantityOf(await provider.send('eth_gasPrice', [])))
  }
})

/**
 * The transaction a key sends for a prepared call whose sender is anyone (the
 * submission and the execution the recoverer's own key sends), for its gas
 * estimate. A call whose sender is the account rides the account's own
 * `execute`, which the account library estimates, so this refuses it.
 */
export const gasCallOf = (prepared: PreparedCall, from: Address): GasEstimateCall => {
  if (prepared.sender !== 'anyone') {
    throw new Error(
      'A call the account sends is estimated by the account library, not as a key call.'
    )
  }
  return { from, to: prepared.target, data: prepared.data, value: prepared.value }
}
