/**
 * The gas check and its deposit step (ux.md D-303, D-319, D-307, D-393,
 * ux-interfaces.md D-373).
 *
 * The check runs before every call a key the wallet holds sends. It estimates
 * that transaction's own gas and reads the gas price and the sending key's
 * balance through the extension's provider (shared/client `createChainReads`),
 * since the SDK estimates nothing and its provider answers no balance, D-373.
 * A key that holds enough skips the step. A key that holds too little gets the
 * deposit step rather than a failed transaction: the key's address, the
 * estimated amount, the network the key must be funded on and the routes that
 * fill it.
 *
 * The routes: a transfer from another account this wallet holds, the account
 * the key operates, and a deposit from outside into the address the step
 * shows. On the fast track the key operates no account yet, so the step offers
 * the deposit from outside alone (D-393: on the logged-in route the step offers
 * both routes). The first release configures no sponsor, and the step links to
 * no service that hands out test-network funds (D-312, the owner's ruling of
 * 2026-09-22).
 */
import type {
  Address,
  PreparedBatch,
  PreparedCall
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  ChainReads,
  gasCallOf,
  GasEstimateCall,
  KeyHandle,
  sameAddress
} from '@web/modules/social-recovery/shared/client'

import { assertWriteDoor, isRecoveryCall, Payer, payerOf, WriteKind } from './kinds'

/** The decimals of a network's native asset; every EVM chain uses 18. */
export const NATIVE_DECIMALS = 18

/**
 * The headroom the check adds to the fee it estimates, in percent. The step
 * asks for at most that amount and the exact amount follows the network fee
 * at sending, so a fee that rises a little between the check and the send
 * does not bring the step back.
 */
export const FEE_HEADROOM_PERCENT = 20

/** The network the key must be funded on. An extension `Network` record satisfies it. */
export interface GasNetwork {
  name: string
  nativeAssetSymbol: string
}

/** An account this wallet holds, by its address and the name the wallet gives it. */
export interface WalletAccountRef {
  address: Address
  name: string
}

/** The estimate of one transaction: its gas, the gas price, their product and the amount asked for. */
export interface GasEstimate {
  /** The gas the transaction would use, as the provider estimated it. */
  gas: bigint
  /** The node's gas price, in wei per gas. */
  gasPrice: bigint
  /** `gas * gasPrice`, in wei. */
  cost: bigint
  /** The cost with the fee headroom, in wei: what the key must hold. */
  required: bigint
}

/** The two routes that fill a key. */
export const DEPOSIT_ROUTES = ['transfer', 'outside'] as const
export type DepositRouteKind = typeof DEPOSIT_ROUTES[number]

/**
 * One route that fills the key. `amount` is the shortfall rounded up to the
 * precision the step renders, so a holder who sends what the step shows covers
 * it.
 *
 * - `transfer`: from an account this wallet holds, the account the key
 *   operates, to the key. It is itself an operation that key must send and pay
 *   for, so a key at zero cannot take it alone.
 * - `outside`: a deposit from outside this wallet into the key's address.
 */
export type DepositRoute =
  | { kind: 'transfer'; from: WalletAccountRef; to: Address; amount: bigint }
  | { kind: 'outside'; to: Address; amount: bigint }

/** The deposit step's data. The copy lives in `renderDepositStep`. */
export interface DepositStep {
  write: WriteKind
  /** The account's controlling key for an owner write, the sending key for a recovery call. */
  payer: Payer
  /** The fast track's step (D-303): a recovery call from the fresh key of a fresh install. */
  fastTrack: boolean
  /** The address of the key that sends the write and pays its gas. */
  key: Address
  /** The network the key must be funded on. */
  network: { name: string; symbol: string }
  estimate: GasEstimate
  /** The key's native balance when the check ran, in wei. */
  balance: bigint
  /** `estimate.required - balance`, in wei, above zero. */
  shortfall: bigint
  /** The routes that fill the key, the transfer first where the step offers it. */
  routes: DepositRoute[]
  /** The account this wallet holds that the key operates, off the fast track. */
  operates?: WalletAccountRef
}

/** What the gas check answers: enough, so the step is skipped, or the deposit step. */
export type GasCheck =
  | { kind: 'enough'; write: WriteKind; key: Address; estimate: GasEstimate; balance: bigint }
  | { kind: 'deposit'; step: DepositStep }

/** What the gas check takes. */
export interface GasCheckInput {
  write: WriteKind
  /** The prepared write, as the SDK returned it. */
  prepared: PreparedCall | PreparedBatch
  /** The key that sends it: `sendingKeyOf(prepared, keys)` of shared/client. */
  key: KeyHandle
  /** The balance and gas reads over the extension's provider: `createChainReads(rpc)`. */
  reads: ChainReads
  network: GasNetwork
  /**
   * The transaction the key sends where the write rides the account's own
   * execute: a call whose sender is the account, or a batch. The account
   * library builds it (the deployment prepended for an account with no code
   * yet, D-319); `gasCallOf` refuses those calls. A call anyone may send is
   * estimated as it stands, so this is ignored for one.
   */
  transaction?: GasEstimateCall
  /**
   * The account this wallet holds that the key operates, the source of the
   * transfer route. Every step but the fast track's needs it.
   */
  operates?: WalletAccountRef
  /** The fast track's step (D-303). Only a recovery call takes it. */
  fastTrack?: boolean
  /** The fee headroom in percent, `FEE_HEADROOM_PERCENT` by default. */
  feeHeadroomPercent?: number
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b

/** The digits after the point the step renders an amount with. */
export const GAS_DISPLAY_DECIMALS = 6

const DISPLAY_UNIT = 10n ** BigInt(NATIVE_DECIMALS - GAS_DISPLAY_DECIMALS)

/** An amount to send, rounded up to the step's precision, so what the step shows covers it. */
export const roundUpForDisplay = (wei: bigint): bigint => ceilDiv(wei, DISPLAY_UNIT) * DISPLAY_UNIT

/** A balance, rounded down to the step's precision, so the step never shows more than the key holds. */
export const roundDownForDisplay = (wei: bigint): bigint => (wei / DISPLAY_UNIT) * DISPLAY_UNIT

/** The estimate of a transaction from its gas and the gas price, with the fee headroom. */
export const gasEstimateOf = (
  gas: bigint,
  gasPrice: bigint,
  feeHeadroomPercent: number = FEE_HEADROOM_PERCENT
): GasEstimate => {
  if (!Number.isInteger(feeHeadroomPercent) || feeHeadroomPercent < 0) {
    throw new RangeError(`The fee headroom is a whole percent from zero: ${feeHeadroomPercent}`)
  }
  const cost = gas * gasPrice
  return { gas, gasPrice, cost, required: ceilDiv(cost * BigInt(100 + feeHeadroomPercent), 100n) }
}

/**
 * The transaction the check estimates: a call anyone may send as it stands,
 * from the key (`gasCallOf`); a write the account sends as the transaction the
 * account library built, which must come from the key. Throws a TypeError
 * where that transaction is missing or comes from another address.
 */
export const gasTransactionOf = (
  input: Pick<GasCheckInput, 'prepared' | 'key' | 'transaction'>
): GasEstimateCall => {
  const { prepared, key, transaction } = input
  if (prepared.kind === 'call' && prepared.sender === 'anyone') {
    return gasCallOf(prepared, key.addr)
  }
  if (!transaction) {
    throw new TypeError(
      "A write the account sends rides the account's own execute: pass the transaction its key sends, built through the account library."
    )
  }
  if (!sameAddress(transaction.from, key.addr)) {
    throw new TypeError(
      `The transaction to estimate comes from ${transaction.from}, not from the sending key ${key.addr}.`
    )
  }
  return { ...transaction }
}

/** Whether a balance covers the step's estimate, so the step skips itself. */
export const holdsEnough = (estimate: GasEstimate, balance: bigint): boolean =>
  balance >= estimate.required

/**
 * The deposit step from an estimate and a balance that falls short of it.
 * Throws a TypeError where the balance covers the estimate, since such a key
 * skips the step, and where a step off the fast track has no account the key
 * operates to offer the transfer from.
 */
export const depositStepOf = (args: {
  write: WriteKind
  key: Address
  network: GasNetwork
  estimate: GasEstimate
  balance: bigint
  operates?: WalletAccountRef
  fastTrack?: boolean
}): DepositStep => {
  const { write, key, network, estimate, balance } = args
  if (holdsEnough(estimate, balance)) {
    throw new TypeError('The key holds enough: the deposit step is skipped.')
  }
  const fastTrack = isRecoveryCall(write) && args.fastTrack === true
  if (!fastTrack && !args.operates) {
    throw new TypeError(
      'Off the fast track the step offers the transfer from the account the key operates: pass that account.'
    )
  }
  const shortfall = estimate.required - balance
  const amount = roundUpForDisplay(shortfall)
  const outside: DepositRoute = { kind: 'outside', to: key, amount }
  const routes: DepositRoute[] =
    !fastTrack && args.operates
      ? [{ kind: 'transfer', from: { ...args.operates }, to: key, amount }, outside]
      : [outside]
  return {
    write,
    payer: payerOf(write),
    fastTrack,
    key,
    network: { name: network.name, symbol: network.nativeAssetSymbol },
    estimate,
    balance,
    shortfall,
    routes,
    ...(!fastTrack && args.operates ? { operates: { ...args.operates } } : {})
  }
}

/**
 * The gas check. Checks that the write comes through its door (`assertWriteDoor`),
 * then makes three reads through the extension's provider: the estimate of this
 * transaction, the gas price and the key's balance. Answers `enough` where the
 * balance covers the estimate with its headroom, and the deposit step
 * otherwise. A read that fails rejects as it failed (a `ProviderReadFailure`,
 * or a `RevertedCall` for an estimate of a call that would revert): the wallet
 * sent nothing, which is the first reading of the failed state.
 */
export const checkGas = async (input: GasCheckInput): Promise<GasCheck> => {
  assertWriteDoor(input.write, input.prepared)
  const fastTrack = isRecoveryCall(input.write) && input.fastTrack === true
  if (!fastTrack && !input.operates) {
    throw new TypeError(
      'Off the fast track the step offers the transfer from the account the key operates: pass that account.'
    )
  }
  const transaction = gasTransactionOf(input)
  const [gas, gasPrice, balance] = await Promise.all([
    input.reads.estimateGas(transaction),
    input.reads.gasPrice(),
    input.reads.nativeBalance(input.key.addr)
  ])
  const estimate = gasEstimateOf(gas, gasPrice, input.feeHeadroomPercent)
  if (holdsEnough(estimate, balance)) {
    return { kind: 'enough', write: input.write, key: input.key.addr, estimate, balance }
  }
  return {
    kind: 'deposit',
    step: depositStepOf({
      write: input.write,
      key: input.key.addr,
      network: input.network,
      estimate,
      balance,
      operates: input.operates,
      fastTrack
    })
  }
}
