/**
 * The methods orchestrator double (IMethodsOrchestrator, sdk.md D-206; D-201
 * "Refusals throw"; ux-interfaces.md D-374). It answers from a request alone:
 * the request below crosses a JSON round trip, the way a link carries it.
 */
import {
  METHOD_FAILURE_CAUSES,
  VERDICTS,
  type ApproverReply,
  type Hex,
  type ApproverRequest,
  type PaymentOrder,
  type ReplyFailure
} from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, expectThrown, isHex, membersOf, ZERO } from './harness'

const NO_PAYMENT: PaymentOrder = { token: ZERO, amount: 0n, payee: ZERO }
const MATERIAL: Hex = `0x${'ab'.repeat(65)}`

const firstRequest = async () => {
  const world = createWorld()
  const committed = world.script.setupCommitted('private')
  world.script.attempt('none')
  const recovery = await world.recoveryClient()
  const gathering = await recovery.initRecoveryGathering(
    { configuration: committed.configuration },
    { newAuthority: world.keys.fresh, removedAuthority: world.keys.held },
    NO_PAYMENT,
    { window: 3600 }
  )
  const request = JSON.parse(
    JSON.stringify(recovery.getApproverRequests(gathering)[0])
  ) as ApproverRequest
  return { world, request }
}

describe('methods orchestrator double', () => {
  it('exposes the six calls of IMethodsOrchestrator', () => {
    const orchestrator = createWorld().orchestrator()
    const members = membersOf(orchestrator)
    ;[
      'describeRequest',
      'verify',
      'signingInput',
      'replyFrom',
      'enrollInput',
      'configFrom'
    ].forEach((name) => {
      expect(members).toContain(name)
      expect(typeof (orchestrator as unknown as Record<string, unknown>)[name]).toBe('function')
    })
  })

  it('describes a request from the request alone', async () => {
    const { world, request } = await firstRequest()
    const described = world.orchestrator().describeRequest(request)
    expect(described.account).toBe(request.account)
    expect(described.manager).toBe(request.manager)
    expect(described.action).toBe(request.action)
    expect(described.chainId).toBe(BigInt(request.chainId))
    expect(described.attemptId).toBe(BigInt(request.attemptId))
    expect(described.setupNonce).toBe(BigInt(request.setupNonce))
    expect(described.purpose).toBe('approval')
    expect(described.place).toBe(request.place)
    expect(described.validUntil).toBe(Number(request.validUntil))
    expect(described.handover).toEqual({
      decoded: true,
      value: { newAuthority: world.keys.fresh, removedAuthority: world.keys.held }
    })
  })

  it('builds the signing input and the reply from the request alone', async () => {
    const { world, request } = await firstRequest()
    const orchestrator = world.orchestrator()
    const input = orchestrator.signingInput(request)
    expect(input).toBeDefined()
    const reply = (await orchestrator.replyFrom(request, input, MATERIAL)) as ApproverReply
    expect(reply.kind).toBe('recovery-proof-reply')
    ;(['chainId', 'manager', 'account', 'action', 'attemptId', 'purpose'] as const).forEach(
      (field) => expect(reply[field]).toBe(request[field])
    )
    expect(reply.place).toBe(request.place)
    expect(reply.method).toBe(request.method)
    expect(reply.config).toBe(request.config)
    expect(reply.salt).toBe(request.salt)
    expect(isHex(reply.digest)).toBe(true)
    expect(isHex(reply.proof)).toBe(true)
  })

  it('returns a scripted reply failure as a typed result, never a thrown error', async () => {
    const { world, request } = await firstRequest()
    world.script.refuse('replyFrom', 'device-refused')
    const orchestrator = world.orchestrator()
    const reply = (await orchestrator.replyFrom(
      request,
      orchestrator.signingInput(request),
      MATERIAL
    )) as ReplyFailure
    expect(reply).toEqual({ kind: 'reply-failure', cause: 'device-refused' })
    expect(METHOD_FAILURE_CAUSES).toContain(reply.cause)
  })

  it('throws signingInput when scripted to refuse', async () => {
    const { world, request } = await firstRequest()
    world.script.refuse('signingInput', 'version-unread')
    const orchestrator = world.orchestrator()
    await expectThrown(async () => orchestrator.signingInput(request))
  })

  it('answers a verdict, never a refusal', async () => {
    const { world, request } = await firstRequest()
    const verdict = await world.orchestrator().verify(request, request.place, MATERIAL)
    expect(VERDICTS).toContain(verdict)
  })

  it('enrolls through enrollInput and configFrom, a failure being a typed result', async () => {
    const world = createWorld()
    const orchestrator = world.orchestrator()
    const method = world.descriptor.methodEcdsa
    const input = orchestrator.enrollInput(method, { address: world.keys.held })
    const config = await orchestrator.configFrom(method, input, world.keys.held)
    expect(isHex(config)).toBe(true)
    world.script.refuse('configFrom', 'material-rejected')
    const failed = await world.orchestrator().configFrom(method, input, world.keys.held)
    expect(failed).toEqual({ kind: 'enroll-failure', cause: 'material-rejected' })
  })
})
