/**
 * The `IRecoveryClient` double (sdk.md D-201, D-202, D-207): the two gathering
 * inits over the restore, the four record operations as pure arithmetic over the
 * gathering (requests, filing with its five refusals, assessment, completion),
 * the five prepares with their validation and simulation, and the recovery-side
 * state record.
 *
 * The simulation stands in for the manager's own verification path: a proof
 * that is not `doubleProof(config, digest)` comes back as `ProofRejected(place,
 * method)`, a stopped method's proof as `MethodStopped(place, method)`, unless a
 * script fails the simulation outright.
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
  digestOfSubmission,
  doubleProof,
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
import { finding, kitError, validationRefusal } from './scripts'

/** How far a caller's moment may sit from the pinned timestamp before `request.moment-skew` (the doubles' span). */
export const MOMENT_SKEW_SPAN = 15 * 60

type RequestFinding = Finding<RequestErrorCode | RequestWarningCode>

const refuseWith = (...codes: [RequestErrorCode, Record<string, unknown>?][]): never => {
  throw validationRefusal({
    errors: codes.map(([code, values]) =>
      finding(code, code.startsWith('handover') ? 'account' : 'request', values)
    ),
    warnings: []
  })
}

const readsGathering = (g: Gathering): boolean =>
  g?.kind === 'gathering' && g.version === RECORD_VERSION

/** The clause each place belongs to, from the body's clause sizes (flat numbering, D-103). */
const clausesOfBody = (setupBody: Hex): { threshold: number; places: number[] }[] => {
  const body = readSetupBody(setupBody)
  let next = 0
  return body.clauses.map((c) => {
    const places = c.credentials.map(() => next++)
    return { threshold: c.threshold, places }
  })
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
    place: place.place,
    method: place.method,
    config: place.config,
    salt: place.salt
  })

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
      // The domain version the build cached at construction, never re-read here (D-202).
      digestVersion: chain.manager.domain.version,
      account: chain.account,
      action: actionAddress,
      block: { number: block.number, timestamp: String(block.timestamp), hash: block.hash }
    }
  }

  async initRecoveryGathering(
    source: ConfigurationSource,
    handover: HandoverInput,
    order: PaymentOrder,
    window: GatheringWindow
  ): Promise<Gathering> {
    const { chain, manager, action, config, actionAddress } = this.ctx
    chain.guardRefusal('recovery.initRecoveryGathering')
    const block = await pinBlock(this.ctx)
    const state = await manager.stateOf()
    if (state.attempt.state === 'Waiting') {
      refuseWith(['request.attempt-active', { attemptId: state.attempt.attemptId }])
    }
    const configuration = await restoreConfiguration(this.ctx, source, block)

    let { removedAuthority } = handover
    if (!removedAuthority) {
      const reading = chain.removedKeyReading(!!config.creation)
      if (reading.kind === 'unavailable')
        refuseWith(['handover.removed-unknown', { cause: reading.cause }])
      else removedAuthority = reading.key
    }
    const removed = removedAuthority as Address
    const errors: [RequestErrorCode, Record<string, unknown>][] = []
    if (sameAddress(handover.newAuthority, removed))
      errors.push(['handover.same-authority', { key: removed }])
    if (!(await action.isAuthority(removed)))
      errors.push(['handover.removed-not-authority', { key: removed }])
    if (await action.holdsAnyPrivilege(handover.newAuthority)) {
      errors.push(['handover.new-holds-privilege', { key: handover.newAuthority }])
    }
    if (errors.length) refuseWith(...errors)

    const codec = codecFor(this.ctx, actionAddress)
    if (!codec) throw new Error(`No action codec serves ${actionAddress}.`)
    const payload = codec.encode({
      newAuthority: handover.newAuthority,
      removedAuthority: removed
    } as Handover)

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
    const { chain, manager } = this.ctx
    chain.guardRefusal('recovery.initCancelGathering')
    const block = await pinBlock(this.ctx)
    const state = await manager.stateOf()
    if (state.attempt.state !== 'Waiting') refuseWith(['request.no-active-attempt'])
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
    if (!readsGathering(gathering))
      throw new Error('version-unread: this build does not read that gathering record.')
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
    if (
      !readsGathering(gathering) ||
      reply?.kind !== 'recovery-proof-reply' ||
      reply.version !== RECORD_VERSION
    ) {
      return refuse('version-unread')
    }
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
    if (!readsGathering(gathering))
      throw new Error('version-unread: this build does not read that gathering record.')
    const r = gathering.request
    const filledSet = new Set(gathering.replies.map((x) => x.place))
    const filled = gathering.places
      .map((p) => p.place)
      .filter((p) => filledSet.has(p))
      .sort((a, b) => a - b)
    const missing = gathering.places
      .map((p) => p.place)
      .filter((p) => !filledSet.has(p))
      .sort((a, b) => a - b)
    const clauses = clausesOfBody(r.setupBody).map((c, clause) => ({
      clause,
      threshold: c.threshold,
      filled: c.places.filter((p) => filledSet.has(p)).length
    }))
    const ruleSatisfied = clauses.length > 0 && clauses.every((c) => c.filled >= c.threshold)
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
      findings.push(finding('request.moment-skew', 'request', { now, pinned }))
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
    return { filled, missing, clauses, ruleSatisfied, findings }
  }

  complete(
    gathering: Gathering,
    selection: number[] | undefined,
    now: number
  ): AttemptRequest | CancelRequest {
    this.ctx.chain.guardRefusal('recovery.complete')
    if (!readsGathering(gathering))
      throw new Error('version-unread: this build does not read that gathering record.')
    const r = gathering.request
    if (now > Number(r.validUntil))
      refuseWith(['request.expired', { validUntil: Number(r.validUntil), now }])
    const clauses = clausesOfBody(r.setupBody)
    const byPlace = new Map(gathering.places.map((p) => [p.place, p]))
    const filedOrder = new Map(gathering.replies.map((x, i) => [x.place, i]))

    let chosen: number[]
    if (selection) {
      chosen = [...new Set(selection)]
      const satisfied =
        chosen.every((p) => filedOrder.has(p)) &&
        clauses.length > 0 &&
        clauses.every((c) => c.places.filter((p) => chosen.includes(p)).length >= c.threshold)
      if (!satisfied) refuseWith(['request.rule-unsatisfied', { selection: chosen }])
    } else {
      // Per clause: no stopped method first, then fewest stoppable, then earliest filed (D-207).
      chosen = []
      const unsatisfied = clauses.length === 0
      clauses.forEach((c) => {
        const candidates = c.places
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
        if (candidates.length < c.threshold) chosen.push(-1)
        chosen.push(...candidates.slice(0, c.threshold))
      })
      if (unsatisfied || chosen.includes(-1)) refuseWith(['request.rule-unsatisfied'])
    }
    const proofs: ProofPlace[] = chosen
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
  // The prepares
  // -------------------------------------------------------------------------

  /** The manager's verification path over the proofs, in the doubles' proof convention. */
  private proofFailure(request: AttemptRequest | CancelRequest): KitError | undefined {
    const { chain } = this.ctx
    const domain = {
      chainId: chain.manager.domain.chainId,
      manager: chain.descriptor.manager,
      digestVersion: chain.manager.domain.version
    }
    let ignoresPause = false
    try {
      ignoresPause = readSetupBody(request.setupBody).ignoresPause
    } catch {
      ignoresPause = false
    }
    for (let i = 0; i < request.proofs.length; i++) {
      const p = request.proofs[i]
      if (i > 0 && p.place <= request.proofs[i - 1].place)
        return kitError('PlacesNotStrictlyIncreasing')
      if (!ignoresPause && chain.method(p.method)?.paused) {
        return kitError('MethodStopped', { place: p.place, method: p.method })
      }
      if (
        p.proof.toLowerCase() !==
        doubleProof(p.config, digestOfSubmission(request, domain, i)).toLowerCase()
      ) {
        return kitError('ProofRejected', { place: p.place, method: p.method })
      }
    }
    return undefined
  }

  private async submissionChecks(
    request: AttemptRequest | CancelRequest,
    now: number,
    purpose: 'approval' | 'cancellation'
  ): Promise<void> {
    const { chain, manager, action } = this.ctx
    const state = await manager.stateOf()
    const errors: [RequestErrorCode, Record<string, unknown>?][] = []
    if (now > request.validUntil)
      errors.push(['request.expired', { validUntil: request.validUntil, now }])
    if (purpose === 'approval') {
      if (state.attempt.state === 'Waiting')
        errors.push(['request.attempt-active', { attemptId: state.attempt.attemptId }])
      else if (request.attemptId !== state.nextAttemptId) {
        errors.push([
          'request.attempt-id',
          { expected: state.nextAttemptId, got: request.attemptId }
        ])
      }
    } else if (state.attempt.state !== 'Waiting') errors.push(['request.no-active-attempt'])
    else if (request.attemptId !== state.attempt.attemptId) {
      errors.push([
        'request.attempt-id',
        { expected: state.attempt.attemptId, got: request.attemptId }
      ])
    }
    const recomputed = setupCommitmentOf(
      chain.account,
      request.action,
      request.setupNonce,
      request.setupBody
    )
    if (request.setupNonce !== state.setupNonce || recomputed !== state.setupCommitment) {
      errors.push(['request.body-mismatch', { setupNonce: state.setupNonce }])
    }
    for (let i = 1; i < request.proofs.length; i++) {
      if (request.proofs[i].place <= request.proofs[i - 1].place) {
        errors.push(['proof.places-unordered'])
        break
      }
    }
    if (purpose === 'approval') {
      const codec = codecFor(this.ctx, request.action)
      try {
        const handover = codec?.decode((request as AttemptRequest).payload) as Handover | undefined
        if (handover && (await action.holdsAnyPrivilege(handover.newAuthority))) {
          errors.push(['handover.new-holds-privilege', { key: handover.newAuthority }])
        }
      } catch {
        errors.push(['handover.malformed'])
      }
    }
    if (errors.length) refuseWith(...errors)
  }

  private finish(
    call: PreparedCall,
    member:
      | 'recovery.prepareStartAttempt'
      | 'recovery.prepareCancelByProofs'
      | 'recovery.prepareCancelByOwner'
      | 'recovery.prepareCancelByVeto'
      | 'recovery.prepareExecuteHandover',
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
    await this.submissionChecks(request, now, 'approval')
    const call = await this.ctx.manager.prepareStartAttempt(request)
    return this.finish(
      call,
      'recovery.prepareStartAttempt',
      block,
      options,
      this.proofFailure(request)
    )
  }

  async prepareCancelByProofs(
    request: CancelRequest,
    now: number,
    options?: PrepareOptions
  ): Promise<PreparedCall> {
    this.ctx.chain.guardRefusal('recovery.prepareCancelByProofs')
    const block = await pinBlock(this.ctx)
    await this.submissionChecks(request, now, 'cancellation')
    const call = await this.ctx.manager.prepareCancelByProofs(request)
    return this.finish(
      call,
      'recovery.prepareCancelByProofs',
      block,
      options,
      this.proofFailure(request)
    )
  }

  async prepareCancelByOwner(): Promise<PreparedCall> {
    this.ctx.chain.guardRefusal('recovery.prepareCancelByOwner')
    const block = await pinBlock(this.ctx)
    const state = await this.ctx.manager.stateOf()
    const call = await this.ctx.manager.prepareCancelByOwner(this.ctx.actionAddress)
    const computed = state.attempt.state === 'Waiting' ? undefined : kitError('NoActiveAttempt')
    return this.finish(call, 'recovery.prepareCancelByOwner', block, undefined, computed)
  }

  async prepareCancelByVeto(method: Address, options?: PrepareOptions): Promise<PreparedCall> {
    const { chain, manager, actionAddress } = this.ctx
    chain.guardRefusal('recovery.prepareCancelByVeto')
    const block = await pinBlock(this.ctx)
    const state = await manager.stateOf()
    if (state.attempt.state !== 'Waiting') refuseWith(['request.no-active-attempt'])
    const { attempt } = state
    const call = await manager.prepareCancelByVeto(
      chain.account,
      actionAddress,
      attempt.attemptId,
      method
    )
    const paused = await manager.paused(method)
    let computed: KitError | undefined
    if (!attempt.usedMethods.some((m) => sameAddress(m, method)))
      computed = kitError('MethodNotUsed', { method })
    else if (attempt.ignoresPause) computed = kitError('AttemptIgnoresPause')
    else if (!(paused.answered && paused.value)) computed = kitError('MethodNotStopped', { method })
    return this.finish(call, 'recovery.prepareCancelByVeto', block, options, computed)
  }

  async prepareExecuteHandover(
    attempt: Attempt,
    payload: Hex,
    options?: PrepareOptions
  ): Promise<PreparedCall> {
    const { chain, manager, actionAddress } = this.ctx
    chain.guardRefusal('recovery.prepareExecuteHandover')
    const block = await pinBlock(this.ctx)
    const codec = codecFor(this.ctx, actionAddress)
    let handover: Handover
    try {
      handover = codec?.decode(payload) as Handover
      if (!handover) throw new Error('no codec')
    } catch {
      return refuseWith(['handover.malformed'])
    }
    const describes: DescribedCall[] = [
      { to: chain.descriptor.manager, value: 0n, data: '0x' },
      { to: chain.account, value: 0n, data: '0x' },
      { to: chain.account, value: 0n, data: '0x' }
    ]
    describes[0].data = composeCall(chain, {
      name: 'consume',
      args: [attempt.attemptId],
      target: chain.descriptor.manager,
      sender: 'anyone',
      block
    }).data
    describes[1].data = composeCall(chain, {
      name: 'setAddrPrivilege',
      args: [handover.newAuthority, 'key'],
      target: chain.account,
      sender: 'anyone',
      block
    }).data
    describes[2].data = composeCall(chain, {
      name: 'setAddrPrivilege',
      args: [handover.removedAuthority, 'none'],
      target: chain.account,
      sender: 'anyone',
      block
    }).data
    if (attempt.order.amount > 0n) {
      const payee = sameAddress(attempt.order.payee, ZERO_ADDRESS)
        ? simulationFrom(chain, 'anyone', options)
        : attempt.order.payee
      describes.push({
        to: attempt.order.token,
        value: 0n,
        data: composeCall(chain, {
          name: 'transfer',
          args: [payee, attempt.order.amount],
          target: attempt.order.token,
          sender: 'anyone',
          block
        }).data
      })
    }
    const call = composeCall(chain, {
      name: 'executeHandover',
      args: [chain.account, payload],
      target: actionAddress,
      sender: 'anyone',
      block,
      effect: { kind: 'execute' },
      describes
    })
    const state = await manager.stateOf()
    const live = state.attempt
    let computed: KitError | undefined
    if (
      live.state !== 'Waiting' ||
      live.attemptId !== attempt.attemptId ||
      live.consumableAfter > block.timestamp ||
      keccak256(payload) !== live.payloadHash
    ) {
      computed = kitError('NotConsumable', { attemptId: attempt.attemptId }, 'action')
    } else if (!live.ignoresPause) {
      const stopped = live.usedMethods.find((m) => chain.method(m)?.paused)
      if (stopped) computed = kitError('MethodVetoedSpend', { method: stopped })
    }
    return this.finish(call, 'recovery.prepareExecuteHandover', block, options, computed)
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
