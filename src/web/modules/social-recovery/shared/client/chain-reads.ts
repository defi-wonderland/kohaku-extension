/**
 * The extension's own chain reads beside the provider adapter.
 *
 * The SDK's provider answers four reads and no balance, and the SDK estimates
 * nothing (ux-interfaces.md D-373). The extension therefore reads the sending
 * key's native balance and estimates each transaction's gas itself, on the
 * same provider the adapter wraps. The gas step of PT-039 reads these; the
 * SDK never sees them.
 */
import type {
  Address,
  BlockTag,
  Hex,
  PreparedCall
} from '@web/modules/social-recovery/sdk-interfaces'

import {
  blockParam,
  callFailureOf,
  ExtensionRpc,
  providerReadFailure,
  sendRead,
  toQuantity
} from './provider-adapter'

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

const amount = (read: 'nativeBalance' | 'estimateGas' | 'gasPrice', value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw providerReadFailure(read, new Error(`not a quantity: ${JSON.stringify(value)}`))
  }
  return BigInt(value === '0x' ? '0x0' : value)
}

/**
 * The balance and gas reads over the extension's provider. Each makes one
 * request: `eth_getBalance`, `eth_estimateGas` and `eth_gasPrice`. A read the
 * provider could not make rejects with a `ProviderReadFailure`; an estimate of
 * a call that would revert rejects with a `RevertedCall`.
 */
export const createChainReads = (rpc: ExtensionRpc): ChainReads => ({
  async nativeBalance(address: Address, block: BlockTag = 'latest'): Promise<bigint> {
    return amount(
      'nativeBalance',
      await sendRead(rpc, 'nativeBalance', 'eth_getBalance', [address, blockParam(block)])
    )
  },

  async estimateGas(call: GasEstimateCall): Promise<bigint> {
    const transaction = {
      from: call.from,
      to: call.to,
      data: call.data,
      ...(call.value ? { value: toQuantity(call.value) } : {})
    }
    let answer: unknown
    try {
      answer = await rpc.send('eth_estimateGas', [transaction])
    } catch (thrown) {
      throw callFailureOf('estimateGas', thrown)
    }
    return amount('estimateGas', answer)
  },

  async gasPrice(): Promise<bigint> {
    return amount('gasPrice', await sendRead(rpc, 'gasPrice', 'eth_gasPrice', []))
  }
})

/**
 * The transaction a key sends for a prepared call whose sender is anyone (the
 * submission and the execution the recoverer's own key sends, D-373), for its
 * gas estimate. A call whose sender is the account rides the account's own
 * `execute`, which the account library estimates, so this refuses it
 * (sdk.md D-202).
 */
export const gasCallOf = (prepared: PreparedCall, from: Address): GasEstimateCall => {
  if (prepared.sender !== 'anyone') {
    throw new Error(
      'A call the account sends is estimated by the account library, not as a key call.'
    )
  }
  return { from, to: prepared.target, data: prepared.data, value: prepared.value }
}
