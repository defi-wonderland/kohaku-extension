/**
 * `buildRecoveryClient`: the one recovery kit client the extension builds for
 * an account (ux-interfaces.md D-370), with the digest-version check of
 * ux.md D-319 inside it.
 *
 * The client is built through the SDK's builder (sdk.md D-201, D-208), today
 * PT-035's builder double over the stand-in's scripted chain. The builder
 * receives the provider adapter, the descriptor, the account and the client
 * configuration, and nothing else of the extension: no signer and no storage.
 *
 * Before anything is built, the wallet runs D-208's construction checks 2 to 5
 * in D-208's order. It reads the provider's chain id (check 2), then the domain
 * the manager publishes through `eip712Domain()`: its chain id and verifying
 * contract (check 3) and its `fields` bitmap (check 4) refuse with the
 * builder's own `ConstructionRefusal`, so a provider or a manager on another
 * chain reads as a construction refusal. Only then does it compare the
 * domain's version and name with the digest version this build carries
 * (check 5). That disagreement throws a `DigestVersionRefusal` before any
 * client exists, so no prepare can run; the account step draws it as the
 * update the wallet state (ux.md D-306, D-319). The builder runs the same
 * checks again at construction; its digest-version refusal is surfaced as the
 * same `DigestVersionRefusal`.
 */
import type { ConstructionRefusal } from '@web/modules/social-recovery/sdk-doubles'
import {
  constructionRefusal,
  PolicyManagerDouble,
  RecoveryKitBuilderDouble,
  shippedMethodDoubles,
  WalletReadsDouble
} from '@web/modules/social-recovery/sdk-doubles'
import type {
  Address,
  DeploymentDescriptor,
  Domain,
  IMethodModuleReads,
  IMethodsOrchestrator,
  IRecoveryActionInteractor,
  IRecoveryClient,
  ISetupClient
} from '@web/modules/social-recovery/sdk-interfaces'

import { sameAddress } from './addresses'
import type { RecoveryChain } from './chains'
import { clientConfigurationOf, RecoveryClientConfiguration } from './configuration'
import { descriptorOf } from './descriptors'
import { sdkStandIn } from './stand-in'
import type { WalletReads } from './wallet-reads'

/** The name every kit manager's domain carries (sdk.md D-208 check 5, contracts D-103). */
export const MANAGER_DOMAIN_NAME = 'PolicyManager'

/** The `fields` bitmap of the four members the SDK derives under: name, version, chain id, verifying contract (D-208 check 4). */
export const MANAGER_DOMAIN_FIELDS = '0x0f'

/**
 * What the extension holds for one account: the two entry clients, the two
 * narrow seams the builder hands out, the approving side, and the wallet's
 * own reads. The builder constructed every part once, so all of them read the
 * same manager, action and events (sdk.md D-201).
 */
export interface RecoveryKitClient {
  chain: RecoveryChain
  account: Address
  descriptor: DeploymentDescriptor
  setup: ISetupClient
  recovery: IRecoveryClient
  /** `IRecoveryActionInteractor` alone; the arming seam stays inside the setup client. */
  action: IRecoveryActionInteractor
  /** `IMethodModuleReads` alone; the manager part is never handed out whole. */
  moduleReads: IMethodModuleReads
  /** The approving side of D-206, over the builder's method registry; it reads no chain. */
  approving: IMethodsOrchestrator
  /** The cut-q-22 reads (wallet-reads.ts). */
  walletReads: WalletReads
}

/** The domain name and version a build carries or a manager publishes. */
export interface DomainVersion {
  name: string
  version: string
}

/**
 * The refusal of a client built against another deployment's digest version.
 * `state` is the account step's state for it, drawn by a screen from en.json.
 */
export interface DigestVersionRefusal extends Error {
  name: 'DigestVersionRefusal'
  state: 'update-the-wallet'
  /** What this build derives under. */
  carried: DomainVersion
  /** What the manager publishes, where this lane read it. */
  published?: DomainVersion
}

export const digestVersionRefusal = (
  carried: DomainVersion,
  published?: DomainVersion
): DigestVersionRefusal => {
  const error = new Error(
    published
      ? `The manager publishes digest version ${published.name} ${published.version}; this build carries ${carried.name} ${carried.version}.`
      : `The manager's digest version is not ${carried.name} ${carried.version}, the one this build carries.`
  ) as DigestVersionRefusal
  error.name = 'DigestVersionRefusal'
  error.state = 'update-the-wallet'
  error.carried = carried
  if (published) error.published = published
  return error
}

export const isDigestVersionRefusal = (value: unknown): value is DigestVersionRefusal =>
  value instanceof Error && value.name === 'DigestVersionRefusal'

/** The domain name and version this build derives under for a descriptor. */
export const carriedDomainVersion = (descriptor: DeploymentDescriptor): DomainVersion => ({
  name: MANAGER_DOMAIN_NAME,
  version: descriptor.digestVersion
})

/**
 * sdk.md D-208 construction check 5 over the domain the manager published:
 * its version must be the descriptor's digest version and its name
 * `PolicyManager`. Throws a `DigestVersionRefusal` otherwise.
 */
export const checkDigestVersion = (domain: Domain, descriptor: DeploymentDescriptor): void => {
  const carried = carriedDomainVersion(descriptor)
  if (domain.version !== carried.version || domain.name !== carried.name) {
    throw digestVersionRefusal(carried, { name: domain.name, version: domain.version })
  }
}

const isConstructionRefusal = (value: unknown): value is ConstructionRefusal =>
  value instanceof Error && value.name === 'ConstructionRefusal'

/**
 * Builds the recovery kit client for one account from one configuration.
 *
 * Throws a `ConstructionRefusal` where the provider answers another chain
 * (`chain-id`), the manager's domain names another chain or address
 * (`domain`) or carries other members (`domain-fields`), and a
 * `DigestVersionRefusal` where it publishes another digest version, all
 * before any client is built. Every other failure propagates as it was
 * thrown: a read that failed, or a later construction refusal of the builder.
 */
export const buildRecoveryClient = async (
  config: RecoveryClientConfiguration
): Promise<RecoveryKitClient> => {
  const descriptor = descriptorOf(config.chain, config.addressBook)
  const clientConfiguration = clientConfigurationOf(config)
  const chain = sdkStandIn.chainFor(descriptor, config.account)
  const manager = new PolicyManagerDouble(chain)

  // sdk.md D-208 check 2: the provider's chain.
  const chainId = await config.provider.chainId()
  if (chainId !== descriptor.chainId) {
    throw constructionRefusal(
      'chain-id',
      `The provider answers chain ${chainId}, the descriptor ${descriptor.chainId}.`
    )
  }
  // Checks 3 and 4: the domain's chain and address, then its members.
  const domain = await manager.eip712Domain()
  if (
    Number(domain.chainId) !== descriptor.chainId ||
    !sameAddress(domain.verifyingContract, descriptor.manager)
  ) {
    throw constructionRefusal('domain', 'The manager domain disagrees with the descriptor.')
  }
  if (domain.fields.toLowerCase() !== MANAGER_DOMAIN_FIELDS) {
    throw constructionRefusal(
      'domain-fields',
      'The manager domain carries members this build does not derive under.'
    )
  }
  // Check 5, ux.md D-319: the digest version, before anything is built or prepared.
  checkDigestVersion(domain, descriptor)

  const builder = new RecoveryKitBuilderDouble(chain)
  builder
    .provider(config.provider)
    .descriptor(descriptor)
    .account(config.account)
    .config(clientConfiguration)
    .policyManager(manager)
  // The builder's method registry: the four shipped methods (sdk.md D-206, D-208).
  shippedMethodDoubles(chain).forEach((method) => builder.method(method))

  try {
    const setup = await builder.buildSetupClient()
    const recovery = await builder.buildRecoveryClient()
    const action = await builder.recoveryAction()
    const moduleReads = await builder.methodModuleReads()
    const approving = builder.buildMethodsOrchestrator()
    const walletReads: WalletReads = new WalletReadsDouble(chain, {
      creation: clientConfiguration.creation,
      accountImplementation: clientConfiguration.accountImplementation
    })
    return Object.freeze({
      chain: config.chain,
      account: config.account,
      descriptor,
      setup,
      recovery,
      action,
      moduleReads,
      approving,
      walletReads
    })
  } catch (thrown) {
    if (isConstructionRefusal(thrown) && thrown.check === 'digest-version') {
      throw digestVersionRefusal(carriedDomainVersion(descriptor))
    }
    throw thrown
  }
}
