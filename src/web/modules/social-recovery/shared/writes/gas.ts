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
 * shows. The transfer is itself an operation that key sends and pays for
 * (D-319, D-393), so its amount carries the transfer's own fee, estimated
 * through the same provider: after the transfer lands, the check run again
 * answers enough. On the fast track the key operates no account yet, so the
 * step offers the deposit from outside alone (D-393: on the logged-in route
 * the step offers both routes). The first release configures no sponsor, and
 * the step links to no service that hands out test-network funds (D-312, the
 * owner's ruling of 2026-09-22).
 */
import { Interface } from 'ethers'

import { AMBIRE_ACCOUNT_FACTORY } from '@ambire-common/consts/deploy'
import type {
  Address,
  Hex,
  PreparedBatch,
  PreparedCall
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  ChainReads,
  gasCallOf,
  GasEstimateCall,
  isRevertedCall,
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

/**
 * The factory the account library deploys a Kohaku account through (contracts
 * D-102, ambire-common `AMBIRE_ACCOUNT_FACTORY`). A save for an account with no
 * code yet goes to it, the deployment prepended to the batch (D-319).
 */
export const ACCOUNT_FACTORY = AMBIRE_ACCOUNT_FACTORY as Address

/**
 * The gas a call that carries value to an address with no code, no nonce and
 * no balance costs beyond the same call with no value: the EVM's value-call
 * cost (9000) and its new-account cost (25000). The transfer route's estimate
 * adds it, since that estimate runs with no value (below).
 */
export const VALUE_TRANSFER_GAS = 9000n + 25000n

/** The network the key must be funded on. An extension `Network` record satisfies it. */
export interface GasNetwork {
  name: string
  nativeAssetSymbol: string
}

/**
 * An account this wallet holds, by its address and the name the wallet gives
 * it. `deployed` is false where the account has no code yet (the wallet's own
 * account state knows), so its transfer must deploy it through the account
 * factory first.
 */
export interface WalletAccountRef {
  address: Address
  name: string
  deployed?: boolean
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
 * One route that fills the key. `amount` is rounded up to the precision the
 * step renders, so a holder who sends what the step shows covers it.
 *
 * - `transfer`: from an account this wallet holds, the account the key
 *   operates, to the key. It is itself an operation that key must send and pay
 *   for, so a key at zero cannot take it alone, and its amount is the
 *   shortfall plus the transfer's own fee (`fee`) with the headroom.
 * - `outside`: a deposit from outside this wallet into the key's address, the
 *   shortfall.
 */
export type DepositRoute =
  | { kind: 'transfer'; from: WalletAccountRef; to: Address; amount: bigint; fee: GasEstimate }
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
   * library builds it from the prepared write, to the account the key operates
   * (`operates`), or to `ACCOUNT_FACTORY` where it deploys an account with no
   * code yet (D-319); `gasCallOf` refuses those calls. A call anyone may send
   * is estimated as it stands, so this is ignored for one.
   */
  transaction?: GasEstimateCall
  /**
   * The account this wallet holds that the key operates, the source of the
   * transfer route. Every step but the fast track's needs it.
   */
  operates?: WalletAccountRef
  /**
   * The transaction the key sends for the transfer route, built through the
   * account library, carrying its one call to the key with no value (the check
   * adds what the value costs). By default the account's own `executeBySender`
   * (`transferTransactionOf`), which holds only for an account with code. For
   * an account with no code yet (`operates.deployed` false, or a write whose
   * own transaction deploys it through `ACCOUNT_FACTORY`), the check takes no
   * default: pass the factory's deploy-and-transfer transaction, or the step
   * offers the deposit from outside alone.
   */
  transferTransaction?: GasEstimateCall
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
 * account library built for it. That one must come from the key and go to the
 * account the key operates, or to `ACCOUNT_FACTORY` where it deploys the
 * account (D-319), so the check never estimates a transaction of another
 * account. Throws a TypeError where it is missing or fails either tie.
 */
export const gasTransactionOf = (
  input: Pick<GasCheckInput, 'prepared' | 'key' | 'transaction' | 'operates'>
): GasEstimateCall => {
  const { prepared, key, transaction, operates } = input
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
  if (!operates) {
    throw new TypeError(
      'A write the account sends is estimated against the account the key operates: pass that account.'
    )
  }
  if (
    !sameAddress(transaction.to, operates.address) &&
    !sameAddress(transaction.to, ACCOUNT_FACTORY)
  ) {
    throw new TypeError(
      `The transaction to estimate goes to ${transaction.to}, not to the account ${operates.address} the key operates or the account factory.`
    )
  }
  return { ...transaction }
}

// The account's own batch its privileged key sends with no signature
// (contracts.md: `executeBySender` runs a batch for the address holding the
// entry). The transfer route is that operation with one call to the key.
const ACCOUNT_OPERATIONS = new Interface([
  'function executeBySender((address to, uint256 value, bytes data)[] calls) payable'
])

/**
 * The transaction the transfer route's own fee is estimated on: the key sends
 * the account's `executeBySender` with one call to the key. It carries no
 * value, so the estimate does not revert where the account holds less than the
 * amount at the time of the check; `VALUE_TRANSFER_GAS` adds what the value
 * costs.
 */
export const transferTransactionOf = (account: Address, key: Address): GasEstimateCall => ({
  from: key,
  to: account,
  data: ACCOUNT_OPERATIONS.encodeFunctionData('executeBySender', [[[key, 0n, '0x']]]) as Hex
})

/**
 * The transaction the transfer route's own fee is estimated on, tied to the
 * key and to the account it drains. An account with code runs the transfer as
 * its own `executeBySender` (`transferTransactionOf`, or the caller's, to the
 * account). An account with no code yet has nothing to call: its transfer
 * deploys it through the factory and runs the call in one transaction, which
 * the account library builds, so the caller passes it (to `ACCOUNT_FACTORY`)
 * and the check never estimates a call to the empty address. Where the caller
 * passed none for such an account, this answers undefined: the check cannot
 * price the transfer, so the step offers the deposit from outside alone.
 * Throws a TypeError where the transaction comes from another address or goes
 * elsewhere.
 */
export const transferEstimateCallOf = (
  input: Pick<GasCheckInput, 'key' | 'operates' | 'transaction' | 'transferTransaction'>
): GasEstimateCall | undefined => {
  const { key, operates, transaction, transferTransaction } = input
  if (!operates) {
    throw new TypeError(
      'The transfer route drains the account the key operates: pass that account.'
    )
  }
  const noCode =
    operates.deployed === false || (!!transaction && sameAddress(transaction.to, ACCOUNT_FACTORY))
  if (!transferTransaction) {
    return noCode ? undefined : transferTransactionOf(operates.address, key.addr)
  }
  if (!sameAddress(transferTransaction.from, key.addr)) {
    throw new TypeError(
      `The transfer to estimate comes from ${transferTransaction.from}, not from the sending key ${key.addr}.`
    )
  }
  const to = noCode ? ACCOUNT_FACTORY : operates.address
  if (!sameAddress(transferTransaction.to, to)) {
    throw new TypeError(
      `The transfer to estimate goes to ${transferTransaction.to}, not to ${to}${
        noCode ? ', the account factory that deploys the account' : ', the account'
      }.`
    )
  }
  return { ...transferTransaction }
}

/** The fee of the transfer route from its estimated gas, with the value's own cost and the headroom. */
export const transferFeeOf = (
  gas: bigint,
  gasPrice: bigint,
  feeHeadroomPercent: number = FEE_HEADROOM_PERCENT
): GasEstimate => gasEstimateOf(gas + VALUE_TRANSFER_GAS, gasPrice, feeHeadroomPercent)

/** Whether a balance covers the step's estimate, so the step skips itself. */
export const holdsEnough = (estimate: GasEstimate, balance: bigint): boolean =>
  balance >= estimate.required

/**
 * The deposit step from an estimate and a balance that falls short of it.
 * Off the fast track it offers the transfer from the account the key operates,
 * whose amount is the shortfall plus `transferFee`, the transfer's own fee
 * (`transferFeeOf`), and the deposit from outside, the shortfall alone. With
 * no `transferFee` (the transfer's estimate reverted, so the account cannot
 * run it now) the step offers the deposit from outside alone. Throws a
 * TypeError where the balance covers the estimate, since such a key skips the
 * step, and where a step off the fast track has no account the key operates.
 */
export const depositStepOf = (args: {
  write: WriteKind
  key: Address
  network: GasNetwork
  estimate: GasEstimate
  balance: bigint
  operates?: WalletAccountRef
  transferFee?: GasEstimate
  fastTrack?: boolean
}): DepositStep => {
  const { write, key, network, estimate, balance, operates, transferFee } = args
  if (holdsEnough(estimate, balance)) {
    throw new TypeError('The key holds enough: the deposit step is skipped.')
  }
  const fastTrack = isRecoveryCall(write) && args.fastTrack === true
  if (!fastTrack && !operates) {
    throw new TypeError(
      'Off the fast track the step offers the transfer from the account the key operates: pass that account.'
    )
  }
  const shortfall = estimate.required - balance
  const outside: DepositRoute = { kind: 'outside', to: key, amount: roundUpForDisplay(shortfall) }
  const routes: DepositRoute[] =
    !fastTrack && operates && transferFee
      ? [
          {
            kind: 'transfer',
            from: { ...operates },
            to: key,
            amount: roundUpForDisplay(shortfall + transferFee.required),
            fee: transferFee
          },
          outside
        ]
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
    ...(!fastTrack && operates ? { operates: { ...operates } } : {})
  }
}

/**
 * The gas check. Checks that the write comes through its door (`assertWriteDoor`)
 * and that the transaction it estimates is this write's (`gasTransactionOf`),
 * then makes three reads through the extension's provider: the estimate of
 * this transaction, the gas price and the key's balance. Answers `enough`
 * where the balance covers the estimate with its headroom. Otherwise, off the
 * fast track, it estimates the transfer route's own transaction through the
 * same provider (`transferEstimateCallOf`) and answers the deposit step.
 *
 * A read that could not run rejects with its `ProviderReadFailure`, which the
 * machine reads as `gasReadError`. An estimate of the write that would revert
 * rejects with its `RevertedCall`, which it reads as a call never sent. An
 * estimate of the transfer that would revert does not fail the check: the
 * account cannot run that transfer now, so the step drops that route and
 * keeps the deposit from outside.
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
  const transferCall = fastTrack ? undefined : transferEstimateCallOf(input)
  const [gas, gasPrice, balance] = await Promise.all([
    input.reads.estimateGas(transaction),
    input.reads.gasPrice(),
    input.reads.nativeBalance(input.key.addr)
  ])
  const estimate = gasEstimateOf(gas, gasPrice, input.feeHeadroomPercent)
  if (holdsEnough(estimate, balance)) {
    return { kind: 'enough', write: input.write, key: input.key.addr, estimate, balance }
  }
  let transferFee: GasEstimate | undefined
  if (transferCall) {
    try {
      transferFee = transferFeeOf(
        await input.reads.estimateGas(transferCall),
        gasPrice,
        input.feeHeadroomPercent
      )
    } catch (thrown) {
      if (!isRevertedCall(thrown)) throw thrown
    }
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
      transferFee,
      fastTrack
    })
  }
}
