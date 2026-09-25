/**
 * The one scripted chain record every double reads.
 *
 * It holds what the kit's contracts would hold for one account under one action
 * on one deployment: the setup (none or committed under one of the three privacy
 * levels), the attempt (none, pending, ready, cancelled by the account, by a
 * caller with proofs or by nobody, or executed), the account's authorization of
 * the action, whether the account holds code, one
 * declaration per method (`moduleInfo`, `paused`, `trustedParties`), the
 * manager's views (`stateOf`, `setupCommittedAtBlock`, `eip712Domain`) and the
 * action's views (`supportsAccount`, `isAuthority`, `holdsAnyPrivilege`).
 *
 * Every state change goes through a member below, and each one appends the event
 * the contract would emit, in a freshly mined block (one transaction per block,
 * log indices in order), so the interactor, the event manager and the read seam
 * always agree: a committed setup has its `SetupCommitted`, an executed attempt
 * its `AttemptStarted` and `AttemptConsumed`, and so on.
 *
 * The record also holds the scripts: reads that fail, members that refuse,
 * simulations that fail and the answers of the approving side. The doubles read
 * those scripts at every call, so a test changes the world between two calls.
 * Every script stands until it is cleared.
 */
import type {
  ActionInfo,
  AddRefusalReason,
  ActionState,
  Address,
  Attempt,
  AttemptRequest,
  BlockHeader,
  BlockTag,
  CancelledBy,
  CancelRequest,
  Configuration,
  DeploymentDescriptor,
  DeviceBinding,
  Domain,
  Handover,
  Hex,
  KitError,
  MethodFailureCause,
  ModuleInfo,
  Notification,
  PaymentOrder,
  PreparedBatch,
  PreparedCall,
  PrivacyLevel,
  TrustedParties,
  ValidationResult,
  Verdict
} from '@web/modules/social-recovery/sdk-interfaces'

import { ActionCodecDouble } from './action-codec'
import {
  addressOf,
  blockHashOf,
  clearBackup,
  clearNote,
  hashOf,
  keccak256,
  levelOfMetadata,
  readSetupBody,
  sameAddress,
  sealBackup,
  setupBodyOf,
  setupCommitmentOf,
  shapeNote,
  ZERO_ADDRESS,
  ZERO_HASH
} from './encoding'
import {
  codedError,
  kitError,
  landingRevert,
  ModuleRead,
  ScriptedFindings,
  ScriptedRead,
  ScriptedReadFailure,
  ScriptedRefusalMember,
  ScriptedSimulation,
  thrownValueOf,
  ThrownRefusal
} from './scripts'
import { acceptanceRevert, decodeHandover, executeRevert } from './verification'

/** The five attempt statuses the wallet computes (see `attemptStatus`). */
export const ATTEMPT_STATUSES = ['none', 'pending', 'ready', 'cancelled', 'executed'] as const
export type AttemptStatus = typeof ATTEMPT_STATUSES[number]

/**
 * Who cancelled: the account (`cancelByOwner`), a caller with proofs
 * (`cancelByProofs`), or nobody, where no party authorized the cancel: a
 * security stop's veto (`cancelByVeto`, with the vetoing method) or a setup
 * write (the log's zero canceller).
 */
export const CANCELLERS = ['account', 'proofs', 'nobody'] as const
export type Canceller = typeof CANCELLERS[number]

/** One method module's declaration: what its three module views answer. */
export interface MethodDeclaration {
  moduleInfo: ModuleInfo
  paused: boolean
  trustedParties: TrustedParties
}

export interface NoSetup {
  status: 'none'
  /** The manager's setup nonce; it counts clears as well as commits. */
  setupNonce: bigint
  /** The block of the last setup write, a clear among them; 0 where none ever ran. */
  setupCommittedAtBlock: number
}

export interface CommittedSetup {
  status: 'committed'
  /** The privacy level the two metadata fields encode, read back from them. */
  level: PrivacyLevel
  setupNonce: bigint
  setupCommitment: Hex
  setupCommittedAtBlock: number
  setupBody: Hex
  publicMetadata: Hex
  privateMetadata: Hex
  /** The configuration the script committed, for tests; absent after a raw commit. */
  configuration?: Configuration
}

export type SetupScript = NoSetup | CommittedSetup

/** What the manager keeps of an attempt, beside the event fields it published. */
export interface AttemptRecord {
  attemptId: bigint
  setupNonce: bigint
  setupBody: Hex
  consumableAfter: number
  payload: Hex
  order: PaymentOrder
  usedPlaces: bigint[]
  usedMethods: Address[]
  ignoresPause: boolean
  startedAtBlock: number
}

export type AttemptScript =
  | { status: 'none' }
  | { status: 'waiting'; record: AttemptRecord }
  | {
      status: 'cancelled'
      record: AttemptRecord
      canceller: Canceller
      cancellerAddress: Address
      vetoingMethod: Address
      cancelledBy: CancelledBy
      endedAtBlock: number
    }
  | { status: 'executed'; record: AttemptRecord; endedAtBlock: number }

/** What landing a prepared call does to the record (see `land`). */
export type ChainEffect =
  | { kind: 'arm' }
  | { kind: 'disarm' }
  | {
      kind: 'commit'
      setupCommitment: Hex
      nonce: bigint
      publicMetadata: Hex
      privateMetadata: Hex
      setupBody?: Hex
      configuration?: Configuration
    }
  | { kind: 'clear' }
  | { kind: 'start'; request: AttemptRequest }
  | { kind: 'cancel-by-owner' }
  | { kind: 'cancel-by-proofs'; request: CancelRequest }
  | { kind: 'cancel-by-veto'; attemptId: bigint; method: Address }
  | { kind: 'execute'; attemptId: bigint; payload: Hex }

export interface ReadScript {
  mode: 'throw' | 'unanswered'
  module?: Address
  /** The value to throw in place of a `ScriptedReadFailure`. */
  error?: Error
}

/** What a new chain starts from; every field has a default. */
export interface ChainSeed {
  descriptor?: Partial<DeploymentDescriptor>
  account?: Address
  head?: { number: number; timestamp: number }
  authorities?: Address[]
  otherPrivileged?: Address[]
  authorized?: boolean
  hasCode?: boolean
  supportsAccount?: boolean
}

/** The placeholder deployment the doubles default to: every address a fixed label's hash. */
export const doubleDescriptor = (
  overrides: Partial<DeploymentDescriptor> = {}
): DeploymentDescriptor => {
  const base: DeploymentDescriptor = {
    chainId: 11155111,
    manager: addressOf('manager'),
    methodEcdsa: addressOf('method-ecdsa'),
    methodPasskey: addressOf('method-passkey'),
    methodAadhaar: addressOf('method-aadhaar'),
    methodZkpassport: addressOf('method-zkpassport'),
    action: addressOf('action'),
    servedImplementation: addressOf('ambire-account-implementation'),
    deployedAt: 900,
    digestVersion: '1',
    managerVersion: '1.0.0',
    shippedMethods: [],
    auditedActions: []
  }
  const merged = { ...base, ...overrides }
  return {
    ...merged,
    shippedMethods: overrides.shippedMethods ?? [
      merged.methodEcdsa,
      merged.methodPasskey,
      merged.methodAadhaar,
      merged.methodZkpassport
    ],
    auditedActions: overrides.auditedActions ?? [merged.action]
  }
}

const BLOCK_TIME = 12

/** The key value a handover grants, fixed at `1` inside the action. */
export const KEY_PRIVILEGE: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000001'

/** The `verify` gas the doubles charge a module they have no figure for. */
export const UNKNOWN_VERIFY_COST = 2_000_000n

/** The value the doubles write for another privileged entry, a code entry or a validator. */
export const CODE_PRIVILEGE: Hex = hashOf({ privilege: 'code-entry' })

export class ScriptedChain {
  readonly descriptor: DeploymentDescriptor

  readonly account: Address

  /** The action this chain's setup lives under, the descriptor's. */
  readonly action: Address

  head: BlockHeader

  setup: SetupScript = { status: 'none', setupNonce: 0n, setupCommittedAtBlock: 0 }

  attempt: AttemptScript = { status: 'none' }

  /** The id the next attempt must carry, the manager's `nextAttemptId`. */
  nextAttemptId = 1n

  /** Whether the account holds the kit slot for this action (`isAuthorized`). */
  authorized: boolean

  /** Whether the account address holds code. */
  hasCode: boolean

  /** The action's `supportsAccount(account)` answer where the account holds code. */
  supportsAccount: boolean

  /** The addresses holding a key value in the account's privilege table (`isAuthority`). */
  authorities: Address[]

  /** Other privileged entries: code entries, validators (`holdsAnyPrivilege`, not `isAuthority`). */
  otherPrivileged: Address[]

  /** One declaration per method module, keyed by lowercase address. */
  readonly methods = new Map<string, MethodDeclaration>()

  /**
   * Each module's `verify` gas, keyed by lowercase address, which `rule.too-wide`
   * sums over the costliest satisfying set. The defaults are placeholders, not
   * measured costs; a module missing here costs `UNKNOWN_VERIFY_COST`.
   */
  readonly verifyCosts = new Map<string, bigint>()

  manager: { name: string; version: string; supportsInterface: boolean; domain: Domain }

  actionInfo: ActionInfo

  /** Every event the chain emitted, in log order. */
  readonly notifications: Notification[] = []

  /** Answers of `IProvider.call` by `${to}:${data}`, a revert where scripted. */
  readonly calls = new Map<string, { result: Hex } | { revert: Hex }>()

  // ---- scripts ----
  private readonly readScripts = new Map<ScriptedRead, ReadScript[]>()

  private readonly refusals = new Map<ScriptedRefusalMember, ThrownRefusal>()

  private readonly simulations = new Map<ScriptedSimulation, KitError>()

  private readonly appended = new Map<ScriptedFindings, ValidationResult>()

  /** The failure every `replyFrom` returns while set. */
  replyFailure?: MethodFailureCause

  /** The failure every `configFrom` returns while set. */
  enrollFailure?: MethodFailureCause

  /** The verdict every `verify` answers while set, in place of the double's own check. */
  verdict?: Verdict

  /** The `addApproverReply` refusal forced while set, in place of the double's own checks. */
  addRefusal?: AddRefusalReason

  /** The device bindings this runtime cannot meet; `signingInput` throws on them. */
  readonly unmetBindings = new Set<DeviceBinding>()

  private readonly effects = new Map<string, ChainEffect>()

  private readonly blocks = new Map<number, BlockHeader>()

  constructor(seed: ChainSeed = {}) {
    this.descriptor = doubleDescriptor(seed.descriptor)
    this.account = seed.account ?? addressOf('account')
    this.action = this.descriptor.action
    const headNumber = seed.head?.number ?? 1000
    this.head = {
      number: headNumber,
      timestamp: seed.head?.timestamp ?? 1_790_000_000,
      hash: blockHashOf(headNumber)
    }
    this.blocks.set(this.head.number, this.head)
    this.authorities = seed.authorities ?? [addressOf('holder-key')]
    this.otherPrivileged = seed.otherPrivileged ?? []
    this.authorized = seed.authorized ?? false
    this.hasCode = seed.hasCode ?? true
    this.supportsAccount = seed.supportsAccount ?? true
    this.manager = {
      name: 'PolicyManager',
      version: this.descriptor.managerVersion,
      supportsInterface: true,
      domain: {
        fields: '0x0f',
        name: 'PolicyManager',
        version: this.descriptor.digestVersion,
        chainId: BigInt(this.descriptor.chainId),
        verifyingContract: this.descriptor.manager,
        salt: ZERO_HASH,
        extensions: []
      }
    }
    this.actionInfo = { name: 'AmbireRecoveryAction', version: '1', supportsInterface: true }
    const d = this.descriptor
    this.declareMethod(d.methodEcdsa, {
      moduleInfo: { name: 'method-ecdsa', version: '1', supportsInterface: true }
    })
    this.declareMethod(d.methodPasskey, {
      moduleInfo: { name: 'method-passkey', version: '1', supportsInterface: true }
    })
    this.declareMethod(d.methodAadhaar, {
      moduleInfo: { name: 'method-aadhaar', version: '1', supportsInterface: true },
      trustedParties: this.defaultParties(
        addressOf('aadhaar-admin'),
        addressOf('aadhaar-pause-holder')
      )
    })
    this.declareMethod(d.methodZkpassport, {
      moduleInfo: { name: 'method-zkpassport', version: '1', supportsInterface: true },
      trustedParties: this.defaultParties(
        addressOf('zkpassport-admin'),
        addressOf('zkpassport-pause-holder')
      )
    })
    this.verifyCosts.set(d.methodEcdsa.toLowerCase(), 10_000n)
    this.verifyCosts.set(d.methodPasskey.toLowerCase(), 400_000n)
    this.verifyCosts.set(d.methodAadhaar.toLowerCase(), 2_000_000n)
    this.verifyCosts.set(d.methodZkpassport.toLowerCase(), 2_000_000n)
  }

  /** One module's `verify` gas as the doubles price it (see `verifyCosts`). */
  verifyCostOf(module: Address): bigint {
    return this.verifyCosts.get(module.toLowerCase()) ?? UNKNOWN_VERIFY_COST
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  /** Mines one block `seconds` after the head and makes it the head. */
  mine(seconds = BLOCK_TIME): BlockHeader {
    const number = this.head.number + 1
    this.head = { number, timestamp: this.head.timestamp + seconds, hash: blockHashOf(number) }
    this.blocks.set(number, this.head)
    return this.head
  }

  /** Moves chain time forward by `seconds` over `blocks` blocks. */
  advance(seconds: number, blocks = 1): BlockHeader {
    const step = Math.max(1, Math.floor(seconds / Math.max(1, blocks)))
    for (let i = 0; i < blocks - 1; i++) this.mine(step)
    return this.mine(seconds - step * (blocks - 1))
  }

  /** The block a tag names; every named tag answers the head. */
  blockAt(tag: BlockTag): BlockHeader {
    if (typeof tag !== 'number') return this.head
    const known = this.blocks.get(tag)
    if (known) return known
    return {
      number: tag,
      timestamp: this.head.timestamp - (this.head.number - tag) * BLOCK_TIME,
      hash: blockHashOf(tag)
    }
  }

  private emit(notification: Record<string, unknown>): Notification {
    return this.emitAll([notification])[0]
  }

  /** Emits the logs of one transaction: one new block, one hash, log indices in order. */
  private emitAll(notifications: Record<string, unknown>[]): Notification[] {
    const block = this.mine()
    const transactionHash = hashOf({ tx: block.number, kinds: notifications.map((n) => n.kind) })
    const emitted = notifications.map(
      (notification, logIndex) =>
        ({
          ...notification,
          at: {
            blockNumber: block.number,
            blockHash: block.hash,
            logIndex,
            transactionHash,
            removed: false
          }
        } as Notification)
    )
    this.notifications.push(...emitted)
    return emitted
  }

  // -------------------------------------------------------------------------
  // The kit slot and the account's privilege table
  // -------------------------------------------------------------------------

  /** The account's kit slot for this action, in the doubles' hashing. */
  get kitSlot(): Address {
    return addressOf(`kit-slot:${this.action.toLowerCase()}`)
  }

  setAuthorized(authorized: boolean): void {
    this.authorized = authorized
    this.emit({
      kind: 'privilege-changed',
      account: this.account,
      addr: this.kitSlot,
      priv: authorized ? hashOf({ binding: this.action.toLowerCase() }) : ZERO_HASH
    })
  }

  setHasCode(hasCode: boolean): void {
    this.hasCode = hasCode
  }

  setSupportsAccount(supports: boolean): void {
    this.supportsAccount = supports
  }

  /**
   * The privilege writes that move a list of entries from `before` to `after`,
   * one `LogPrivilegeChanged` per entry that changed, so the account's privilege
   * stream and its key list always agree.
   */
  private privilegeWrites(
    before: Address[],
    after: Address[],
    value: Hex
  ): Record<string, unknown>[] {
    const removed = before.filter((a) => !after.some((b) => sameAddress(a, b)))
    const added = after.filter((a) => !before.some((b) => sameAddress(a, b)))
    return [
      ...added.map((addr) => ({
        kind: 'privilege-changed',
        account: this.account,
        addr,
        priv: value
      })),
      ...removed.map((addr) => ({
        kind: 'privilege-changed',
        account: this.account,
        addr,
        priv: ZERO_HASH
      }))
    ]
  }

  /** Replaces the addresses holding a key value, emitting one privilege write per change. */
  setAuthorities(keys: Address[]): void {
    const writes = this.privilegeWrites(this.authorities, keys, KEY_PRIVILEGE)
    this.authorities = [...keys]
    if (writes.length) this.emitAll(writes)
  }

  /** Replaces the other privileged entries, emitting one privilege write per change. */
  setOtherPrivileged(addresses: Address[]): void {
    const writes = this.privilegeWrites(this.otherPrivileged, addresses, CODE_PRIVILEGE)
    this.otherPrivileged = [...addresses]
    if (writes.length) this.emitAll(writes)
  }

  isAuthority(key: Address): boolean {
    return this.authorities.some((a) => sameAddress(a, key))
  }

  holdsAnyPrivilege(candidate: Address): boolean {
    return (
      this.isAuthority(candidate) ||
      this.otherPrivileged.some((a) => sameAddress(a, candidate)) ||
      (this.authorized && sameAddress(candidate, this.kitSlot))
    )
  }

  /**
   * The inference that names the key a handover removes: with a creation
   * record, the one entry still holding a key value; otherwise the reason it
   * cannot name one.
   */
  removedKeyReading(hasCreationRecord: boolean):
    | { kind: 'named'; key: Address }
    | {
        kind: 'unavailable'
        cause: 'no-creation-record' | 'no-key-entry' | 'several-key-entries'
      } {
    if (!hasCreationRecord) return { kind: 'unavailable', cause: 'no-creation-record' }
    if (this.authorities.length === 0) return { kind: 'unavailable', cause: 'no-key-entry' }
    if (this.authorities.length > 1) return { kind: 'unavailable', cause: 'several-key-entries' }
    return { kind: 'named', key: this.authorities[0] }
  }

  // -------------------------------------------------------------------------
  // Methods
  // -------------------------------------------------------------------------

  private defaultParties(
    admin: Address = ZERO_ADDRESS,
    pauseHolder: Address = ZERO_ADDRESS
  ): TrustedParties {
    return {
      admin,
      pendingAdmin: ZERO_ADDRESS,
      trustedKeys: [],
      pauseHolder,
      pendingPauseHolder: ZERO_ADDRESS
    }
  }

  /** Declares (or redeclares) one method module; unspecified views keep their value or a default. */
  declareMethod(module: Address, declaration: Partial<MethodDeclaration> = {}): MethodDeclaration {
    const current = this.methods.get(module.toLowerCase())
    const next: MethodDeclaration = {
      moduleInfo: declaration.moduleInfo ??
        current?.moduleInfo ?? { name: 'unknown-method', version: '0', supportsInterface: false },
      paused: declaration.paused ?? current?.paused ?? false,
      trustedParties: declaration.trustedParties ?? current?.trustedParties ?? this.defaultParties()
    }
    this.methods.set(module.toLowerCase(), next)
    return next
  }

  method(module: Address): MethodDeclaration | undefined {
    return this.methods.get(module.toLowerCase())
  }

  /** Removes a module's declaration: its views then revert, a module with no code. */
  forgetMethod(module: Address): void {
    this.methods.delete(module.toLowerCase())
  }

  /** Turns a method's stop on or off, emitting `Paused` or `Unpaused`. */
  setPaused(module: Address, paused: boolean, by?: Address): void {
    const declaration = this.declareMethod(module, { paused })
    this.emit({
      kind: paused ? 'method-paused' : 'method-unpaused',
      method: module,
      by: by ?? declaration.trustedParties.pauseHolder
    })
  }

  /** Replaces a method's trusted keys, emitting `TrustedKeysUpdated`. */
  updateTrustedKeys(module: Address, keys: Hex[]): void {
    const declaration = this.declareMethod(module)
    const previous = declaration.trustedParties.trustedKeys
    this.declareMethod(module, {
      trustedParties: { ...declaration.trustedParties, trustedKeys: [...keys] }
    })
    this.emit({ kind: 'method-keys-updated', method: module, previous, current: [...keys] })
  }

  // -------------------------------------------------------------------------
  // The setup
  // -------------------------------------------------------------------------

  /**
   * Commits a setup under one privacy level, as the account would: private
   * (nothing public, values sealed), shape-visible (shape public, values sealed)
   * or public (everything clear, no password). A waiting attempt is cancelled
   * by the write, as the manager does.
   */
  commitSetup(options: {
    level: PrivacyLevel
    configuration: Configuration
    password?: string
  }): CommittedSetup {
    const { level, configuration, password } = options
    if (level !== 'public' && !password) {
      throw codedError('setup.password-missing', { level })
    }
    let publicMetadata: Hex = '0x'
    let privateMetadata: Hex
    if (level === 'public') {
      publicMetadata = clearNote(configuration)
      privateMetadata = clearBackup(configuration)
    } else {
      if (level === 'shape-visible') publicMetadata = shapeNote(configuration)
      privateMetadata = sealBackup(configuration, password as string)
    }
    const nonce = this.setup.setupNonce + 1n
    const setupBody = setupBodyOf(this.account, configuration)
    return this.commitRaw({
      setupCommitment: setupCommitmentOf(this.account, this.action, nonce, setupBody),
      nonce,
      publicMetadata,
      privateMetadata,
      setupBody,
      configuration
    })
  }

  /** Commits the raw fields a `commitSetup` call carries; what `land` runs. */
  commitRaw(fields: {
    setupCommitment: Hex
    nonce: bigint
    publicMetadata: Hex
    privateMetadata: Hex
    setupBody?: Hex
    configuration?: Configuration
  }): CommittedSetup {
    if (this.attempt.status === 'waiting') this.cancelAttempt('nobody')
    const n = this.emit({
      kind: 'setup-committed',
      account: this.account,
      action: this.action,
      nonce: fields.nonce,
      setupCommitment: fields.setupCommitment,
      publicMetadata: fields.publicMetadata,
      privateMetadata: fields.privateMetadata
    })
    const setup: CommittedSetup = {
      status: 'committed',
      level: levelOfMetadata(fields.publicMetadata, fields.privateMetadata),
      setupNonce: fields.nonce,
      setupCommitment: fields.setupCommitment,
      setupCommittedAtBlock: n.at.blockNumber,
      setupBody: fields.setupBody ?? '0x',
      publicMetadata: fields.publicMetadata,
      privateMetadata: fields.privateMetadata,
      configuration: fields.configuration
    }
    this.setup = setup
    return setup
  }

  /** Clears the setup, as `clearSetup` does; a waiting attempt is cancelled. */
  clearSetup(): void {
    if (this.setup.status !== 'committed') {
      throw codedError('NoSetup', { account: this.account, action: this.action })
    }
    if (this.attempt.status === 'waiting') this.cancelAttempt('nobody')
    const nonce = this.setup.setupNonce + 1n
    const n = this.emit({
      kind: 'setup-cleared',
      account: this.account,
      action: this.action,
      nonce
    })
    this.setup = { status: 'none', setupNonce: nonce, setupCommittedAtBlock: n.at.blockNumber }
  }

  /**
   * Records a setup write under another action of this account, events only
   * (the doubles hold one action's state): what the `manager.already-armed`
   * warning pairs, the last commit against the last clear per action.
   */
  commitOtherAction(action: Address, nonce = 1n): void {
    this.emit({
      kind: 'setup-committed',
      account: this.account,
      action,
      nonce,
      setupCommitment: hashOf({ other: action.toLowerCase(), nonce }),
      publicMetadata: '0x',
      privateMetadata: '0x'
    })
  }

  /** Records a clear under another action of this account, events only. */
  clearOtherAction(action: Address, nonce = 2n): void {
    this.emit({ kind: 'setup-cleared', account: this.account, action, nonce })
  }

  // -------------------------------------------------------------------------
  // The attempt
  // -------------------------------------------------------------------------

  /**
   * Opens an attempt, as `startAttempt` does, emitting `AttemptStarted`. `ready`
   * puts `consumableAfter` at or before the new head (the wait is over); the
   * default leaves it `wait` seconds ahead (pending).
   */
  openAttempt(
    options: {
      ready?: boolean
      wait?: number
      attemptId?: bigint
      setupNonce?: bigint
      setupBody?: Hex
      payload?: Hex
      order?: PaymentOrder
      usedPlaces?: bigint[]
      usedMethods?: Address[]
      ignoresPause?: boolean
    } = {}
  ): AttemptRecord {
    if (this.attempt.status === 'waiting') {
      throw codedError('AttemptAlreadyActive', { attemptId: this.attempt.record.attemptId })
    }
    const committed = this.setup.status === 'committed' ? this.setup : undefined
    let body: { wait: bigint; ignoresPause: boolean } | undefined
    try {
      body =
        committed?.setupBody && committed.setupBody !== '0x'
          ? readSetupBody(committed.setupBody)
          : undefined
    } catch {
      body = undefined
    }
    const wait = options.wait ?? (body ? Number(body.wait) : 172_800)
    const opening = this.head.timestamp + BLOCK_TIME
    const attemptId = options.attemptId ?? this.nextAttemptId
    const firstMethod =
      committed?.configuration?.clauses[0]?.credentials[0]?.method ?? this.descriptor.methodEcdsa
    const record: AttemptRecord = {
      attemptId,
      setupNonce: options.setupNonce ?? this.setup.setupNonce,
      setupBody: options.setupBody ?? committed?.setupBody ?? '0x',
      consumableAfter: options.ready ? opening : opening + wait,
      payload:
        options.payload ??
        new ActionCodecDouble([this.action]).encode({
          newAuthority: addressOf('new-key'),
          removedAuthority: this.authorities[0] ?? addressOf('lost-key')
        }),
      order: options.order ?? { token: ZERO_ADDRESS, amount: 0n, payee: ZERO_ADDRESS },
      usedPlaces: options.usedPlaces ?? [0n],
      usedMethods: options.usedMethods ?? [firstMethod],
      ignoresPause: options.ignoresPause ?? body?.ignoresPause ?? true,
      startedAtBlock: 0
    }
    const n = this.emit({
      kind: 'attempt-started',
      account: this.account,
      action: this.action,
      attemptId: record.attemptId,
      setupNonce: record.setupNonce,
      setupBody: record.setupBody,
      usedPlaces: record.usedPlaces,
      usedMethods: record.usedMethods,
      payload: record.payload,
      order: record.order,
      consumableAfter: record.consumableAfter
    })
    record.startedAtBlock = n.at.blockNumber
    if (options.ready)
      record.consumableAfter = Math.min(record.consumableAfter, this.head.timestamp)
    this.attempt = { status: 'waiting', record }
    this.nextAttemptId = attemptId + 1n
    return record
  }

  /**
   * Cancels the waiting attempt, emitting `AttemptCancelled`. `nobody` with a
   * `vetoingMethod` is a security stop's veto; without one it is a setup write.
   */
  cancelAttempt(
    canceller: Canceller,
    options: { vetoingMethod?: Address; caller?: Address; usedPlaces?: bigint[] } = {}
  ): void {
    if (this.attempt.status !== 'waiting') {
      throw codedError('NoActiveAttempt', { account: this.account, action: this.action })
    }
    const { record } = this.attempt
    let cancellerAddress: Address = ZERO_ADDRESS
    let vetoingMethod: Address = ZERO_ADDRESS
    let usedPlaces: bigint[] = []
    let cancelledBy: CancelledBy = 'setupWrite'
    if (canceller === 'account') {
      cancellerAddress = this.account
      cancelledBy = 'cancelByOwner'
    } else if (canceller === 'proofs') {
      cancellerAddress = options.caller ?? addressOf('proof-submitter')
      usedPlaces = options.usedPlaces ?? [0n]
      cancelledBy = 'cancelByProofs'
    } else if (options.vetoingMethod) {
      cancellerAddress = options.caller ?? addressOf('veto-sender')
      vetoingMethod = options.vetoingMethod
      cancelledBy = 'cancelByVeto'
    }
    const n = this.emit({
      kind: 'attempt-cancelled',
      account: this.account,
      action: this.action,
      attemptId: record.attemptId,
      canceller: cancellerAddress,
      vetoingMethod,
      cancelledBy,
      setupNonce: record.setupNonce,
      usedPlaces
    })
    this.attempt = {
      status: 'cancelled',
      record,
      canceller,
      cancellerAddress,
      vetoingMethod,
      cancelledBy,
      endedAtBlock: n.at.blockNumber
    }
  }

  /**
   * Spends the waiting attempt and performs its handover, as `executeHandover`
   * does: `AttemptConsumed`, then the grant of the new key and the revoke of the
   * removed one, three logs of one transaction, and the key list rotates. The
   * handover is the one given, or the one the attempt's payload decodes to. As
   * a script it checks nothing else; `land` refuses what the chain would revert
   * (see `executeRevert`).
   */
  executeAttempt(handover?: Handover): void {
    if (this.attempt.status !== 'waiting') {
      throw codedError('NotConsumable', { state: this.attemptRecord().state })
    }
    const { record } = this.attempt
    const performed = handover ?? decodeHandover(this, record.payload)
    if (!performed) throw codedError('MalformedHandover', { payload: record.payload })
    const after = [
      ...this.authorities.filter((a) => !sameAddress(a, performed.removedAuthority)),
      performed.newAuthority
    ]
    const logs = [
      {
        kind: 'attempt-consumed',
        account: this.account,
        action: this.action,
        attemptId: record.attemptId
      },
      {
        kind: 'privilege-changed',
        account: this.account,
        addr: performed.newAuthority,
        priv: KEY_PRIVILEGE
      },
      {
        kind: 'privilege-changed',
        account: this.account,
        addr: performed.removedAuthority,
        priv: ZERO_HASH
      }
    ]
    this.authorities = after
    const [n] = this.emitAll(logs)
    this.attempt = { status: 'executed', record, endedAtBlock: n.at.blockNumber }
  }

  /** The status the wallet computes: ready is a waiting attempt whose wait is over at the head. */
  attemptStatus(): AttemptStatus {
    switch (this.attempt.status) {
      case 'none':
        return 'none'
      case 'waiting':
        return this.attempt.record.consumableAfter <= this.head.timestamp ? 'ready' : 'pending'
      default:
        return this.attempt.status
    }
  }

  /** The manager's `stateOf(account, action)` over the record. */
  stateOf(): ActionState {
    const committed = this.setup.status === 'committed'
    return {
      setupCommitment: committed ? (this.setup as CommittedSetup).setupCommitment : ZERO_HASH,
      setupNonce: this.setup.setupNonce,
      nextAttemptId: this.nextAttemptId,
      setupCommittedAtBlock: this.setup.setupCommittedAtBlock,
      attempt: this.attemptRecord()
    }
  }

  /** The manager's `Attempt` record under its own names. */
  attemptRecord(): Attempt {
    if (this.attempt.status === 'none') {
      return {
        state: 'None',
        attemptId: 0n,
        setupNonce: 0n,
        consumableAfter: 0,
        payloadHash: ZERO_HASH,
        order: { token: ZERO_ADDRESS, amount: 0n, payee: ZERO_ADDRESS },
        usedMethods: [],
        ignoresPause: false
      }
    }
    const { record } = this.attempt
    const state =
      this.attempt.status === 'waiting'
        ? 'Waiting'
        : this.attempt.status === 'cancelled'
        ? 'Cancelled'
        : 'Consumed'
    return {
      state,
      attemptId: record.attemptId,
      setupNonce: record.setupNonce,
      consumableAfter: record.consumableAfter,
      payloadHash: keccak256(record.payload),
      order: record.order,
      usedMethods: record.usedMethods,
      ignoresPause: record.ignoresPause
    }
  }

  // -------------------------------------------------------------------------
  // Scripts
  // -------------------------------------------------------------------------

  /**
   * Makes a read throw a `ScriptedReadFailure` (or `error` where given) until
   * cleared. `module` limits a module read to one module address.
   */
  failRead(read: ScriptedRead, options: { module?: Address; error?: Error } = {}): this {
    this.pushRead(read, { mode: 'throw', ...options })
    return this
  }

  /** Makes a module read answer `{ answered: false }`, the SDK's own failed-read shape. */
  leaveUnanswered(read: ModuleRead, module?: Address): this {
    this.pushRead(read, { mode: 'unanswered', module })
    return this
  }

  private pushRead(read: ScriptedRead, script: ReadScript): void {
    this.readScripts.set(read, [...(this.readScripts.get(read) ?? []), script])
  }

  /** Stops failing one read, or every read. */
  restoreRead(read?: ScriptedRead): this {
    if (read) this.readScripts.delete(read)
    else this.readScripts.clear()
    return this
  }

  /** Makes a member refuse with a thrown value until cleared. */
  refuse(member: ScriptedRefusalMember, refusal: ThrownRefusal = { kind: 'error' }): this {
    this.refusals.set(member, refusal)
    return this
  }

  allow(member?: ScriptedRefusalMember): this {
    if (member) this.refusals.delete(member)
    else this.refusals.clear()
    return this
  }

  /** Makes a prepare's simulation come back failed with this error until cleared. */
  failSimulation(member: ScriptedSimulation, error: KitError): this {
    this.simulations.set(member, error)
    return this
  }

  clearSimulation(member?: ScriptedSimulation): this {
    if (member) this.simulations.delete(member)
    else this.simulations.clear()
    return this
  }

  /**
   * Appends findings to a validation's own until cleared, so a test forces any
   * validation row: `setup.validateSetup` (read by `validateSetup` and
   * `prepareCommitSetup`) or `recovery.validateRequest` (read by
   * `prepareStartAttempt` and `prepareCancelByProofs`). Appended errors refuse
   * the prepares as the doubles' own errors do.
   */
  appendFindings(member: ScriptedFindings, findings: Partial<ValidationResult>): this {
    const current = this.appended.get(member) ?? { errors: [], warnings: [] }
    this.appended.set(member, {
      errors: [...current.errors, ...(findings.errors ?? [])],
      warnings: [...current.warnings, ...(findings.warnings ?? [])]
    })
    return this
  }

  clearFindings(member?: ScriptedFindings): this {
    if (member) this.appended.delete(member)
    else this.appended.clear()
    return this
  }

  appendedFindings(member: ScriptedFindings): ValidationResult {
    const appended = this.appended.get(member)
    return { errors: [...(appended?.errors ?? [])], warnings: [...(appended?.warnings ?? [])] }
  }

  /** Clears every script: reads, refusals, simulations and the approving side's answers. */
  clearScripts(): this {
    this.readScripts.clear()
    this.refusals.clear()
    this.simulations.clear()
    this.appended.clear()
    this.replyFailure = undefined
    this.enrollFailure = undefined
    this.verdict = undefined
    this.addRefusal = undefined
    this.unmetBindings.clear()
    return this
  }

  /** Throws where a script fails this read (for this module, where given). */
  guard(read: ScriptedRead, module?: Address): void {
    const script = this.readScript(read, module)
    if (script && script.mode === 'throw') {
      throw this.failureOf(read, script)
    }
  }

  /** Whether a module read is scripted to come back unanswered; throws where scripted to throw. */
  unanswered(read: ModuleRead, module: Address): boolean {
    const script = this.readScript(read, module)
    if (!script) return false
    if (script.mode === 'throw') throw this.failureOf(read, script)
    return true
  }

  private failureOf(read: ScriptedRead, script: ReadScript): Error {
    return script.error ?? new ScriptedReadFailure(read)
  }

  private readScript(read: ScriptedRead, module?: Address): ReadScript | undefined {
    const scripts = this.readScripts.get(read) ?? []
    return scripts.find((s) => !s.module || (module && sameAddress(s.module, module)))
  }

  /** Throws the scripted refusal of a member, where one stands. */
  guardRefusal(member: ScriptedRefusalMember): void {
    const refusal = this.refusals.get(member)
    if (refusal) throw thrownValueOf(member, refusal)
  }

  simulationFailure(member: ScriptedSimulation): KitError | undefined {
    return this.simulations.get(member)
  }

  // -------------------------------------------------------------------------
  // Landing prepared calls
  // -------------------------------------------------------------------------

  /** Records what landing a prepared call's data does (the doubles' parts call it). */
  registerEffect(data: Hex, effect: ChainEffect): void {
    this.effects.set(data.toLowerCase(), effect)
  }

  effectOf(data: Hex): ChainEffect | undefined {
    return this.effects.get(data.toLowerCase())
  }

  /** What the chain would revert one effect with at the head, or undefined. */
  revertOf(effect: ChainEffect): KitError | undefined {
    const { account, action } = this
    switch (effect.kind) {
      case 'commit':
        if (effect.setupCommitment === ZERO_HASH) {
          return kitError('InvalidCommitment', { supplied: effect.setupCommitment })
        }
        if (effect.nonce !== this.setup.setupNonce + 1n) {
          return kitError('WrongSetupNonce', {
            supplied: effect.nonce,
            expected: this.setup.setupNonce + 1n
          })
        }
        return undefined
      case 'clear':
        return this.setup.status === 'committed'
          ? undefined
          : kitError('NoSetup', { account, action })
      case 'start':
      case 'cancel-by-proofs':
        return acceptanceRevert(this, effect.request)
      case 'cancel-by-owner':
        return this.attempt.status === 'waiting'
          ? undefined
          : kitError('NoActiveAttempt', { account, action })
      case 'cancel-by-veto': {
        if (this.attempt.status !== 'waiting')
          return kitError('NoActiveAttempt', { account, action })
        const { record } = this.attempt
        // A veto names the attempt it was prepared for; it never ends a later one.
        if (record.attemptId !== effect.attemptId) {
          return kitError('WrongAttemptId', {
            supplied: effect.attemptId,
            expected: record.attemptId
          })
        }
        if (!record.usedMethods.some((m) => sameAddress(m, effect.method))) {
          return kitError('MethodNotUsed', { attemptId: record.attemptId, method: effect.method })
        }
        if (record.ignoresPause)
          return kitError('AttemptIgnoresPause', { attemptId: record.attemptId })
        if (this.method(effect.method)?.paused !== true) {
          return kitError('MethodNotStopped', { method: effect.method })
        }
        return undefined
      }
      case 'execute':
        return executeRevert(this, effect.attemptId, effect.payload)
      default:
        return undefined
    }
  }

  /**
   * Lands a prepared call or batch as if the integrator sent it, applying each
   * call's effect in order. It ignores the prepare's simulation and judges the
   * chain as it stands now: where the chain would revert any call, it throws a
   * `LandingRevert` carrying the kit error and applies nothing, since a batch
   * lands whole or not at all. A dormant setup or an account the action does not
   * fit therefore never executes. A call the doubles did not prepare changes
   * nothing.
   */
  land(prepared: PreparedCall | PreparedBatch): void {
    const calls = prepared.kind === 'batch' ? prepared.calls : [prepared]
    calls.forEach((call) => {
      const effect = this.effectOf(call.data)
      const revert = effect ? this.revertOf(effect) : undefined
      if (revert) throw landingRevert(revert)
    })
    calls.forEach((call) => {
      const effect = this.effectOf(call.data)
      if (!effect) return
      switch (effect.kind) {
        case 'arm':
          this.setAuthorized(true)
          break
        case 'disarm':
          this.setAuthorized(false)
          break
        case 'commit':
          this.commitRaw(effect)
          break
        case 'clear':
          this.clearSetup()
          break
        case 'start': {
          const { request } = effect
          let body: { wait: bigint; ignoresPause: boolean } | undefined
          try {
            body = readSetupBody(request.setupBody)
          } catch {
            body = undefined
          }
          this.openAttempt({
            attemptId: request.attemptId,
            setupNonce: request.setupNonce,
            setupBody: request.setupBody,
            payload: request.payload,
            order: request.order,
            usedPlaces: request.proofs.map((p) => p.place),
            usedMethods: request.proofs
              .map((p) => p.method)
              .filter((m, i, all) => all.findIndex((x) => sameAddress(x, m)) === i),
            wait: body ? Number(body.wait) : undefined,
            ignoresPause: body?.ignoresPause
          })
          break
        }
        case 'cancel-by-owner':
          this.cancelAttempt('account')
          break
        case 'cancel-by-proofs':
          this.cancelAttempt('proofs', { usedPlaces: effect.request.proofs.map((p) => p.place) })
          break
        case 'cancel-by-veto':
          this.cancelAttempt('nobody', { vetoingMethod: effect.method })
          break
        case 'execute':
          this.executeAttempt(decodeHandover(this, effect.payload))
          break
        default:
          break
      }
    })
  }
}
