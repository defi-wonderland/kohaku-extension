/**
 * The cancel's run over the watcher's real poll on a scripted chain, the real
 * write machine, the real send drive and the real stored claim on a storage
 * in memory. Only the edges are fakes: the prepare, the gas check, the send
 * port, the receipt wait and the wallet's reading of a queued request.
 */
import { getAddress } from 'viem'

import type {
  Address,
  Hex,
  PreparedCall,
  CancelledBy
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  ProviderTransactionReceipt,
  SendPort
} from '@web/modules/social-recovery/shared/client'
import type { GasCheck, RequestHold } from '@web/modules/social-recovery/shared/writes'
import { depositStepOf, driveAccountBatch } from '@web/modules/social-recovery/shared/writes'
import { attemptReaderOf, cancelClaimsOf } from '@web/modules/social-recovery/cancel'
import type { CancelSteps } from '@web/modules/social-recovery/cancel'
import {
  ACCOUNT,
  NEW_KEY,
  SEPOLIA,
  cancelledEvent,
  consumedEvent,
  memoryStorage,
  payloadTo,
  scriptedChain,
  startedEvent,
  stateWith
} from '@web/modules/social-recovery/watcher/__fixtures__/harness'

export const ATTEMPT = 4n
export const PAYLOAD = payloadTo(NEW_KEY)
export const KEY: Address = getAddress('0x0000000000000000000000000000000000c0ffee')
export const TX_HASH: Hex = `0x${'ab'.repeat(32)}`
export const OTHER_HASH: Hex = `0x${'cd'.repeat(32)}`
export const START_BLOCK = 7_000_010
export const MANAGER: Address = getAddress('0x00000000000000000000000000000000000a5a5a')

export const CANCEL_CALL: PreparedCall = {
  kind: 'call',
  sender: 'account',
  to: MANAGER,
  data: '0xdeadbeef',
  value: 0n
} as unknown as PreparedCall

const ESTIMATE = { gas: 50_000n, gasPrice: 1n, cost: 50_000n, required: 60_000n }

export const ENOUGH: GasCheck = {
  kind: 'enough',
  write: 'cancel',
  key: KEY,
  estimate: ESTIMATE,
  balance: 1_000_000n
}

export const SHORT: GasCheck = {
  kind: 'deposit',
  step: depositStepOf({
    write: 'cancel',
    key: KEY,
    network: { name: 'Sepolia', nativeAssetSymbol: 'ETH' },
    estimate: ESTIMATE,
    balance: 0n,
    operates: { address: ACCOUNT, name: 'Account 1', deployed: true },
    transferFee: ESTIMATE
  })
}

export const landedReceipt = (hash: Hex = TX_HASH): ProviderTransactionReceipt =>
  ({ hash, status: 1, blockNumber: START_BLOCK + 1 } as unknown as ProviderTransactionReceipt)

/** ethers' error from `wait()` on a transaction the chain mined and reverted. */
export const minedAndReverted = (hash: Hex = TX_HASH): Error =>
  Object.assign(new Error('transaction execution reverted'), {
    code: 'CALL_EXCEPTION',
    receipt: { hash, status: 0, blockNumber: START_BLOCK + 1, gasUsed: 40_000n },
    transaction: { hash }
  })

/** A chain where the account holds a setup and the attempt waits, its opening readable. */
export const openChain = () => {
  const chain = scriptedChain()
  chain.deploy(ACCOUNT)
  chain.setState(ACCOUNT, stateWith({ attemptId: ATTEMPT, state: 'Waiting', payload: PAYLOAD }))
  chain.setEvents(ACCOUNT, ATTEMPT, { started: startedEvent(ATTEMPT, PAYLOAD) })
  return chain
}

export type Chain = ReturnType<typeof openChain>

/** The attempt cancelled on the chain by `by`. */
export const cancelOn = (chain: Chain, by: CancelledBy) => {
  chain.setState(ACCOUNT, stateWith({ attemptId: ATTEMPT, state: 'Cancelled', payload: PAYLOAD }))
  chain.setEvents(ACCOUNT, ATTEMPT, {
    started: startedEvent(ATTEMPT, PAYLOAD),
    cancelled: cancelledEvent(ATTEMPT, by)
  })
}

/** The attempt executed on the chain, handing the account to `NEW_KEY`. */
export const executeOn = (chain: Chain) => {
  chain.setState(ACCOUNT, stateWith({ attemptId: ATTEMPT, state: 'Consumed', payload: PAYLOAD }))
  chain.setEvents(ACCOUNT, ATTEMPT, {
    started: startedEvent(ATTEMPT, PAYLOAD),
    consumed: consumedEvent(ATTEMPT)
  })
}

export interface RunWorld {
  chain: Chain
  storage: ReturnType<typeof memoryStorage>
  steps: CancelSteps
  port: SendPort & { sendAccountBatch: jest.Mock }
  wait: jest.Mock
  checkGas: jest.Mock
  requestHold: jest.Mock
}

/**
 * The run's steps over one world. By default the gas check reads enough, the
 * send answers `TX_HASH`, and the receipt lands with the owner's cancel on
 * the chain.
 */
export const runWorld = (chain: Chain = openChain()): RunWorld => {
  const storage = memoryStorage()
  let requests = 0
  const port = {
    send: jest.fn(),
    sendAccountBatch: jest.fn(async () => TX_HASH)
  } as unknown as SendPort & { sendAccountBatch: jest.Mock }
  const wait = jest.fn<Promise<ProviderTransactionReceipt>, [Hex, number]>(async (hash) => {
    cancelOn(chain, 'cancelByOwner')
    return landedReceipt(hash)
  })
  const checkGas = jest.fn(async () => ENOUGH)
  const requestHold = jest.fn(async (): Promise<RequestHold> => ({ status: 'held' }))
  const steps: CancelSteps = {
    readAttempt: attemptReaderOf({
      reads: chain.reads,
      account: ACCOUNT,
      chainId: SEPOLIA,
      storage,
      limitMs: 5_000
    }),
    prepare: async () => CANCEL_CALL,
    checkGas,
    newRequestId: () => {
      requests += 1
      return `request-${requests}`
    },
    blockNumber: async () => START_BLOCK,
    claims: cancelClaimsOf(storage, SEPOLIA, ACCOUNT),
    send: (input) =>
      driveAccountBatch({
        dispatch: input.dispatch,
        run: input.run,
        receipts: {
          blockNumber: () => Promise.resolve(input.startBlock),
          wait: (hash, from) => wait(hash, from)
        },
        port,
        account: ACCOUNT,
        calls: [input.prepared],
        requestId: input.requestId,
        canAdd: input.canAdd
      }),
    wait: (hash, from) => wait(hash, from),
    requestHold
  }
  return { chain, storage, steps, port, wait, checkGas, requestHold }
}

export { ACCOUNT, NEW_KEY, SEPOLIA }
