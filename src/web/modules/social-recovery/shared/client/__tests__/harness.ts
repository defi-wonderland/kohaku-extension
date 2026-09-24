/**
 * The tester's one seam onto the client lane of PT-038 (brief
 * docs/social-recovery/briefs/PT-038.md "Test expectations"). Every test file
 * reaches the lane's exports and the mocks through this file, so a rename in the
 * lane changes this file alone.
 *
 * Mocks, and why:
 * - The extension's own provider is mocked as an `ethers`-shaped object of
 *   `jest.fn` members whose JSON-RPC `send` answers from a `ScriptedChain` of
 *   PT-035. The lane reaches that provider through `send` alone
 *   (`ExtensionRpc`); the high-level members are there so a test proves the
 *   lane did not use them. No test reaches a network.
 * - The background is a fake sign-message flow behind the lane's own
 *   `SignMessageFlowPort`: a `jest.fn` dispatch that pushes the
 *   `SignMessageController` states the real background would push, and the
 *   accounts the wallet lists. No keystore and no background runs.
 * - The stand-in's scripted chain (`sdkStandIn.chainFor`) is reset before each
 *   world, so one test's domain script never leaks into the next.
 */
import { AbiCoder, id, toBeHex } from 'ethers'

import {
  addressOf,
  PolicyManagerDouble,
  ProviderDouble,
  RecoveryActionDouble,
  RecoveryClientDouble,
  RecoveryKitBuilderDouble,
  ScriptedChain,
  SetupClientDouble
} from '@web/modules/social-recovery/sdk-doubles'
import type {
  Address,
  BlockTag,
  ClientConfiguration,
  DeploymentDescriptor,
  Hex,
  IProvider
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  addressBookOf,
  createProviderAdapter,
  createSignerFacade,
  descriptorOf,
  sdkStandIn,
  WALLET_RECOVERY_CHAIN,
  type KeyHandle,
  type ListedAccount,
  type RecoveryClientConfiguration,
  type SignerFacade,
  type SignMessageFlowAction,
  type SignMessageFlowPort,
  type SignMessageFlowState
} from '@web/modules/social-recovery/shared/client'

export * from '@web/modules/social-recovery/shared/client'

export const SEPOLIA = 11155111
export const MAINNET = 1

/** The members of `ClientConfiguration` (sdk-interfaces/builder.ts, sdk.md D-208). */
export const CLIENT_CONFIGURATION_KEYS: (keyof ClientConfiguration)[] = [
  'tokens',
  'candidateKeys',
  'creation',
  'accountImplementation',
  'blockTags',
  'logChunkWidth',
  'simulate',
  'defaultWait',
  'shortWaitBelow',
  'maximumWait',
  'requestWindow',
  'cancelWindow',
  'ruleCostBound'
]

/** The thirteen fields of the deployment descriptor (sdk.md D-208). */
export const DESCRIPTOR_FIELDS: (keyof DeploymentDescriptor)[] = [
  'chainId',
  'manager',
  'methodEcdsa',
  'methodPasskey',
  'methodAadhaar',
  'methodZkpassport',
  'action',
  'servedImplementation',
  'deployedAt',
  'digestVersion',
  'managerVersion',
  'shippedMethods',
  'auditedActions'
]

/** Whether a member name hands a signer, a key or storage to the SDK side. */
export const namesSignerOrStorage = (name: string): boolean =>
  /signer|storage|keystore|seed|privatekey|mnemonic/i.test(name) || /^sign([A-Z]|$)/.test(name)

// ---------------------------------------------------------------------------
// The extension's own provider, mocked over a scripted chain
// ---------------------------------------------------------------------------

const SELECTOR = {
  eip712Domain: id('eip712Domain()').slice(0, 10),
  name: id('name()').slice(0, 10),
  version: id('version()').slice(0, 10)
}

const coder = AbiCoder.defaultAbiCoder()

/** What the manager's `eip712Domain()` answers, ABI-encoded from the chain's scripted domain. */
export const encodedDomain = (chain: ScriptedChain): Hex => {
  const d = chain.manager.domain
  return coder.encode(
    ['bytes1', 'string', 'string', 'uint256', 'address', 'bytes32', 'uint256[]'],
    [d.fields, d.name, d.version, d.chainId, d.verifyingContract, d.salt, d.extensions]
  ) as Hex
}

const tagOf = (tag: unknown): BlockTag =>
  typeof tag === 'string' && tag.startsWith('0x') ? Number(tag) : (tag as BlockTag)

/** The balance, estimate and price the mock node answers. */
export const NODE_ANSWERS = { balance: 10n ** 18n, gas: 21_000n, gasPrice: 7n * 10n ** 9n }

export interface EthersMock {
  getNetwork: jest.Mock
  call: jest.Mock
  getLogs: jest.Mock
  getBlock: jest.Mock
  getBalance: jest.Mock
  estimateGas: jest.Mock
  send: jest.Mock
  destroy: jest.Mock
  /** The chain id this provider answers; defaults to the chain's descriptor. */
  answeredChainId: number
}

const READ_MEMBERS = [
  'getNetwork',
  'call',
  'getLogs',
  'getBlock',
  'getBalance',
  'estimateGas',
  'send'
] as const

/** The underlying reads the lane made on the mock, in order, as `[member, args]`. */
export const underlyingCalls = (mock: EthersMock): [string, unknown[]][] =>
  READ_MEMBERS.flatMap((member) =>
    mock[member].mock.calls.map((args) => [member, args] as [string, unknown[]])
  )

/** An ethers-shaped provider whose reads answer from `chain`. */
export const ethersOver = (chain: ScriptedChain): EthersMock => {
  const mock = {} as EthersMock
  mock.answeredChainId = chain.descriptor.chainId
  const ethCall = (tx: { to?: string; data?: string }): Hex => {
    const to = (tx.to ?? '').toLowerCase()
    const data = (tx.data ?? '').toLowerCase()
    if (to === chain.descriptor.manager.toLowerCase()) {
      if (data.startsWith(SELECTOR.eip712Domain)) return encodedDomain(chain)
      if (data.startsWith(SELECTOR.name)) {
        return coder.encode(['string'], [chain.manager.name]) as Hex
      }
      if (data.startsWith(SELECTOR.version)) {
        return coder.encode(['string'], [chain.manager.version]) as Hex
      }
    }
    const scripted = chain.calls.get(`${to}:${data}`)
    if (scripted && 'result' in scripted) return scripted.result
    return '0x'
  }
  const blockOf = (tag: unknown) => {
    const b = chain.blockAt(tagOf(tag))
    return { number: b.number, timestamp: b.timestamp, hash: b.hash }
  }
  mock.getNetwork = jest.fn(async () => ({ chainId: BigInt(mock.answeredChainId), name: 'mock' }))
  mock.call = jest.fn(async (tx: { to?: string; data?: string }) => ethCall(tx))
  mock.getLogs = jest.fn(async () => [])
  mock.getBlock = jest.fn(async (tag: unknown) => blockOf(tag))
  mock.getBalance = jest.fn(async () => NODE_ANSWERS.balance)
  mock.estimateGas = jest.fn(async () => NODE_ANSWERS.gas)
  mock.destroy = jest.fn()
  mock.send = jest.fn(async (method: string, params: unknown[]) => {
    switch (method) {
      case 'eth_chainId':
        return toBeHex(mock.answeredChainId)
      case 'eth_call':
        return ethCall(params[0] as { to?: string; data?: string })
      case 'eth_getLogs':
        return []
      case 'eth_getBlockByNumber': {
        const b = blockOf(params[0])
        return { number: toBeHex(b.number), timestamp: toBeHex(b.timestamp), hash: b.hash }
      }
      case 'eth_getBalance':
        return toBeHex(NODE_ANSWERS.balance)
      case 'eth_estimateGas':
        return toBeHex(NODE_ANSWERS.gas)
      case 'eth_gasPrice':
        return toBeHex(NODE_ANSWERS.gasPrice)
      default:
        throw new Error(`The ethers mock does not answer ${method}.`)
    }
  })
  return mock
}

/** Every underlying member rejects with `error`, whichever route the lane takes. */
export const failEverything = (mock: EthersMock, error: unknown): void => {
  READ_MEMBERS.forEach((m) =>
    mock[m].mockImplementation(async () => {
      throw error
    })
  )
}

/** An ethers v6 call exception carrying the raw revert data. */
export const callException = (data: Hex): Error & { code: string; data: Hex } => {
  const error = new Error('execution reverted') as Error & { code: string; data: Hex }
  error.code = 'CALL_EXCEPTION'
  error.data = data
  return error
}

/** The node's own JSON-RPC revert error, as a provider that bypasses ethers throws it. */
export const nodeRevert = (data: Hex) => ({ code: 3, message: 'execution reverted', data })

/** The adapter over a mocked extension provider. */
export const adapterOver = (ethers: EthersMock): IProvider => createProviderAdapter(ethers)

// ---------------------------------------------------------------------------
// Spies on the doubles
// ---------------------------------------------------------------------------

const PREPARE = /^prepare|^armingCall$|^disarmingCall$/

const prepareMembersOf = (proto: object): string[] =>
  Object.getOwnPropertyNames(proto).filter((n) => PREPARE.test(n))

/** Spies on every prepare member of every double the client could reach. */
export const spyOnPrepares = (): jest.SpyInstance[] =>
  [
    RecoveryClientDouble.prototype,
    SetupClientDouble.prototype,
    PolicyManagerDouble.prototype,
    RecoveryActionDouble.prototype
  ].flatMap((proto) =>
    prepareMembersOf(proto).map((name) =>
      jest.spyOn(proto as unknown as Record<string, () => unknown>, name)
    )
  )

export interface BuilderSpies {
  provider: jest.SpyInstance
  descriptor: jest.SpyInstance
  account: jest.SpyInstance
  action: jest.SpyInstance
  config: jest.SpyInstance
  policyManager: jest.SpyInstance
  eventManager: jest.SpyInstance
  method: jest.SpyInstance
  codec: jest.SpyInstance
  buildSetupClient: jest.SpyInstance
  buildRecoveryClient: jest.SpyInstance
  recoveryAction: jest.SpyInstance
  methodModuleReads: jest.SpyInstance
}

export const spyOnBuilder = (): BuilderSpies => {
  const proto = RecoveryKitBuilderDouble.prototype
  return {
    provider: jest.spyOn(proto, 'provider'),
    descriptor: jest.spyOn(proto, 'descriptor'),
    account: jest.spyOn(proto, 'account'),
    action: jest.spyOn(proto, 'action'),
    config: jest.spyOn(proto, 'config'),
    policyManager: jest.spyOn(proto, 'policyManager'),
    eventManager: jest.spyOn(proto, 'eventManager'),
    method: jest.spyOn(proto, 'method'),
    codec: jest.spyOn(proto, 'codec'),
    buildSetupClient: jest.spyOn(proto, 'buildSetupClient'),
    buildRecoveryClient: jest.spyOn(proto, 'buildRecoveryClient'),
    recoveryAction: jest.spyOn(proto, 'recoveryAction'),
    methodModuleReads: jest.spyOn(proto, 'methodModuleReads')
  }
}

/** The value a setter received last, the one the builder builds with. */
export const lastArg = (spy: jest.SpyInstance, index = 0): unknown => {
  const { calls } = spy.mock
  return calls.length ? calls[calls.length - 1][index] : undefined
}

export const providerDoubleReads = (): jest.SpyInstance[] =>
  (['chainId', 'call', 'logs', 'block'] as const).map((m) =>
    jest.spyOn(ProviderDouble.prototype, m)
  )

/** The prototype chain of a value, itself first, stopping before Object's and Function's. */
const chainOf = (value: object): object[] => {
  const chain: object[] = []
  let proto: object | null = value
  while (proto && proto !== Object.prototype && proto !== Function.prototype) {
    chain.push(proto)
    proto = Object.getPrototypeOf(proto)
  }
  return chain
}

/** Every function-valued member of an object, own and inherited, but not Object's. */
export const functionMembersOf = (value: object): string[] => [
  ...new Set(
    chainOf(value).flatMap((proto) =>
      Object.getOwnPropertyNames(proto).filter((n) => {
        if (n === 'constructor') return false
        const descriptor = Object.getOwnPropertyDescriptor(proto, n)
        return !!descriptor && typeof descriptor.value === 'function'
      })
    )
  )
]

/** Every member name of an object, own and inherited, but not Object's. */
export const memberNamesOf = (value: object): string[] => [
  ...new Set(
    chainOf(value).flatMap((proto) =>
      Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor')
    )
  )
]

/**
 * The keys found under `value` down to `depth`, skipping the objects in `skip`
 * (the extension's own provider, which the adapter may hold).
 */
export const keysUnder = (value: unknown, depth: number, skip: unknown[] = []): string[] => {
  if (depth < 0 || value === null || typeof value !== 'object' || skip.includes(value)) return []
  return memberNamesOf(value as object).flatMap((k) => {
    let child: unknown
    try {
      child = (value as Record<string, unknown>)[k]
    } catch {
      child = undefined
    }
    return [k, ...keysUnder(child, depth - 1, skip)]
  })
}

/** Settles a promise into the value it threw, or undefined where it resolved. */
export const thrownBy = (run: Promise<unknown>): Promise<unknown> =>
  run.then(
    () => undefined,
    (e: unknown) => e
  )

// ---------------------------------------------------------------------------
// The client world
// ---------------------------------------------------------------------------

export interface World {
  /** The stand-in's scripted chain record the client is built against. */
  chain: ScriptedChain
  /** The extension's own provider, mocked. */
  ethers: EthersMock
  /** The adapter over it, the configuration's provider. */
  adapter: IProvider
  /** The lane's configuration for the one chain the wallet reads. */
  config: RecoveryClientConfiguration
  descriptor: DeploymentDescriptor
  account: Address
}

/**
 * A world on the chain this build reads: the lane's own address book and
 * descriptor, the stand-in's scripted chain for them (reset first), the
 * extension provider mocked over it and the adapter the configuration names.
 */
export const createWorld = (overrides: Partial<RecoveryClientConfiguration> = {}): World => {
  sdkStandIn.reset()
  const account = overrides.account ?? addressOf('account')
  const addressBook = overrides.addressBook ?? addressBookOf(WALLET_RECOVERY_CHAIN)
  const chainLabel = overrides.chain ?? WALLET_RECOVERY_CHAIN
  const descriptor = descriptorOf(chainLabel, addressBook)
  const chain = sdkStandIn.chainFor(descriptor, account)
  const ethers = ethersOver(chain)
  const adapter = createProviderAdapter(ethers)
  const config: RecoveryClientConfiguration = {
    chain: chainLabel,
    account,
    addressBook,
    provider: adapter,
    ...overrides
  }
  return { chain, ethers, adapter, config, descriptor, account }
}

// ---------------------------------------------------------------------------
// The signer facade over a fake sign-message flow
// ---------------------------------------------------------------------------

/** A basic account the wallet lists: an EOA whose only associated key is its own address. */
export const basicAccount = (addr: Address): ListedAccount => ({
  addr,
  associatedKeys: [addr],
  creation: null
})

/** A smart account the wallet lists, controlled by `key` (the index plus 100000 of ux.md D-316). */
export const smartAccount = (addr: Address, key: Address): ListedAccount => ({
  addr,
  associatedKeys: [key],
  creation: { factoryAddr: addressOf('factory'), bytecode: '0x00', salt: `0x${'00'.repeat(32)}` }
})

export interface SignFlowWorld {
  signer: SignerFacade
  dispatch: jest.Mock
  /** The accounts the wallet lists; a test may push more. */
  accounts: ListedAccount[]
  /** What the fake background does on `MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE`. */
  outcome: { signature?: string; refuse?: boolean }
}

/**
 * The facade over a fake background: the dispatch pushes the controller
 * states the real `SignMessageController` would push. On init, the message
 * with `isInitialized`; on the handle, the signed message for that request
 * (or the sign status `ERROR` where the outcome refuses).
 */
export const signFlowOver = (
  accounts: ListedAccount[] = [],
  outcome: SignFlowWorld['outcome'] = {}
): SignFlowWorld => {
  const listeners = new Set<(state: SignMessageFlowState) => void>()
  let current: SignMessageFlowState = {}
  const push = (state: SignMessageFlowState) => {
    current = state
    listeners.forEach((l) => l(state))
  }
  const world = { accounts, outcome } as SignFlowWorld
  world.dispatch = jest.fn((action: SignMessageFlowAction) => {
    // The background answers after the dispatch returns, as the real one does.
    queueMicrotask(() => {
      if (action.type === 'MAIN_CONTROLLER_SIGN_MESSAGE_INIT') {
        push({ isInitialized: true, messageToSign: action.params.messageToSign, statuses: {} })
      } else if (action.type === 'MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE') {
        const message = current.messageToSign
        if (world.outcome.refuse) {
          push({ ...current, statuses: { sign: 'ERROR' } })
        } else {
          push({
            ...current,
            statuses: { sign: 'SUCCESS' },
            signedMessage: {
              ...(message as object),
              signature: world.outcome.signature ?? null
            } as SignMessageFlowState['signedMessage']
          })
        }
      } else if (action.type === 'MAIN_CONTROLLER_SIGN_MESSAGE_RESET') {
        push({})
      }
    })
  })
  const port: SignMessageFlowPort = {
    dispatch: world.dispatch,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    accounts: () => world.accounts
  }
  world.signer = createSignerFacade(port, { chainId: SEPOLIA, timeoutMs: 2000 })
  return world
}

/** Every action the dispatch received, in order. */
export const dispatched = (dispatch: jest.Mock): SignMessageFlowAction[] =>
  dispatch.mock.calls.map((c) => c[0] as SignMessageFlowAction)

export type { KeyHandle }

// Jest runs every file under __tests__, this one included; its own check runs
// only when Jest runs this file, never from a file that imports the harness.
if (expect.getState().testPath === __filename) {
  describe('harness', () => {
    it('answers the manager domain ABI-encoded from the scripted chain', async () => {
      const chain = new ScriptedChain()
      const ethers = ethersOver(chain)
      const answer = await ethers.call({
        to: chain.descriptor.manager,
        data: SELECTOR.eip712Domain
      })
      const decoded = coder.decode(
        ['bytes1', 'string', 'string', 'uint256', 'address', 'bytes32', 'uint256[]'],
        answer
      )
      expect(decoded[2]).toBe(chain.descriptor.digestVersion)
      expect(Number(decoded[3])).toBe(chain.descriptor.chainId)
    })

    it('builds a world whose scripted chain carries the lane descriptor', () => {
      const world = createWorld()
      expect(world.chain.descriptor).toEqual(world.descriptor)
      expect(world.chain).toBe(sdkStandIn.chainFor(world.descriptor, world.account))
    })
  })
}
