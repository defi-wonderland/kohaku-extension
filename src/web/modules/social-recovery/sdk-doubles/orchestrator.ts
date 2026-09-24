/**
 * The `IMethodsOrchestrator` double (sdk.md D-206): the approving and enrolling
 * side, holding a method registry and a codec registry and no provider. It works
 * from the request alone: the request's chain id, manager and digest version
 * make the domain, its action picks the codec, its method picks the
 * implementation. It builds the `ctx` and nothing else does.
 *
 * Refusals: `signingInput` and `enrollInput` throw (an unread record, an
 * unserved method, a binding this runtime cannot meet, or a scripted refusal);
 * `replyFrom` and `configFrom` return the typed failures; `verify` answers a
 * verdict.
 */
import type {
  Address,
  ApproverReply,
  ApproverRequest,
  EnrollFailure,
  Hex,
  IActionCodec,
  IMethodsOrchestrator,
  IRecoveryMethod,
  MethodContext,
  ReplyFailure,
  RequestDescription,
  Verdict
} from '@web/modules/social-recovery/sdk-interfaces'

import type { ScriptedChain } from './chain'
import { deserializeOrder, digestOfRequest } from './encoding'

/** The record versions this build of the doubles reads (sdk.md D-207). */
export const RECORD_VERSION = 1

const reads = (request: ApproverRequest): boolean =>
  request?.kind === 'recovery-proof-request' && request.version === RECORD_VERSION

export class MethodsOrchestratorDouble implements IMethodsOrchestrator {
  private readonly methods = new Map<string, IRecoveryMethod>()

  private readonly codecs = new Map<string, IActionCodec<unknown>>()

  /**
   * @param methodRegistry the implementations keyed by the module addresses each serves
   * @param codecs the action codecs, keyed by their `actions`
   * @param chain the scripted chain, read for its approving-side scripts alone
   */
  constructor(
    methodRegistry: Map<string, IRecoveryMethod>,
    codecs: IActionCodec<unknown>[],
    private readonly chain?: ScriptedChain
  ) {
    methodRegistry.forEach((m, module) => this.methods.set(module.toLowerCase(), m))
    codecs.forEach((c) => c.actions.forEach((a) => this.codecs.set(a.toLowerCase(), c)))
  }

  private methodFor(address: Address): IRecoveryMethod | undefined {
    return this.methods.get(address.toLowerCase())
  }

  /** The one record four implementation members take, built here and nowhere else. */
  contextOf(request: ApproverRequest, place: number = request.place): MethodContext {
    const at = { ...request, place }
    const digest = digestOfRequest(at)
    const approval = request.purpose === 'approval'
    return {
      request: at,
      place,
      digest,
      typedData: {
        domain: {
          name: 'PolicyManager',
          version: request.digestVersion,
          chainId: request.chainId,
          verifyingContract: request.manager
        },
        primaryType: approval ? 'Approval' : 'Cancellation',
        message: {
          account: request.account,
          action: request.action,
          attemptId: request.attemptId,
          setupNonce: request.setupNonce,
          setupBodyHash: request.setupBodyHash,
          ...(approval ? { payload: request.payload, order: request.order } : {}),
          validUntil: request.validUntil,
          place,
          method: request.method,
          config: request.config,
          salt: request.salt
        },
        digest
      }
    }
  }

  describeRequest(request: ApproverRequest): RequestDescription {
    if (!reads(request))
      throw new Error('version-unread: this build does not read that request record.')
    const approval = request.purpose === 'approval'
    let handover: RequestDescription['handover']
    if (approval) {
      const codec = this.codecs.get(request.action.toLowerCase())
      try {
        handover =
          codec && request.payload
            ? {
                decoded: true,
                value: codec.decode(request.payload) as {
                  newAuthority: Address
                  removedAuthority: Address
                }
              }
            : { decoded: false }
      } catch {
        handover = { decoded: false }
      }
    }
    const method = this.methodFor(request.method)
    const ctx = this.contextOf(request)
    let identityPublic: unknown
    try {
      identityPublic = method ? method.codec.decodeConfig(request.config) : undefined
    } catch {
      identityPublic = undefined
    }
    return {
      account: request.account,
      chainId: BigInt(request.chainId),
      manager: request.manager,
      action: request.action,
      attemptId: BigInt(request.attemptId),
      setupNonce: BigInt(request.setupNonce),
      purpose: request.purpose,
      ...(approval ? { handover } : {}),
      ...(approval && request.order ? { order: deserializeOrder(request.order) } : {}),
      validUntil: Number(request.validUntil),
      place: request.place,
      identityPublic,
      device: method ? method.describe(ctx) : { supported: false }
    }
  }

  async verify(request: ApproverRequest, place: number, proof: Hex): Promise<Verdict> {
    if (this.chain?.verdict) return this.chain.verdict
    const method = this.methodFor(request.method)
    if (!method || !reads(request)) return 'not-judged'
    return method.verify(this.contextOf(request, place), proof)
  }

  signingInput(request: ApproverRequest, params?: unknown): unknown {
    this.chain?.guardRefusal('orchestrator.signingInput')
    if (!reads(request))
      throw new Error('version-unread: this build does not read that request record.')
    const method = this.methodFor(request.method)
    if (!method) throw new Error(`method-unsupported: no implementation serves ${request.method}.`)
    if (this.chain?.unmetBindings.has(method.deviceBinding)) {
      throw new Error(`This runtime cannot meet the ${method.deviceBinding} binding.`)
    }
    return method.signingInput(this.contextOf(request), params)
  }

  async replyFrom(
    request: ApproverRequest,
    input: unknown,
    material: unknown
  ): Promise<ApproverReply | ReplyFailure> {
    if (!reads(request)) return { kind: 'reply-failure', cause: 'version-unread' }
    const method = this.methodFor(request.method)
    if (!method) return { kind: 'reply-failure', cause: 'method-unsupported' }
    if (this.chain?.replyFailure) return { kind: 'reply-failure', cause: this.chain.replyFailure }
    const ctx = this.contextOf(request)
    const proof = await method.replyFrom(ctx, input, material)
    if (typeof proof !== 'string') return proof
    return {
      kind: 'recovery-proof-reply',
      version: RECORD_VERSION,
      chainId: request.chainId,
      manager: request.manager,
      account: request.account,
      action: request.action,
      attemptId: request.attemptId,
      purpose: request.purpose,
      place: request.place,
      method: request.method,
      config: request.config,
      salt: request.salt,
      digest: ctx.digest,
      proof
    }
  }

  enrollInput(method: Address, params: unknown): unknown {
    this.chain?.guardRefusal('orchestrator.enrollInput')
    const implementation = this.methodFor(method)
    if (!implementation) throw new Error(`method-unsupported: no implementation serves ${method}.`)
    return implementation.enrollInput(params)
  }

  async configFrom(
    method: Address,
    input: unknown,
    material: unknown
  ): Promise<Hex | EnrollFailure> {
    const implementation = this.methodFor(method)
    if (!implementation) return { kind: 'enroll-failure', cause: 'method-unsupported' }
    if (this.chain?.enrollFailure)
      return { kind: 'enroll-failure', cause: this.chain.enrollFailure }
    return implementation.configFrom(input, material)
  }
}
