/**
 * The tester's one seam onto the client lane of PT-038 (brief
 * docs/social-recovery/briefs/PT-038.md "Test expectations"). Every test file
 * reaches the lane's exports and the mocks through this file, so a rename in the
 * lane changes this file alone.
 *
 * Mocks, and why:
 * - The extension's own `ethers` provider is a plain object of `jest.fn`
 *   members answering from a `ScriptedChain` of PT-035, so no test reaches a
 *   network and the manager's domain is scriptable per test. `eip712Domain()`,
 *   `name()` and `version()` are answered ABI-encoded, whichever route (the
 *   provider or the manager double) the lane reads the domain through.
 * - The background dispatch is a `jest.fn`; the sign flow's answer is scripted
 *   per test, so no keystore and no background runs.
 */
import { AbiCoder, id, toBeHex } from 'ethers'

import {
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
  Hex
} from '@web/modules/social-recovery/sdk-interfaces'

export {
  AUDITED_ACTIONS,
  auditedActionOf,
  buildRecoveryClient,
  DEPLOYMENTS,
  DigestVersionRefusal,
  ProviderAdapter,
  SignerFacade,
  UNKNOWN_ACTION
} from '@web/modules/social-recovery/shared/client'

// eslint-disable-next-line import/first
import * as lane from '@web/modules/social-recovery/shared/client'

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
// The extension's own ethers provider, mocked over a scripted chain
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

export interface EthersMock {
  getNetwork: jest.Mock
  getChainId?: jest.Mock
  call: jest.Mock
  getLogs: jest.Mock
  getBlock: jest.Mock
  send: jest.Mock
  getBalance: jest.Mock
  estimateGas: jest.Mock
  /** The chain id this provider answers; defaults to the chain's descriptor. */
  answeredChainId: number
}

/** The underlying reads the lane made on the mock, in order, as `[member, args]`. */
export const underlyingCalls = (mock: EthersMock): [string, unknown[]][] =>
  (
    ['getNetwork', 'call', 'getLogs', 'getBlock', 'send', 'getBalance', 'estimateGas'] as const
  ).flatMap((member) =>
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
      if (data.startsWith(SELECTOR.name))
        return coder.encode(['string'], [chain.manager.name]) as Hex
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
  mock.getNetwork = jest.fn(async () => ({
    chainId: BigInt(mock.answeredChainId),
    name: 'mock'
  }))
  mock.call = jest.fn(async (tx: { to?: string; data?: string }) => ethCall(tx))
  mock.getLogs = jest.fn(async () => [])
  mock.getBlock = jest.fn(async (tag: unknown) => blockOf(tag))
  mock.getBalance = jest.fn(async () => 10n ** 18n)
  mock.estimateGas = jest.fn(async () => 21_000n)
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
      default:
        throw new Error(`The ethers mock does not answer ${method}.`)
    }
  })
  return mock
}

/** Every underlying member rejects with `error`, whichever route the lane takes. */
export const failEverything = (mock: EthersMock, error: unknown): void => {
  ;(['getNetwork', 'call', 'getLogs', 'getBlock', 'send'] as const).forEach((m) =>
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
  buildRecoveryClient: jest.SpyInstance
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
    buildRecoveryClient: jest.spyOn(proto, 'buildRecoveryClient')
  }
}

/** The value a setter received last, the one the builder builds with. */
export const lastArg = (spy: jest.SpyInstance, index = 0): unknown => {
  const calls = spy.mock.calls
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

// ---------------------------------------------------------------------------
// The lane, reached through one world per test
// ---------------------------------------------------------------------------

export interface World {
  chain: ScriptedChain
  ethers: EthersMock
  /** The lane's configuration for the one chain the wallet reads. */
  config: lane.RecoveryClientConfig
  descriptor: DeploymentDescriptor
  account: Address
}

/**
 * A world on the test network: a scripted chain seeded with the lane's own
 * Sepolia descriptor, the extension's provider mocked over it, and the lane's
 * configuration naming that chain.
 */
export const createWorld = (overrides: Partial<lane.RecoveryClientConfig> = {}): World => {
  const descriptor = lane.DEPLOYMENTS[SEPOLIA]
  const chain = new ScriptedChain({ descriptor })
  const ethers = ethersOver(chain)
  const config = {
    chainId: SEPOLIA,
    addressBook: descriptor,
    provider: ethers,
    account: chain.account,
    chain,
    ...overrides
  } as unknown as lane.RecoveryClientConfig
  return { chain, ethers, config, descriptor, account: chain.account }
}

/** The adapter over a mocked ethers provider. */
export const adapterOver = (ethers: EthersMock) =>
  new lane.ProviderAdapter(
    ethers as unknown as ConstructorParameters<typeof lane.ProviderAdapter>[0]
  )

// ---------------------------------------------------------------------------
// The signer facade over a mocked background dispatch
// ---------------------------------------------------------------------------

export interface SignerWorld {
  signer: lane.SignerFacade
  dispatch: jest.Mock
  /** Scripts the signature the sign flow returns. */
  answer: (signature: Hex) => void
}

export const signerOver = (): SignerWorld => {
  let signature: Hex = '0x'
  const dispatch = jest.fn(async () => ({ signature }))
  const signer = new lane.SignerFacade(dispatch as never)
  return {
    signer,
    dispatch,
    answer: (s) => {
      signature = s
    }
  }
}

/** Every action the dispatch received, flattened to its params. */
export const dispatched = (dispatch: jest.Mock): { type: string; params?: any }[] =>
  dispatch.mock.calls.map((c) => c[0] as { type: string; params?: any })

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
      chain.manager.domain.version = '2'
      const again = await ethers.call({ to: chain.descriptor.manager, data: SELECTOR.eip712Domain })
      expect(coder.decode(['bytes1', 'string', 'string'], again)[2]).toBe('2')
    })
  })
}
