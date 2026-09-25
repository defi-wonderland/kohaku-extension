import {
  METHOD_FAILURE_CAUSES,
  VERDICTS,
  type ApproverReply,
  type ApproverRequest,
  type ReplyFailure
} from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, expectThrown, isHex, openRecovery } from './harness'

const firstRequest = async () => {
  const { world, requests } = await openRecovery()
  // The request crosses a JSON round trip, the way a link carries it.
  const request = JSON.parse(JSON.stringify(requests[0])) as ApproverRequest
  return { world, request }
}

describe('methods orchestrator double', () => {
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
    // Addresses compare case-insensitively: the codec decodes checksummed ones.
    const { handover } = described
    if (!handover?.decoded) throw new Error('the handover did not decode')
    expect(handover.value.newAuthority.toLowerCase()).toBe(world.keys.fresh.toLowerCase())
    expect(handover.value.removedAuthority.toLowerCase()).toBe(world.keys.held.toLowerCase())
  })

  it('builds the signing input and the reply from the request alone', async () => {
    const { world, request } = await firstRequest()
    const orchestrator = world.orchestrator()
    const input = orchestrator.signingInput(request)
    expect(input).toBeDefined()
    const reply = (await orchestrator.replyFrom(
      request,
      input,
      world.material(request)
    )) as ApproverReply
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

  it('hands the wallet EIP-712 typed data: domain, types, primaryType, message, no digest', async () => {
    const { world, request } = await firstRequest()
    const input = world.orchestrator().signingInput(request) as Record<string, unknown>
    expect(Object.keys(input).sort()).toEqual(['domain', 'message', 'primaryType', 'types'])
    const domain = input.domain as Record<string, unknown>
    const types = input.types as Record<string, { name: string; type: string }[]>
    expect(['number', 'bigint']).toContain(typeof domain.chainId)
    expect(Number(domain.chainId)).toBe(Number(request.chainId))
    expect(String(domain.verifyingContract).toLowerCase()).toBe(request.manager.toLowerCase())
    expect(input.primaryType).toBe('Approval')
    expect(Array.isArray(types[input.primaryType as string])).toBe(true)
    types[input.primaryType as string]!.forEach((field) => {
      expect(typeof field.name).toBe('string')
      expect(typeof field.type).toBe('string')
    })
    // The wallet derives the digest itself; none travels inside what it signs.
    const text = JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    expect(text).not.toMatch(/"digest"/)
  })

  it('returns a scripted reply failure as a typed result, never a thrown error', async () => {
    const { world, request } = await firstRequest()
    world.script.replyFailure('device-refused')
    const orchestrator = world.orchestrator()
    let reply: ReplyFailure | undefined
    await expect(
      (async () => {
        reply = (await orchestrator.replyFrom(
          request,
          orchestrator.signingInput(request),
          world.material(request)
        )) as ReplyFailure
      })()
    ).resolves.toBeUndefined()
    expect(reply).toEqual({ kind: 'reply-failure', cause: 'device-refused' })
    expect(METHOD_FAILURE_CAUSES).toContain(reply!.cause)
  })

  it('throws signingInput when scripted to refuse', async () => {
    const { world, request } = await firstRequest()
    world.script.refuse('orchestrator.signingInput', 'request.expired')
    const orchestrator = world.orchestrator()
    await expectThrown(async () => orchestrator.signingInput(request))
  })

  it('answers a verdict, never a refusal: satisfied for a good proof, rejected for another', async () => {
    const { world, request } = await firstRequest()
    const orchestrator = world.orchestrator()
    const reply = (await orchestrator.replyFrom(
      request,
      orchestrator.signingInput(request),
      world.material(request)
    )) as ApproverReply
    const good = await orchestrator.verify(request, request.place, reply.proof)
    const bad = await orchestrator.verify(request, request.place, `0x${'ab'.repeat(65)}`)
    expect(VERDICTS).toContain(good)
    expect(good).toBe('satisfied')
    expect(bad).toBe('rejected')
  })

  it('enrolls through enrollInput and configFrom, a failure being a typed result', async () => {
    const world = createWorld()
    const orchestrator = world.orchestrator()
    const method = world.descriptor.methodEcdsa
    const input = orchestrator.enrollInput(method, { address: world.keys.held })
    const config = await orchestrator.configFrom(method, input, world.keys.held)
    expect(isHex(config)).toBe(true)
    world.script.enrollFailure('material-rejected')
    const failed = await world.orchestrator().configFrom(method, input, world.keys.held)
    expect(failed).toEqual({ kind: 'enroll-failure', cause: 'material-rejected' })
  })

  it('throws enrollInput when scripted to refuse', async () => {
    const world = createWorld()
    world.script.refuse('orchestrator.enrollInput', 'request.expired')
    const orchestrator = world.orchestrator()
    await expectThrown(async () =>
      orchestrator.enrollInput(world.descriptor.methodEcdsa, { address: world.keys.held })
    )
  })
})
