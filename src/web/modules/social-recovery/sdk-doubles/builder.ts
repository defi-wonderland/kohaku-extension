/**
 * The `RecoveryKitBuilder` double: setters that return the builder and refuse
 * after the first build, one memoized instance of each shared part handed to
 * both clients, the construction checks, and the two
 * narrow getters. `recoveryAction()` hands out `IRecoveryActionInteractor` and
 * never the arming seam; `methodModuleReads()` hands out `IMethodModuleReads`
 * and never the manager part. Both return fresh objects carrying only their
 * interface's members, so the narrowing holds at runtime too.
 *
 * The doubles serve the scripted chain's one account: a builder bound to
 * another account or another chain id refuses at its first build.
 */
import type {
  Address,
  ClientConfiguration,
  DeploymentDescriptor,
  IActionCodec,
  IEventManager,
  IMethodModuleReads,
  IMethodsOrchestrator,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionArming,
  IRecoveryActionInteractor,
  IRecoveryClient,
  IRecoveryMethod,
  ISetupClient,
  RecoveryKitBuilder
} from '@web/modules/social-recovery/sdk-interfaces'

import { ActionCodecDouble } from './action-codec'
import type { ScriptedChain } from './chain'
import { ClientContext, defaultClientConfiguration } from './context'
import { sameAddress } from './encoding'
import { codedError, type CodedError } from './scripts'
import { EventManagerDouble } from './event-manager'
import { MethodsOrchestratorDouble } from './orchestrator'
import { narrowModuleReads, PolicyManagerDouble } from './policy-manager'
import { ProviderDouble } from './provider'
import { narrowActionInteractor, RecoveryActionDouble } from './recovery-action'
import { RecoveryClientDouble } from './recovery-client'
import { SetupClientDouble } from './setup-client'

const DESCRIPTOR_FIELDS: (keyof DeploymentDescriptor)[] = [
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

/**
 * The thrown value of a construction check: an ordinary error carrying the code
 * `construction.<check>` and the check's name in `check` (`descriptor`,
 * `provider`, `account`, `chain-id`, `domain`, `domain-fields`,
 * `digest-version`). The interfaces declare no construction-refusal shape, so
 * this one is the doubles' own.
 */
export interface ConstructionRefusal extends CodedError {
  check: string
}

export const constructionRefusal = (check: string, message: string): ConstructionRefusal => {
  const error = codedError(`construction.${check}`, { check }, message) as ConstructionRefusal
  error.name = 'ConstructionRefusal'
  error.check = check
  return error
}

type ActionPart = IRecoveryActionInteractor & IRecoveryActionArming

export class RecoveryKitBuilderDouble implements RecoveryKitBuilder {
  private frozen = false

  private providerPart?: IProvider

  private descriptorValue?: DeploymentDescriptor

  private accountAddress?: Address

  private actionBinding?: { address: Address; implementation: ActionPart }

  private configuration?: ClientConfiguration

  private managerPart?: IPolicyManagerInteractor & IMethodModuleReads

  private eventsPart?: IEventManager

  private readonly methodList: IRecoveryMethod[] = []

  private readonly codecList: IActionCodec<unknown>[] = []

  private context?: ClientContext

  /** The action part seen through its arming seam, handed to the setup client alone. */
  private arming?: IRecoveryActionArming

  private checks?: Promise<void>

  private setupClient?: Promise<ISetupClient>

  private recoveryClient?: Promise<IRecoveryClient>

  private orchestrator?: IMethodsOrchestrator

  constructor(private readonly chain: ScriptedChain) {}

  private set<T>(apply: () => T): this {
    if (this.frozen)
      throw codedError('builder.frozen', {}, 'The builder refuses a setter after its first build.')
    apply()
    return this
  }

  provider(p: IProvider): RecoveryKitBuilder {
    return this.set(() => {
      this.providerPart = p
    })
  }

  descriptor(d: DeploymentDescriptor): RecoveryKitBuilder {
    return this.set(() => {
      this.descriptorValue = d
    })
  }

  account(address: Address): RecoveryKitBuilder {
    return this.set(() => {
      this.accountAddress = address
    })
  }

  action(address: Address, implementation: ActionPart): RecoveryKitBuilder {
    return this.set(() => {
      this.actionBinding = { address, implementation }
    })
  }

  config(c: ClientConfiguration): RecoveryKitBuilder {
    return this.set(() => {
      this.configuration = c
    })
  }

  policyManager(pm: IPolicyManagerInteractor & IMethodModuleReads): RecoveryKitBuilder {
    return this.set(() => {
      this.managerPart = pm
    })
  }

  eventManager(em: IEventManager): RecoveryKitBuilder {
    return this.set(() => {
      this.eventsPart = em
    })
  }

  method(m: IRecoveryMethod): RecoveryKitBuilder {
    return this.set(() => {
      this.methodList.push(m)
    })
  }

  codec(c: IActionCodec<unknown>): RecoveryKitBuilder {
    return this.set(() => {
      this.codecList.push(c)
    })
  }

  /** The method registry, keyed by each implementation's `modules(descriptor)` answer. */
  private registry(descriptor: DeploymentDescriptor): Map<string, IRecoveryMethod> {
    const registry = new Map<string, IRecoveryMethod>()
    this.methodList.forEach((m) =>
      m.modules(descriptor).forEach((a) => registry.set(a.toLowerCase(), m))
    )
    return registry
  }

  private resolvedDescriptor(): DeploymentDescriptor {
    const d = this.descriptorValue
    if (!d) throw constructionRefusal('descriptor', 'The builder has no deployment descriptor.')
    const missing = DESCRIPTOR_FIELDS.filter((f) => d[f] === undefined || d[f] === null)
    if (missing.length) {
      throw constructionRefusal('descriptor', `The descriptor misses ${missing.join(', ')}.`)
    }
    return d
  }

  /** Constructs each shared part once; the same instances back both clients. */
  private parts(): ClientContext {
    if (this.context) return this.context
    const descriptor = this.resolvedDescriptor()
    if (!this.providerPart) throw constructionRefusal('provider', 'The builder has no provider.')
    const account = this.accountAddress ?? this.chain.account
    if (!sameAddress(account, this.chain.account)) {
      throw constructionRefusal('account', 'The doubles serve the scripted chain’s one account.')
    }
    const config = this.configuration ?? defaultClientConfiguration()
    const actionAddress = this.actionBinding?.address ?? descriptor.action
    const registry = this.registry(descriptor)
    const codecs = [...this.codecList]
    if (!codecs.some((c) => c.actions.some((a) => sameAddress(a, descriptor.action)))) {
      codecs.push(new ActionCodecDouble([descriptor.action]))
    }
    const actionPart = this.actionBinding?.implementation ?? new RecoveryActionDouble(this.chain)
    this.arming = actionPart
    this.context = {
      chain: this.chain,
      provider: this.providerPart,
      manager: this.managerPart ?? new PolicyManagerDouble(this.chain),
      action: actionPart,
      actionAddress,
      events:
        this.eventsPart ??
        new EventManagerDouble(
          this.chain,
          this.providerPart,
          [...registry.keys()] as Address[],
          config.logChunkWidth
        ),
      config,
      codecs
    }
    return this.context
  }

  /** The construction checks, run once per builder and memoized. */
  private construct(): Promise<ClientContext> {
    this.frozen = true
    if (!this.checks) {
      this.checks = (async () => {
        const ctx = this.parts()
        const descriptor = this.resolvedDescriptor()
        const chainId = await ctx.provider.chainId()
        if (chainId !== descriptor.chainId) {
          throw constructionRefusal(
            'chain-id',
            `The provider answers chain ${chainId}, the descriptor ${descriptor.chainId}.`
          )
        }
        const domain = await ctx.manager.eip712Domain()
        if (
          Number(domain.chainId) !== descriptor.chainId ||
          !sameAddress(domain.verifyingContract, descriptor.manager)
        ) {
          throw constructionRefusal('domain', 'The manager’s domain disagrees with the descriptor.')
        }
        if (domain.fields.toLowerCase() !== '0x0f') {
          throw constructionRefusal(
            'domain-fields',
            'The manager’s domain carries members this build does not derive under.'
          )
        }
        if (domain.version !== descriptor.digestVersion || domain.name !== 'PolicyManager') {
          throw constructionRefusal(
            'digest-version',
            'The manager’s digest version is not the one this build carries.'
          )
        }
      })()
    }
    return this.checks.then(() => this.parts())
  }

  buildSetupClient(): Promise<ISetupClient> {
    if (!this.setupClient) {
      this.setupClient = this.construct().then(
        (ctx) => new SetupClientDouble(ctx, this.arming as IRecoveryActionArming)
      )
    }
    return this.setupClient
  }

  buildRecoveryClient(): Promise<IRecoveryClient> {
    if (!this.recoveryClient) {
      this.recoveryClient = this.construct().then((ctx) => new RecoveryClientDouble(ctx))
    }
    return this.recoveryClient
  }

  /** The approving side: no provider, no chain read, the two registries. */
  buildMethodsOrchestrator(): IMethodsOrchestrator {
    this.frozen = true
    if (!this.orchestrator) {
      const descriptor = this.resolvedDescriptor()
      const codecs = [...this.codecList]
      if (!codecs.some((c) => c.actions.some((a) => sameAddress(a, descriptor.action)))) {
        codecs.push(new ActionCodecDouble([descriptor.action]))
      }
      this.orchestrator = new MethodsOrchestratorDouble(
        this.registry(descriptor),
        codecs,
        this.chain
      )
    }
    return this.orchestrator
  }

  async recoveryAction(): Promise<IRecoveryActionInteractor> {
    const ctx = await this.construct()
    return narrowActionInteractor(ctx.action)
  }

  async methodModuleReads(): Promise<IMethodModuleReads> {
    const ctx = await this.construct()
    return narrowModuleReads(ctx.manager)
  }
}

/**
 * A builder already bound to the scripted chain: its provider double, its
 * descriptor, its account and a client configuration (the doubles' default
 * unless given). Methods are the integrator's to register.
 */
export const kitFor = (
  chain: ScriptedChain,
  config: Partial<ClientConfiguration> = {}
): RecoveryKitBuilderDouble =>
  new RecoveryKitBuilderDouble(chain)
    .provider(new ProviderDouble(chain))
    .descriptor(chain.descriptor)
    .account(chain.account)
    .config(defaultClientConfiguration(config)) as RecoveryKitBuilderDouble
