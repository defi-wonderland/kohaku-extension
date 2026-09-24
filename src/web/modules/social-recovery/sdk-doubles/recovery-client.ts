/**
 * The `IRecoveryClient` double (sdk.md D-201, D-202, D-207): the two gathering
 * inits over the restore, the four record operations as pure arithmetic over the
 * gathering (requests, filing with its five refusals, assessment, completion),
 * the five prepares with request validation (D-205) and simulation, and the
 * recovery-side state record.
 *
 * Validation refuses at the prepare; the simulation then runs the chain's own
 * path (`verification.ts`): `ProofRejected(place, method)` for a proof that is
 * not `doubleProof(config, digest)`, `MethodStopped` for a stop that landed after
 * the reads validation made, the execute's account reverts for a dormant setup or
 * an account the action does not fit, unless a script fails it outright.
 */
import type {
  AddResult,
  Address,
  ApproverReply,
  ApproverRequest,
  Assessment,
  Attempt,
  AttemptRequest,
  BlockHeader,
  CancelRequest,
  Configuration,
  ConfigurationSource,
  DescribedCall,
  Finding,
  Gathering,
  GatheringPlace,
  GatheringWindow,
  Handover,
  HandoverInput,
  Hex,
  IEventManager,
  IRecoveryClient,
  KitError,
  PaymentOrder,
  PreparedCall,
  PrepareOptions,
  ProofPlace,
  RecoveryState,
  RequestErrorCode,
  RequestWarningCode
} from '@web/modules/social-recovery/sdk-interfaces'

import { ClientContext, codecFor, pinBlock, restoreConfiguration } from './context'
import {
  deserializeOrder,
  digestOf,
  keccak256,
  placesOf,
  readSetupBody,
  sameAddress,
  serializeOrder,
  setupBodyOf,
  setupCommitmentOf,
  ZERO_ADDRESS
} from './encoding'
import { RECORD_VERSION } from './orchestrator'
import { composeCall, shouldSimulate, simulationFrom, withSimulation } from './prepared'
import { codedError, finding, validationRefusal } from './scripts'
import { acceptanceRevert, evaluateRule, executeRevert } from './verification'

/** How far a caller's moment may sit from the pinned timestamp before `request.moment-skew` (the doubles' span). */
export const MOMENT_SKEW_SPAN = 15 * 60

type RequestFinding = Finding<RequestErrorCode | RequestWarningCode>
type RequestRow = [RequestErrorCode, Record<string, unknown>?]

/** Every request row of D-205's table carries the subject `request`. */
const rowsToFindings = (rows: RequestRow[]): Finding[] =>
  rows.map(([code, values]) => finding(code, 'request', values ?? {}))

const refuseWith = (...rows: RequestRow[]): never => {
  throw validationRefusal({ errors: rowsToFindings(rows), warnings: [] })
}

const readsGathering = (g: Gathering): boolean =>
  !!g && g.kind === 'gathering' && g.version === RECORD_VERSION

const isText = (value: unknown): value is string => typeof value === 'string'
const isHexText = (value: unknown): value is Hex => isText(value) && /^0x[0-9a-fA-F]*$/.test(value)

/**
 * Whether a pasted reply has the record's shape: every field present with its
 * type. A reply that does not is one this build does not read, refused as
 * `version-unread`, never thrown (D-207).
 */
const replyReadable = (reply: unknown): reply is ApproverReply => {
  if (!reply || typeof reply !== 'object') return false
  const r = reply as Record<string, unknown>
  return (
    r.kind === 'recovery-proof-reply' &&
    r.version === RECORD_VERSION &&
    isText(r.chainId) &&
    isHexText(r.manager) &&
    isHexText(r.account) &&
    isHexText(r.action) &&
    isText(r.attemptId) &&
    (r.purpose === 'approval' || r.purpose === 'cancellation') &&
    typeof r.place === 'number' &&
    Number.isInteger(r.place) &&
    isHexText(r.method) &&
    isHexText(r.config) &&
    isHexText(r.salt) &&
    isHexText(r.digest) &&
    isHexText(r.proof)
  )
}

const digestForPlace = (g: Gathering, place: GatheringPlace): Hex =>
  digestOf({
    chainId: g.request.chainId,
    manager: g.request.manager,
    digestVersion: g.request.digestVersion,
    purpose: g.purpose,
    account: g.request.account,
    action: g.request.action,
    attemptId: g.request.attemptId,
    setupNonce: g.request.setupNonce,
    setupBodyHash: keccak256(g.request.setupBody),
    payload: g.request.payload,
    order: g.request.order,
    validUntil: g.request.validUntil,
    place: place.place
  })

type SimulatedMember =
  | 'recovery.prepareStartAttempt'
  | 'recovery.prepareCancelByProofs'
  | 'recovery.prepareCancelByOwner'
  | 'recovery.prepareCancelByVeto'
  | 'recovery.prepareExecuteHandover'

export class RecoveryClientDouble implements IRecoveryClient {
  readonly events: IEventManager

  constructor(private readonly ctx: ClientContext) {
    this.events = ctx.events
  }

  // -------------------------------------------------------------------------
  // The two inits
  // -------------------------------------------------------------------------

  private async placeMap(configuration: Configuration): Promise<GatheringPlace[]> {
    const { chain, manager } = this.ctx
    const placed = placesOf(chain.account, configuration)
    return Promise.all(
      placed.map(async ({ place, credential, salt }) => {
        const [paused, parties] = await Promise.all([
          manager.paused(credential.method),
          manager.trustedParties(credential.method)
        ])
        const entry: GatheringPlace = {
          place,
          method: credential.method,
          config: credential.config,
          salt,
          standing: paused.answered && paused.value ? 'stopped' : 'not-stopped',
          stoppable: parties.answered && !sameAddress(parties.value.pauseHolder, ZERO_ADDRESS)
        }
        if (credential.label) entry.label = credential.label
        return entry
      })
    )
  }

  private requestBlock(block: BlockHeader) {
    const { chain, actionAddress } = this.ctx
    return {
      chainId: String(chain.descriptor.chainId),
      manager: chain.descriptor.manager,
      // The digest version this build carries, from the descriptor the build was
      // checked against; never read from the chain live (D-202, D-208).
      digestVersion: chain.descriptor.digestVersion,
      account: chain.account,
      action: actionAddress,
      block: { number: block.number, timestamp: String(block.timestamp), hash: block.hash }
    }
  }

  /** The handover rows of D-205 over two authorities (zero keys, one address twice, the reads). */
  private async handoverRows(handover: Handover): Promise<RequestRow[]> {
    const { action } = this.ctx
    const { newAuthority, removedAuthority } = handover
    if (sameAddress(newAuthority, ZERO_ADDRESS) || sameAddress(removedAuthority, ZERO_ADDRESS)) {
      return [['handover.malformed', { newAuthority, removedAuthority, cause: 'zero-key' }]]
    }
    if (sameAddress(newAuthority, removedAuthority)) {
      return [['handover.same-authority', { newAuthority, removedAuthority }]]
    }
    const rows: RequestRow[] = []
    const [isAuthority, holds] = await Promise.all([
      action.isAuthority(removedAuthority),
      action.holdsAnyPrivilege(newAuthority)
    ])
    if (!isAuthority) {
      rows.push(['handover.removed-not-authority', { removedAuthority, isAuthority }])
    }
    if (holds)
      rows.push(['handover.new-holds-privilege', { newAuthority, holdsAnyPrivilege: holds }])
    return rows
  }

  async initRecoveryGathering(
    source: ConfigurationSource,
    handover: HandoverInput,
    order: PaymentOrder,
    window: GatheringWindow
  ): Promise<Gathering> {
    const { chain, manager, config, actionAddress } = this.ctx
    chain.guardRefusal('recovery.initRecoveryGathering')
    const block = await pinBlock(this.ctx)
    const state = await manager.stateOf()
    if (state.attempt.state === 'Waiting') {
      refuseWith([
        'request.attempt-active',
        {
          attemptId: state.attempt.attemptId,
          consumableAfter: state.attempt.consumableAfter,
          ownGathering: false
        }
      ])
    }
    const configuration = await restoreConfiguration(this.ctx, source, block)

    let removedAuthority = handover.removedAuthority
    if (!removedAuthority) {
      const reading = chain.removedKeyReading(!!config.creation)
      if (reading.kind === 'unavailable') {
        refuseWith([
          'handover.removed-unknown',
          { account: chain.account, creationTriple: !!config.creation, cause: reading.cause }
        ])
      } else removedAuthority = reading.key
    }
    const performed: Handover = {
      newAuthority: handover.newAuthority,
      removedAuthority: removedAuthority as Address
    }
    const rows = await this.handoverRows(performed)
    if (rows.length) refuseWith(...rows)

    const codec = codecFor(this.ctx, actionAddress)
    if (!codec) throw codedError('action.no-codec', { action: actionAddress })
    const payload = codec.encode(performed)

    return {
      kind: 'gathering',
      version: RECORD_VERSION,
      purpose: 'approval',
      request: {
        ...this.requestBlock(block),
        attemptId: state.nextAttemptId.toString(),
        setupNonce: state.setupNonce.toString(),
        setupBody: setupBodyOf(chain.account, configuration),
        payload,
        order: serializeOrder(order),
        validUntil: String(block.timestamp + window.window)
      },
      places: await this.placeMap(configuration),
      replies: []
    }
  }

  async initCancelGathering(
    source: ConfigurationSource,
    window: GatheringWindow
  ): Promise<Gathering> {
    const { chain, manager, actionAddress } = this.ctx
    chain.guardRefusal('recovery.initCancelGathering')
    const block = await pinBlock(this.ctx)
    const state = await manager.stateOf()
    if (state.attempt.state !== 'Waiting') {
      refuseWith([
        'request.no-active-attempt',
        { action: actionAddress, state: state.attempt.state }
      ])
    }
    const configuration = await restoreConfiguration(this.ctx, source, block)
    return {
      kind: 'gathering',
      version: RECORD_VERSION,
      purpose: 'cancellation',
      request: {
        ...this.requestBlock(block),
        attemptId: state.attempt.attemptId.toString(),
        setupNonce: state.setupNonce.toString(),
        setupBody: setupBodyOf(chain.account, configuration),
        validUntil: String(block.timestamp + window.window),
        consumableAfter: String(state.attempt.consumableAfter)
      },
      places: await this.placeMap(configuration),
      replies: []
    }
  }

  // -------------------------------------------------------------------------
  // The four record operations
  // -------------------------------------------------------------------------

  getApproverRequests(gathering: Gathering): ApproverRequest[] {
    if (!readsGathering(gathering)) {
      throw codedError('version-unread', { kind: gathering?.kind, version: gathering?.version })
    }
    const r = gathering.request
    const setupBodyHash = keccak256(r.setupBody)
    return gathering.places.map((p) => {
      const request: ApproverRequest = {
        kind: 'recovery-proof-request',
        version: RECORD_VERSION,
        purpose: gathering.purpose,
        chainId: r.chainId,
        manager: r.manager,
        digestVersion: r.digestVersion,
        account: r.account,
        action: r.action,
        attemptId: r.attemptId,
        setupNonce: r.setupNonce,
        setupBodyHash,
        validUntil: r.validUntil,
        place: p.place,
        method: p.method,
        config: p.config,
        salt: p.salt
      }
      if (gathering.purpose === 'approval') {
        request.payload = r.payload
        request.order = r.order
      }
      return request
    })
  }

  addApproverReply(gathering: Gathering, reply: ApproverReply): AddResult {
    const refuse = (cause: NonNullable<AddResult['reason']>['cause']): AddResult => ({
      gathering,
      reason: { kind: 'add-refusal', cause }
    })
    if (this.ctx.chain.addRefusal) return refuse(this.ctx.chain.addRefusal)
    // The shape first: a malformed paste is refused, never thrown (D-207).
    if (!readsGathering(gathering) || !replyReadable(reply)) return refuse('version-unread')
    const r = gathering.request
    const bound =
      reply.chainId === r.chainId &&
      sameAddress(reply.manager, r.manager) &&
      sameAddress(reply.account, r.account) &&
      sameAddress(reply.action, r.action) &&
      reply.attemptId === r.attemptId &&
      reply.purpose === gathering.purpose
    if (!bound) return refuse('binding-mismatch')
    const place = gathering.places.find((p) => p.place === reply.place)
    if (!place) return refuse('place-unknown')
    if (
      !sameAddress(place.method, reply.method) ||
      place.config.toLowerCase() !== reply.config.toLowerCase() ||
      place.salt.toLowerCase() !== reply.salt.toLowerCase()
    ) {
      return refuse('credential-mismatch')
    }
    if (digestForPlace(gathering, place).toLowerCase() !== reply.digest.toLowerCase()) {
      return refuse('digest-mismatch')
    }
    const displaced = gathering.replies.find((x) => x.place === reply.place)
    const next: Gathering = {
      ...gathering,
      replies: [...gathering.replies.filter((x) => x.place !== reply.place), { ...reply }]
    }
    return displaced ? { gathering: next, displaced } : { gathering: next }
  }

  assess(gathering: Gathering, now: number): Assessment {
    if (!readsGathering(gathering)) {
      throw codedError('version-unread', { kind: gathering?.kind, version: gathering?.version })
    }
    const r = gathering.request
    const filledSet = new Set(gathering.replies.map((x) => x.place))
    const all = gathering.places.map((p) => p.place)
    const filled = all.filter((p) => filledSet.has(p)).sort((a, b) => a - b)
    const missing = all.filter((p) => !filledSet.has(p)).sort((a, b) => a - b)
    // One evaluation, D-204's: false for no clauses and for every threshold at zero.
    const rule = evaluateRule(r.setupBody, filled)
    const clauses = rule.clauses.map(({ clause, threshold, filled: count }) => ({
      clause,
      threshold,
      filled: count
    }))
    const findings: RequestFinding[] = []
    const validUntil = Number(r.validUntil)
    const pinned = Number(r.block.timestamp)
    if (now > validUntil) findings.push(finding('request.expired', 'request', { validUntil, now }))
    const floor = this.ctx.config.requestWindow?.floor ?? 3600
    if (validUntil - pinned < floor) {
      findings.push(
        finding('request.window-short', 'request', { window: validUntil - pinned, floor })
      )
    }
    if (Math.abs(now - pinned) > MOMENT_SKEW_SPAN) {
      findings.push(
        finding('request.moment-skew', 'request', { now, pinned, span: MOMENT_SKEW_SPAN })
      )
    }
    if (
      gathering.purpose === 'cancellation' &&
      r.consumableAfter &&
      validUntil > Number(r.consumableAfter)
    ) {
      findings.push(
        finding('cancel.window-late', 'request', {
          validUntil,
          consumableAfter: Number(r.consumableAfter)
        })
      )
    }
    return { filled, missing, clauses, ruleSatisfied: rule.satisfied, findings }
  }

  complete(
    gathering: Gathering,
    selection: number[] | undefined,
    now: number
  ): AttemptRequest | CancelRequest {
    this.ctx.chain.guardRefusal('recovery.complete')
    if (!readsGathering(gathering)) {
      throw codedError('version-unread', { kind: gathering?.kind, version: gathering?.version })
    }
    const r = gathering.request
    if (now > Number(r.validUntil)) {
      refuseWith(['request.expired', { validUntil: Number(r.validUntil), now }])
    }
    const byPlace = new Map(gathering.places.map((p) => [p.place, p]))
    const filedOrder = new Map(gathering.replies.map((x, i) => [x.place, i]))
    const whole = evaluateRule(r.setupBody, [...filedOrder.keys()])
    if (!whole.satisfied) {
      refuseWith(['request.rule-unsatisfied', { clause: whole.failingClause }])
    }

    let chosen: number[]
    if (selection) {
      chosen = [...new Set(selection)]
      const picked = evaluateRule(r.setupBody, chosen)
      if (!chosen.every((p) => filedOrder.has(p)) || !picked.satisfied) {
        refuseWith([
          'request.rule-unsatisfied',
          { selection: chosen, clause: picked.failingClause }
        ])
      }
    } else {
      // Per clause: no stopped method first, then fewest stoppable, then earliest filed (D-207).
      chosen = whole.clauses.flatMap((c) =>
        c.places
          .filter((p) => filedOrder.has(p))
          .sort((a, b) => {
            const pa = byPlace.get(a) as GatheringPlace
            const pb = byPlace.get(b) as GatheringPlace
            const stopped = Number(pa.standing === 'stopped') - Number(pb.standing === 'stopped')
            const stoppable = Number(pa.stoppable) - Number(pb.stoppable)
            return (
              stopped || stoppable || (filedOrder.get(a) as number) - (filedOrder.get(b) as number)
            )
          })
          .slice(0, c.threshold)
      )
    }
    const proofs: ProofPlace[] = [...chosen]
      .sort((a, b) => a - b)
      .map((p) => {
        const reply = gathering.replies.find((x) => x.place === p) as ApproverReply
        return {
          place: BigInt(p),
          method: reply.method,
          config: reply.config,
          salt: reply.salt,
          proof: reply.proof
        }
      })
    const common = {
      account: r.account,
      action: r.action,
      attemptId: BigInt(r.attemptId),
      setupNonce: BigInt(r.setupNonce),
      setupBody: r.setupBody,
      validUntil: Number(r.validUntil),
      proofs
    }
    if (gathering.purpose === 'cancellation') return common
    return {
      ...common,
      payload: r.payload ?? '0x',
      order: r.order
        ? deserializeOrder(r.order)
        : { token: ZERO_ADDRESS, amount: 0n, payee: ZERO_ADDRESS }
    }
  }

  // -------------------------------------------------------------------------
  // Request validation (D-205) and the prepares
  // -------------------------------------------------------------------------

  /**
   * The request validation the two submission prepares run (D-205): the stored
   * attempt and setup, the window, the order of places, the rule over the proof
   * array, each named method's stop, and on an opening request the handover.
   * Returns the errors; the prepare refuses while any stands.
   */
  private async validateRequest(
    request: AttemptRequest | CancelRequest,
    now: number
  ): Promise<Finding[]> {
    const { chain, manager } = this.ctx
    const isApproval = 'payload' in request
    const state = await manager.stateOf()
    const rows: RequestRow[] = []
    if (now > request.validUntil)
      rows.push(['request.expired', { validUntil: request.validUntil, now }])
    if (isApproval) {
      if (state.attempt.state === 'Waiting') {
        rows.push([
          'request.attempt-active',
          {
            attemptId: state.attempt.attemptId,
            consumableAfter: state.attempt.consumableAfter,
            ownGathering: state.attempt.attemptId === request.attemptId
          }
        ])
      } else if (request.attemptId !== state.nextAttemptId) {
        rows.push([
          'request.attempt-id',
          { attemptId: request.attemptId, expected: state.nextAttemptId }
        ])
      }
    } else if (state.attempt.state !== 'Waiting') {
      rows.push([
        'request.no-active-attempt',
        { action: request.action, state: state.attempt.state }
      ])
    } else {
      if (request.attemptId !== state.attempt.attemptId) {
        rows.push([
          'request.attempt-id',
          { attemptId: request.attemptId, expected: state.attempt.attemptId }
        ])
      }
      if (state.attempt.setupNonce !== state.setupNonce) {
        rows.push([
          'request.stale-attempt',
          { judgedUnder: state.attempt.setupNonce, currentNonce: state.setupNonce }
        ])
      }
    }
    const recomputed = setupCommitmentOf(
      chain.account,
      request.action,
      request.setupNonce,
      request.setupBody
    )
    if (request.setupNonce !== state.setupNonce || recomputed !== state.setupCommitment) {
      rows.push(['request.body-mismatch', { recomputed, committed: state.setupCommitment }])
    }
    for (let i = 1; i < request.proofs.length; i++) {
      if (request.proofs[i].place <= request.proofs[i - 1].place) {
        rows.push(['proof.places-unordered', { place: request.proofs[i].place }])
        break
      }
    }
    const rule = evaluateRule(
      request.setupBody,
      request.proofs.map((p) => Number(p.place))
    )
    if (!rule.satisfied) {
      const failing = rule.clauses.find((c) => c.clause === rule.failingClause)
      rows.push([
        'request.rule-unsatisfied',
        { clause: rule.failingClause, filled: failing?.filled, threshold: failing?.threshold }
      ])
    }
    let ignoresPause = false
    try {
      ignoresPause = readSetupBody(request.setupBody).ignoresPause
    } catch {
      ignoresPause = false
    }
    if (!ignoresPause) {
      const stops = await Promise.all(request.proofs.map((p) => manager.paused(p.method)))
      request.proofs.forEach((p, i) => {
        const stop = stops[i]
        if (stop.answered && stop.value) {
          rows.push(['request.method-stopped', { place: p.place, method: p.method, ignoresPause }])
        }
      })
    }
    if (isApproval) {
      const codec = codecFor(this.ctx, request.action)
      let handover: Handover | undefined
      try {
        handover = codec?.decode((request as AttemptRequest).payload) as Handover | undefined
      } catch {
        handover = undefined
      }
      if (!handover) {
        rows.push([
          'handover.malformed',
          { payload: (request as AttemptRequest).payload, cause: 'undecodable' }
        ])
      } else {
        rows.push(...(await this.handoverRows(handover)))
      }
    }
    return [...rowsToFindings(rows), ...chain.appendedFindings('recovery.validateRequest').errors]
  }

  private finish(
    call: PreparedCall,
    member: SimulatedMember,
    block: BlockHeader,
    options: PrepareOptions | undefined,
    computed: KitError | undefined
  ): PreparedCall {
    const { chain, config } = this.ctx
    const pinned = { ...call, block: { number: block.number, hash: block.hash } }
    if (!shouldSimulate(options, config.simulate)) return pinned
    const error = chain.simulationFailure(member) ?? computed
    return withSimulation(pinned, simulationFrom(chain, call.sender, options), error)
  }

  async prepareStartAttempt(
    request: AttemptRequest,
    now: number,
    options?: PrepareOptions
  ): Promise<PreparedCall> {
    this.ctx.chain.guardRefusal('recovery.prepareStartAttempt')
    const block = await pinBlock(this.ctx)
    const errors = await this.validateRequest(request, now)
    if (errors.length) throw validationRefusal({ errors, warnings: [] })
    const call = await this.ctx.manager.prepareStartAttempt(request)
    return this.finish(
      call,
      'recovery.prepareStartAttempt',
      block,
      options,
      acceptanceRevert(this.ctx.chain, request)
    )
  }

  async prepareCancelByProofs(
    request: CancelRequest,
    now: number,
    options?: PrepareOptions
  ): Promise<PreparedCall> {
    this.ctx.chain.guardRefusal('recovery.prepareCancelByProofs')
    const block = await pinBlock(this.ctx)
    const errors = await this.validateRequest(request, now)
    if (errors.length) throw validationRefusal({ errors, warnings: [] })
    const call = await this.ctx.manager.prepareCancelByProofs(request)
    return this.finish(
      call,
      'recovery.prepareCancelByProofs',
      block,
      options,
      acceptanceRevert(this.ctx.chain, request)
    )
  }

  async prepareCancelByOwner(): Promise<PreparedCall> {
    const { chain, manager, actionAddress } = this.ctx
    chain.guardRefusal('recovery.prepareCancelByOwner')
    const block = await pinBlock(this.ctx)
    const call = await manager.prepareCancelByOwner(actionAddress)
    return this.finish(
      call,
      'recovery.prepareCancelByOwner',
      block,
      undefined,
      chain.revertOf({ kind: 'cancel-by-owner' })
    )
  }

  async prepareCancelByVeto(method: Address, options?: PrepareOptions): Promise<PreparedCall> {
    const { chain, manager, actionAddress } = this.ctx
    chain.guardRefusal('recovery.prepareCancelByVeto')
    const block = await pinBlock(this.ctx)
    const state = await manager.stateOf()
    if (state.attempt.state !== 'Waiting') {
      refuseWith([
        'request.no-active-attempt',
        { action: actionAddress, state: state.attempt.state }
      ])
    }
    const call = await manager.prepareCancelByVeto(
      chain.account,
      actionAddress,
      state.attempt.attemptId,
      method
    )
    return this.finish(
      call,
      'recovery.prepareCancelByVeto',
      block,
      options,
      chain.revertOf({ kind: 'cancel-by-veto', method })
    )
  }

  async prepareExecuteHandover(
    attempt: Attempt,
    payload: Hex,
    options?: PrepareOptions
  ): Promise<PreparedCall> {
    const { chain, actionAddress } = this.ctx
    chain.guardRefusal('recovery.prepareExecuteHandover')
    const block = await pinBlock(this.ctx)
    const codec = codecFor(this.ctx, actionAddress)
    let handover: Handover | undefined
    try {
      handover = codec?.decode(payload) as Handover | undefined
    } catch {
      handover = undefined
    }
    const describe = (name: string, args: unknown, to: Address): DescribedCall => ({
      to,
      value: 0n,
      data: composeCall(chain, { name, args, target: to, sender: 'anyone', block }).data
    })
    // The batch the action will run, for a screen and never for signing: the
    // consume, the grant and the revoke the payload decodes to, and the payment
    // where the order carries an amount. An undecodable payload describes no
    // grant and no revoke, and its simulation names `MalformedHandover`.
    const describes: DescribedCall[] = [
      describe('consume', [attempt.attemptId], chain.descriptor.manager)
    ]
    if (handover) {
      describes.push(describe('setAddrPrivilege', [handover.newAuthority, 'key'], chain.account))
      describes.push(
        describe('setAddrPrivilege', [handover.removedAuthority, 'none'], chain.account)
      )
    }
    if (attempt.order.amount > 0n) {
      const payee = sameAddress(attempt.order.payee, ZERO_ADDRESS)
        ? simulationFrom(chain, 'anyone', options)
        : attempt.order.payee
      describes.push(describe('transfer', [payee, attempt.order.amount], attempt.order.token))
    }
    const call = composeCall(chain, {
      name: 'executeHandover',
      args: [chain.account, payload],
      target: actionAddress,
      sender: 'anyone',
      block,
      effect: { kind: 'execute', attemptId: attempt.attemptId, payload },
      describes
    })
    return this.finish(
      call,
      'recovery.prepareExecuteHandover',
      block,
      options,
      executeRevert(chain, attempt.attemptId, payload)
    )
  }

  // -------------------------------------------------------------------------
  // The recovery-side state record
  // -------------------------------------------------------------------------

  async recoveryState(): Promise<RecoveryState> {
    const { chain, manager, config } = this.ctx
    chain.guard('recovery.recoveryState')
    const block = await pinBlock(this.ctx)
    const state = await manager.stateOf()
    const removed = chain.removedKeyReading(!!config.creation)
    return {
      attempt: state.attempt,
      nextAttemptId: state.nextAttemptId,
      setupCommitment: state.setupCommitment,
      setupNonce: state.setupNonce,
      // The frozen record has no value for a replay that names none or several; see README.
      removedKey: removed.kind === 'named' ? removed.key : 'no-creation-triple',
      block
    }
  }
}
