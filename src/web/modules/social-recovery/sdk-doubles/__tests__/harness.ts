/**
 * The tester's one seam onto the doubles of PT-035 (brief
 * docs/social-recovery/briefs/PT-035.md). Every test file reads the doubles
 * through the SDK interfaces of `sdk-interfaces/` and scripts the chain record
 * through the `World` below, so a rename in the doubles changes this file alone.
 */
import type {
  Address,
  Configuration,
  DeploymentDescriptor,
  Hex,
  IActionCodec,
  IEventManager,
  IMethodsOrchestrator,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionArming,
  IRecoveryActionInteractor,
  IRecoveryClient,
  IRecoveryMethod,
  ISetupClient,
  PrivacyLevel,
  RecoveryKitBuilder,
  SetupDraft,
  TrustedParties,
  ModuleInfo
} from '@web/modules/social-recovery/sdk-interfaces'

/** The attempt statuses D-371 and D-373 name. */
export const ATTEMPT_STATUSES = ['none', 'pending', 'ready', 'cancelled', 'executed'] as const
export type AttemptStatus = typeof ATTEMPT_STATUSES[number]

/** The three cancellers the task body names: the account, a caller with proofs, nobody. */
export const CANCELLERS = ['account', 'proofs', 'nobody'] as const
export type Canceller = typeof CANCELLERS[number]

export const METHOD_KINDS = ['wallet', 'passkey', 'zkPassport', 'aadhaar'] as const
export type MethodKind = typeof METHOD_KINDS[number]

export interface CommittedSetup {
  configuration: Configuration
  draft: SetupDraft
  password?: string
}

export interface World {
  descriptor: DeploymentDescriptor
  account: Address
  provider: IProvider
  manager: IPolicyManagerInteractor
  actionPart: IRecoveryActionInteractor & IRecoveryActionArming
  events: IEventManager
  codec: IActionCodec
  methods: Record<MethodKind, IRecoveryMethod>
  /** A fresh builder wired with every double of this world. */
  builder(): RecoveryKitBuilder
  setupClient(): Promise<ISetupClient>
  recoveryClient(): Promise<IRecoveryClient>
  orchestrator(): IMethodsOrchestrator
  /** A draft the setup client accepts, at a privacy level. */
  draft(level: PrivacyLevel): SetupDraft
  /** A key the account holds today and an address holding nothing. */
  keys: { held: Address; fresh: Address }
  script: {
    setupNone(): void
    setupCommitted(level: PrivacyLevel): CommittedSetup
    attempt(status: AttemptStatus, canceller?: Canceller): void
    authorized(held: boolean): void
    code(present: boolean): void
    method(
      module: Address,
      patch: { paused?: boolean; trustedParties?: TrustedParties; moduleInfo?: ModuleInfo }
    ): void
    keysUpdated(module: Address, current: Hex[]): void
    /** The next and every later call of this member throws. */
    failRead(member: string): void
    /** The member refuses with this code. */
    refuse(member: string, code: string): void
  }
}

export const createWorld = (): World => {
  throw new Error('wired to the doubles once the implementation lands')
}

export const ZERO: Address = '0x0000000000000000000000000000000000000000'
export const isHex = (value: unknown): value is Hex =>
  typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)
export const isAddress = (value: unknown): value is Address =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)

/** Every member of an object, own or on its prototype chain, below Object.prototype. */
export const membersOf = (value: object): string[] => {
  const names = new Set<string>()
  let proto: object | null = value
  while (proto && proto !== Object.prototype) {
    Object.getOwnPropertyNames(proto).forEach((n) => n !== 'constructor' && names.add(n))
    proto = Object.getPrototypeOf(proto)
  }
  return [...names]
}

/**
 * `it.each` and `describe.each` without their typings: the repository's type
 * roots declare the mocha globals over Jest's, so tsc knows no `.each`.
 */
export const eachIt =
  <T>(values: readonly T[]) =>
  (title: string, fn: (value: T) => unknown) =>
    values.forEach((value) => it(title.replace('%s', String(value)), () => fn(value)))

export const eachDescribe =
  <T>(values: readonly T[]) =>
  (title: string, fn: (value: T) => void) =>
    values.forEach((value) => describe(title.replace('%s', String(value)), () => fn(value)))

/** A read the doubles could not make is a thrown value, never an empty answer. */
export const expectThrown = async (run: () => Promise<unknown>) => {
  let caught: unknown
  let answered = false
  try {
    await run()
    answered = true
  } catch (e) {
    caught = e
  }
  expect(answered).toBe(false)
  expect(caught).toBeInstanceOf(Error)
  return caught as Error
}

// Jest runs every file under __tests__, this one included; its own check runs
// only when Jest runs this file, never from a file that imports the harness.
if (expect.getState().testPath === __filename) {
  describe('harness', () => {
    it('builds a world with the four shipped method kinds', () => {
      const world = createWorld()
      expect(Object.keys(world.methods).sort()).toEqual([...METHOD_KINDS].sort())
    })
  })
}
