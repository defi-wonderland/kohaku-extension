import { addressOf, type CodedError } from '@web/modules/social-recovery/sdk-doubles'
import {
  ADD_REFUSAL_REASONS,
  type AddRefusalReason,
  type ApproverReply,
  type ApproverRequest,
  type AttemptRequest,
  type CancelRequest,
  type Configuration,
  type Credential,
  type IRecoveryClient,
  type ValidationRefusal
} from '@web/modules/social-recovery/sdk-interfaces'
import { keccak256, stringToHex } from 'viem'

import {
  createWorld,
  eachIt,
  expectThrown,
  fillAll,
  isAddress,
  isHex,
  momentOf,
  NO_PAYMENT,
  openRecovery,
  PASSWORD,
  replyFor,
  WINDOW,
  World,
  ZERO
} from './harness'

/** A willing approver's reply; the zkPassport request takes its app's domain and scope. */
const replyOf = async (world: World, request: ApproverRequest) => {
  const orchestrator = world.orchestrator()
  const input = orchestrator.signingInput(request, { domain: 'wallet.example', scope: 'recovery' })
  const reply = await orchestrator.replyFrom(request, input, world.material(request))
  expect(reply.kind).toBe('recovery-proof-reply')
  return reply as ApproverReply
}

const walletAt = (world: World, label: string): Credential => ({
  method: world.descriptor.methodEcdsa,
  config: world.methods.wallet.codec.encodeConfig({ address: addressOf(label) })
})

const passportAt = (world: World, id: string): Credential => ({
  method: world.descriptor.methodZkpassport,
  config: world.methods.zkPassport.codec.encodeConfig({
    uniqueIdentifier: keccak256(stringToHex(id))
  })
})

/** Commits a private setup over the given clauses and returns its configuration. */
const commitOver = (world: World, clauses: Configuration['clauses']): Configuration => {
  const configuration: Configuration = { ...world.configuration, clauses }
  world.chain.commitSetup({ level: 'private', configuration, password: PASSWORD })
  return configuration
}

const openGathering = (world: World, recovery: IRecoveryClient, configuration: Configuration) =>
  recovery.initRecoveryGathering(
    configuration,
    { newAuthority: world.keys.fresh, removedAuthority: world.keys.held },
    NO_PAYMENT,
    { window: WINDOW }
  )

describe('recovery client double', () => {
  it('reads the recovery state record pinned to one block', async () => {
    const world = createWorld()
    world.script.setupCommitted('private')
    world.script.attempt('none')
    const state = await (await world.recoveryClient()).recoveryState()
    expect(state.attempt.state).toBe('None')
    ;[
      'state',
      'attemptId',
      'setupNonce',
      'consumableAfter',
      'payloadHash',
      'order',
      'usedMethods',
      'ignoresPause'
    ].forEach((field) => expect(state.attempt).toHaveProperty(field))
    expect(typeof state.nextAttemptId).toBe('bigint')
    expect(isHex(state.setupCommitment)).toBe(true)
    expect(typeof state.setupNonce).toBe('bigint')
    expect(state.removedKey === 'no-creation-triple' || isAddress(state.removedKey)).toBe(true)
    expect(typeof state.block.timestamp).toBe('number')
    expect(isHex(state.block.hash)).toBe(true)
  })

  describe('the opening gathering', () => {
    it('opens with an empty replies array over the next attempt id and the pinned window', async () => {
      const { world, recovery, gathering } = await openRecovery()
      const state = await recovery.recoveryState()
      expect(gathering.kind).toBe('gathering')
      expect(gathering.purpose).toBe('approval')
      expect(gathering.replies).toEqual([])
      expect(gathering.places.length).toBeGreaterThan(0)
      expect(gathering.request.attemptId).toBe(state.nextAttemptId.toString())
      expect(gathering.request.setupNonce).toBe(state.setupNonce.toString())
      expect(gathering.request.account.toLowerCase()).toBe(world.account.toLowerCase())
      expect(BigInt(gathering.request.validUntil)).toBe(
        BigInt(gathering.request.block.timestamp) + BigInt(WINDOW)
      )
      expect(gathering.request.consumableAfter).toBeUndefined()
      expect(isHex(gathering.request.payload)).toBe(true)
      gathering.places.forEach((p) => {
        expect(['stopped', 'not-stopped']).toContain(p.standing)
        expect(typeof p.stoppable).toBe('boolean')
      })
    })

    it('mints one request per place, naming that place alone and the body by its hash', async () => {
      const { gathering, requests } = await openRecovery()
      expect(requests.map((r) => r.place)).toEqual(gathering.places.map((p) => p.place))
      requests.forEach((request, i) => {
        const place = gathering.places[i]!
        expect(request.kind).toBe('recovery-proof-request')
        expect(request.purpose).toBe('approval')
        expect(request.method).toBe(place.method)
        expect(request.config).toBe(place.config)
        expect(request.salt).toBe(place.salt)
        expect(request.attemptId).toBe(gathering.request.attemptId)
        expect(request.validUntil).toBe(gathering.request.validUntil)
        expect(isHex(request.setupBodyHash)).toBe(true)
        expect(request).not.toHaveProperty('setupBody')
        expect(request).not.toHaveProperty('label')
        expect(request).not.toHaveProperty('block')
      })
    })

    it('refuses while an attempt is already waiting', async () => {
      const world = createWorld()
      const committed = world.script.setupCommitted('private')
      world.script.attempt('pending')
      const recovery = await world.recoveryClient()
      await expectThrown(() =>
        recovery.initRecoveryGathering(
          committed.configuration,
          { newAuthority: world.keys.fresh, removedAuthority: world.keys.held },
          NO_PAYMENT,
          { window: WINDOW }
        )
      )
    })

    eachIt(['manager.paused', 'manager.trustedParties'] as const)(
      'refuses to open while the %s read of a method goes unanswered',
      async (read) => {
        const world = createWorld()
        const configuration = commitOver(world, [
          { threshold: 1, credentials: [walletAt(world, 'ana'), passportAt(world, 'passport')] }
        ])
        world.chain.leaveUnanswered(read, world.descriptor.methodZkpassport)
        const recovery = await world.recoveryClient()
        const error = (await expectThrown(() =>
          openGathering(world, recovery, configuration)
        )) as CodedError
        expect(error.code).toBe('read.unanswered')
        expect(error.values).toEqual({ read, module: world.descriptor.methodZkpassport, place: 1 })
      }
    )

    it('opens over a module that declares nothing, which answers with empty values', async () => {
      const world = createWorld()
      const undeclared = addressOf('third-party-method')
      const configuration = commitOver(world, [
        {
          threshold: 1,
          credentials: [walletAt(world, 'ana'), { method: undeclared, config: '0x01' }]
        }
      ])
      const gathering = await openGathering(world, await world.recoveryClient(), configuration)
      expect(gathering.places[1]).toMatchObject({
        method: undeclared,
        standing: 'not-stopped',
        stoppable: false
      })
    })

    it('throws when scripted to refuse', async () => {
      const world = createWorld()
      const committed = world.script.setupCommitted('private')
      world.script.refuse('recovery.initRecoveryGathering', 'handover.new-holds-privilege')
      const recovery = await world.recoveryClient()
      await expectThrown(() =>
        recovery.initRecoveryGathering(
          committed.configuration,
          { newAuthority: world.keys.fresh, removedAuthority: world.keys.held },
          NO_PAYMENT,
          { window: WINDOW }
        )
      )
    })
  })

  describe('addApproverReply', () => {
    it('files a reply into a new record and leaves the one passed in untouched', async () => {
      const opened = await openRecovery()
      const reply = await replyFor(opened.world, opened.requests[0]!)
      const before = JSON.parse(
        JSON.stringify(opened.gathering, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
      )
      const added = opened.recovery.addApproverReply(opened.gathering, reply)
      expect(added.reason).toBeUndefined()
      expect(added.displaced).toBeUndefined()
      expect(added.gathering).not.toBe(opened.gathering)
      expect(added.gathering.replies).toEqual([reply])
      expect(opened.gathering.replies).toEqual([])
      expect(JSON.parse(JSON.stringify(opened.gathering))).toEqual(before)
    })

    it('replaces a second reply for one place and names the one it displaced', async () => {
      const opened = await openRecovery()
      const first = await replyFor(opened.world, opened.requests[0]!)
      const second = { ...first, proof: `0x${'cd'.repeat(65)}` as const }
      const g1 = opened.recovery.addApproverReply(opened.gathering, first).gathering
      const added = opened.recovery.addApproverReply(g1, second)
      expect(added.reason).toBeUndefined()
      expect(added.displaced).toEqual(first)
      expect(added.gathering.replies).toEqual([second])
    })

    const tamper: Record<AddRefusalReason, (r: ApproverReply) => ApproverReply> = {
      'version-unread': (r) => ({ ...r, version: r.version + 1000 }),
      'binding-mismatch': (r) => ({ ...r, attemptId: (BigInt(r.attemptId) + 7n).toString() }),
      'digest-mismatch': (r) => ({ ...r, digest: `0x${'00'.repeat(32)}` }),
      'place-unknown': (r) => ({ ...r, place: 9999 }),
      'credential-mismatch': (r) => ({ ...r, salt: `0x${'77'.repeat(32)}` })
    }

    eachIt([
      ['an empty object', {}, 'version-unread'],
      ['null', null, 'version-unread'],
      ['a string', 'not a reply', 'version-unread'],
      // A record missing its binding fields is one the doubles cannot read,
      // not a binding mismatch.
      [
        'a reply with no binding fields',
        { kind: 'recovery-proof-reply', version: 1, place: 0 },
        'version-unread'
      ]
    ] as const)('returns a typed refusal for a malformed pasted reply: %s', async (sample) => {
      const opened = await openRecovery()
      const pasted = sample[1] as unknown as ApproverReply
      let result: ReturnType<IRecoveryClient['addApproverReply']> | undefined
      expect(() => {
        result = opened.recovery.addApproverReply(opened.gathering, pasted)
      }).not.toThrow()
      expect(result!.reason).toEqual({ kind: 'add-refusal', cause: sample[2] })
      expect(result!.gathering).toEqual(opened.gathering)
      expect(result!.displaced).toBeUndefined()
    })

    eachIt(ADD_REFUSAL_REASONS)(
      'returns the %s refusal as a typed result, never a thrown error',
      async (cause) => {
        const opened = await openRecovery()
        const reply = tamper[cause](await replyFor(opened.world, opened.requests[0]!))
        let result: ReturnType<IRecoveryClient['addApproverReply']> | undefined
        expect(() => {
          result = opened.recovery.addApproverReply(opened.gathering, reply)
        }).not.toThrow()
        expect(result!.reason).toEqual({ kind: 'add-refusal', cause })
        expect(result!.gathering).toEqual(opened.gathering)
        expect(result!.gathering.replies).toEqual([])
        expect(result!.displaced).toBeUndefined()
      }
    )
  })

  describe('assess and complete', () => {
    it('assesses an empty record as unsatisfied with every place missing', async () => {
      const { recovery, gathering } = await openRecovery()
      const now = Number(gathering.request.block.timestamp) + 60
      const assessment = recovery.assess(gathering, now)
      expect(assessment.filled).toEqual([])
      expect(assessment.missing).toEqual(gathering.places.map((p) => p.place))
      expect(assessment.ruleSatisfied).toBe(false)
      assessment.clauses.forEach((c) => {
        expect(typeof c.threshold).toBe('number')
        expect(c.filled).toBe(0)
      })
    })

    it('refuses to complete an unsatisfied record', async () => {
      const { recovery, gathering } = await openRecovery()
      const now = Number(gathering.request.block.timestamp) + 60
      expect(() => recovery.complete(gathering, undefined, now)).toThrow(Error)
    })

    it('completes a filled record into an AttemptRequest over the requests it minted', async () => {
      const opened = await openRecovery()
      const filled = await fillAll(opened)
      const now = Number(opened.gathering.request.block.timestamp) + 60
      const assessment = opened.recovery.assess(filled, now)
      expect(assessment.ruleSatisfied).toBe(true)
      expect(assessment.missing).toEqual([])
      const request = opened.recovery.complete(filled, undefined, now) as AttemptRequest
      expect(request).toHaveProperty('payload')
      expect(request).toHaveProperty('order')
      expect(request.attemptId).toBe(BigInt(opened.gathering.request.attemptId))
      expect(request.setupNonce).toBe(BigInt(opened.gathering.request.setupNonce))
      expect(request.validUntil).toBe(Number(opened.gathering.request.validUntil))
      expect(request.proofs.length).toBeGreaterThan(0)
      const places = request.proofs.map((p) => p.place)
      places.forEach((p, i) => i > 0 && expect(p > places[i - 1]!).toBe(true))
      request.proofs.forEach((proof) => {
        const minted = opened.requests.find((r) => BigInt(r.place) === proof.place)!
        expect(minted).toBeDefined()
        expect(proof.method).toBe(minted.method)
        expect(proof.config).toBe(minted.config)
        expect(proof.salt).toBe(minted.salt)
      })
    })

    it('completes with the set naming the fewest stoppable methods before the earliest filed', async () => {
      const world = createWorld()
      // The wallet method carries a stop here too, so all three places are stoppable.
      world.script.method(world.descriptor.methodEcdsa, {
        trustedParties: {
          admin: ZERO,
          pendingAdmin: ZERO,
          trustedKeys: [],
          pauseHolder: addressOf('wallet-pause-holder'),
          pendingPauseHolder: ZERO
        }
      })
      const configuration = commitOver(world, [
        {
          threshold: 2,
          credentials: [
            walletAt(world, 'ana'),
            passportAt(world, 'passport'),
            walletAt(world, 'ben')
          ]
        }
      ])
      const recovery = await world.recoveryClient()
      const gathering = await openGathering(world, recovery, configuration)
      expect(gathering.places.map((p) => p.stoppable)).toEqual([true, true, true])
      let filled = gathering
      // eslint-disable-next-line no-restricted-syntax
      for (const request of recovery.getApproverRequests(gathering)) {
        // eslint-disable-next-line no-await-in-loop
        const added = recovery.addApproverReply(filled, await replyOf(world, request))
        expect(added.reason).toBeUndefined()
        filled = added.gathering
      }
      expect(filled.replies.map((r) => r.place)).toEqual([0, 1, 2])
      const request = recovery.complete(filled, undefined, momentOf(gathering)) as AttemptRequest
      expect(request.proofs.map((p) => p.place)).toEqual([0n, 2n])
    })

    it('refuses to complete a record whose window has passed', async () => {
      const opened = await openRecovery()
      const filled = await fillAll(opened)
      const late = Number(opened.gathering.request.validUntil) + 1
      expect(() => opened.recovery.complete(filled, undefined, late)).toThrow(Error)
    })
  })

  describe('the cancellation gathering', () => {
    it('refuses where no attempt is waiting', async () => {
      const world = createWorld()
      const committed = world.script.setupCommitted('private')
      const recovery = await world.recoveryClient()
      await expectThrown(() =>
        recovery.initCancelGathering(committed.configuration, { window: 3600 })
      )
    })

    eachIt(['manager.paused', 'manager.trustedParties'] as const)(
      'refuses to open while the %s read of a method goes unanswered',
      async (read) => {
        const world = createWorld()
        const configuration = commitOver(world, [
          { threshold: 1, credentials: [walletAt(world, 'ana'), passportAt(world, 'passport')] }
        ])
        world.script.attempt('pending')
        world.chain.leaveUnanswered(read, world.descriptor.methodZkpassport)
        const recovery = await world.recoveryClient()
        const error = (await expectThrown(() =>
          recovery.initCancelGathering(configuration, { window: 3600 })
        )) as CodedError
        expect(error.code).toBe('read.unanswered')
        expect(error.values).toEqual({ read, module: world.descriptor.methodZkpassport, place: 1 })
      }
    )

    it('opens over the live attempt id with its consumableAfter and completes into a CancelRequest', async () => {
      const world = createWorld()
      const committed = world.script.setupCommitted('private')
      world.script.attempt('pending')
      const recovery = await world.recoveryClient()
      const state = await recovery.recoveryState()
      const gathering = await recovery.initCancelGathering(committed.configuration, {
        window: 3600
      })
      expect(gathering.purpose).toBe('cancellation')
      expect(gathering.request.attemptId).toBe(state.attempt.attemptId.toString())
      expect(gathering.request.consumableAfter).toBe(state.attempt.consumableAfter.toString())
      expect(gathering.request.payload).toBeUndefined()
      expect(gathering.request.order).toBeUndefined()
      const requests = recovery.getApproverRequests(gathering)
      requests.forEach((r) => {
        expect(r.purpose).toBe('cancellation')
        expect(r.payload).toBeUndefined()
        expect(r.order).toBeUndefined()
        expect(r).not.toHaveProperty('consumableAfter')
        expect(r).not.toHaveProperty('block')
      })
      const orchestrator = world.orchestrator()
      const filled = await fillAll({ world, recovery, orchestrator, gathering, requests })
      const now = Number(gathering.request.block.timestamp) + 60
      const cancel = recovery.complete(filled, undefined, now) as CancelRequest
      expect(cancel).not.toHaveProperty('payload')
      expect(cancel).not.toHaveProperty('order')
      expect(cancel.attemptId).toBe(state.attempt.attemptId)
    })
  })

  describe('the prepares', () => {
    it('prepares startAttempt on the manager, sent by anyone', async () => {
      const opened = await openRecovery()
      const now = Number(opened.gathering.request.block.timestamp) + 60
      const request = opened.recovery.complete(
        await fillAll(opened),
        undefined,
        now
      ) as AttemptRequest
      const call = await opened.recovery.prepareStartAttempt(request, now)
      expect(call.kind).toBe('call')
      expect(call.sender).toBe('anyone')
      expect(call.target.toLowerCase()).toBe(opened.world.descriptor.manager.toLowerCase())
      expect(call.describes).toBeUndefined()
    })

    it('prepares cancelByOwner sent by the account and cancelByVeto sent by anyone', async () => {
      const world = createWorld()
      world.script.setupCommitted('private')
      world.script.attempt('pending')
      const recovery = await world.recoveryClient()
      const byOwner = await recovery.prepareCancelByOwner()
      expect(byOwner.sender).toBe('account')
      expect(byOwner.target.toLowerCase()).toBe(world.descriptor.manager.toLowerCase())
      const state = await recovery.recoveryState()
      const byVeto = await recovery.prepareCancelByVeto(
        state.attempt.usedMethods[0] ?? world.descriptor.methodEcdsa
      )
      expect(byVeto.sender).toBe('anyone')
      expect(byVeto.target.toLowerCase()).toBe(world.descriptor.manager.toLowerCase())
    })

    it('prepares executeHandover on the action with the batch it describes', async () => {
      const world = createWorld()
      world.script.setupCommitted('private')
      world.script.attempt('ready')
      const recovery = await world.recoveryClient()
      const state = await recovery.recoveryState()
      const at = await world.provider.block('latest')
      const notes = await recovery.events.fetch(recovery.events.accountFilter(), {
        from: world.descriptor.deployedAt,
        to: at.number
      })
      const opening = notes.find(
        (n) => n.kind === 'attempt-started' && n.attemptId === state.attempt.attemptId
      )
      expect(opening).toBeDefined()
      const payload = opening!.kind === 'attempt-started' ? opening!.payload : '0x'
      const call = await recovery.prepareExecuteHandover(state.attempt, payload)
      expect(call.sender).toBe('anyone')
      expect(call.target.toLowerCase()).toBe(world.descriptor.action.toLowerCase())
      expect(Array.isArray(call.describes)).toBe(true)
      expect(call.describes!.length).toBeGreaterThanOrEqual(3)
    })

    eachIt([
      'prepareStartAttempt',
      'prepareCancelByProofs',
      'prepareCancelByOwner',
      'prepareCancelByVeto',
      'prepareExecuteHandover'
    ] as const)('throws %s when scripted to refuse', async (member) => {
      const world = createWorld()
      world.script.setupCommitted('private')
      world.script.attempt('pending')
      world.script.refuse(`recovery.${member}`, 'request.expired')
      const recovery = await world.recoveryClient()
      const state = await recovery.recoveryState()
      const stub = {} as AttemptRequest & CancelRequest
      const run: Record<typeof member, () => Promise<unknown>> = {
        prepareStartAttempt: () => recovery.prepareStartAttempt(stub, 0),
        prepareCancelByProofs: () => recovery.prepareCancelByProofs(stub, 0),
        prepareCancelByOwner: () => recovery.prepareCancelByOwner(),
        prepareCancelByVeto: () => recovery.prepareCancelByVeto(world.descriptor.methodEcdsa),
        prepareExecuteHandover: () => recovery.prepareExecuteHandover(state.attempt, '0x')
      }
      const error = (await expectThrown(run[member])) as ValidationRefusal
      expect(error.findings.errors.map((f) => f.code)).toContain('request.expired')
    })
  })

  it('throws a scripted read failure of recoveryState', async () => {
    const world = createWorld()
    world.script.setupCommitted('private')
    const recovery = await world.recoveryClient()
    world.script.failRead('recovery.recoveryState')
    await expectThrown(() => recovery.recoveryState())
  })
})
