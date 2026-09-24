/**
 * One host per call of a method's lifecycle (ux-interfaces.md D-372): enroll,
 * test access, create claim and health check.
 *
 * A host takes the orchestrator and the method implementation as injected
 * parameters typed by `sdk-interfaces`, and never imports the SDK doubles: the
 * ESLint fence keeps them to `shared/client`, and the wiring through PT-038's
 * client is a later follow-up. Each host renders its steps through `onStep`,
 * honours `signal` as the abort, and returns exactly one outcome of
 * `verdicts.ts`: one of the four verdicts, or the dismissal read before the
 * method runs.
 *
 * "The method runs" means its packaging: `configFrom` at enrollment and
 * `replyFrom` at a test or a claim. The options calls, `enrollInput` and
 * `signingInput`, run before the device, since the device needs their output,
 * and act on nothing (sdk.md D-206).
 */
import type {
  Address,
  ApproverReply,
  ApproverRequest,
  DeviceBinding,
  Hex,
  IMethodsOrchestrator,
  IRecoveryMethod
} from '@web/modules/social-recovery/sdk-interfaces'

import type { CeremonyDevice, CeremonyStep, DeviceCallContext } from './device'
import {
  CeremonyOutcome,
  dismissed,
  isMethodFailure,
  notSupported,
  outcomeOfCheck,
  outcomeOfMethodFailure,
  outcomeOfThrown,
  passed
} from './verdicts'
import type { PasskeyFacts } from './webauthn'

export interface HostContext {
  orchestrator: IMethodsOrchestrator
  /** The implementation, read for its `deviceBinding` (sdk.md D-206). */
  method: IRecoveryMethod
  /**
   * The device call for this method. Where it is absent the host takes
   * `devices[method.deviceBinding]`, and where that is absent too the host
   * reports not supported: this build holds no device call for the binding.
   */
  device?: CeremonyDevice
  devices?: Partial<Record<DeviceBinding, CeremonyDevice>>
  /** The holder chose the browser's phone hand-off (D-305, D-392). */
  handOff?: boolean
  signal?: AbortSignal
  onStep?: (step: CeremonyStep) => void
}

/**
 * What a passed enrollment carries: the config bytes, the ceremony's own facts
 * (the synced or device-bound kind) and the credential id a later test or
 * claim names in `allowCredentials`.
 */
export interface EnrollValue {
  config: Hex
  facts?: PasskeyFacts
  credentialId?: string
}

/** What a passed access test carries: the proof the local check satisfied. */
export interface TestAccessValue {
  proof: Hex
  facts?: PasskeyFacts
}

/** What a passed claim carries: the reply for one place. */
export interface ClaimValue {
  reply: ApproverReply
  facts?: PasskeyFacts
}

const deviceOf = (context: HostContext): CeremonyDevice | undefined =>
  context.device ?? context.devices?.[context.method.deviceBinding]

const cancelledByAbort = (context: HostContext) =>
  context.signal?.aborted ? dismissed('cancelled', 'AbortError') : null

const deviceContext = (context: HostContext): DeviceCallContext => ({
  signal: context.signal,
  handOff: context.handOff,
  onStep: context.onStep
})

/**
 * Enroll: the options, the ceremony, then the config (sdk.md D-206). A
 * dismissed or refused ceremony returns before `configFrom` runs; an
 * enrollment failure reads failed with its cause, a relying party the provider
 * refused among them (D-314).
 */
export const enrollHost = async (
  context: HostContext & { methodAddress: Address; params: unknown }
): Promise<CeremonyOutcome<EnrollValue>> => {
  const aborted = cancelledByAbort(context)
  if (aborted) return aborted
  const device = deviceOf(context)
  if (!device) return notSupported('no-implementation')

  context.onStep?.('preparing')
  let input: unknown
  try {
    input = context.orchestrator.enrollInput(context.methodAddress, context.params)
  } catch (error) {
    return outcomeOfThrown(error)
  }

  const result = await device.enroll(input, deviceContext(context))
  if (!result.ok) return result.stop
  const abortedAfterDevice = cancelledByAbort(context)
  if (abortedAfterDevice) return abortedAfterDevice

  context.onStep?.('packaging')
  try {
    const config = await context.orchestrator.configFrom(
      context.methodAddress,
      input,
      result.material
    )
    if (isMethodFailure(config)) return outcomeOfMethodFailure(config, context)
    return passed({
      config,
      ...(result.facts ? { facts: result.facts } : {}),
      ...(result.credentialId ? { credentialId: result.credentialId } : {})
    })
  } catch (error) {
    return outcomeOfThrown(error)
  }
}

type SignedReply =
  | { ok: true; reply: ApproverReply; facts?: PasskeyFacts }
  | { ok: false; outcome: CeremonyOutcome<never> }

/** The signing half test access and create claim share: options, ceremony, reply. */
const signForRequest = async (
  context: HostContext & { request: ApproverRequest; params?: unknown }
): Promise<SignedReply> => {
  const aborted = cancelledByAbort(context)
  if (aborted) return { ok: false, outcome: aborted }
  const device = deviceOf(context)
  if (!device) return { ok: false, outcome: notSupported('no-implementation') }

  context.onStep?.('preparing')
  let input: unknown
  try {
    input = context.orchestrator.signingInput(context.request, context.params)
  } catch (error) {
    return { ok: false, outcome: outcomeOfThrown(error) }
  }

  const result = await device.sign(input, deviceContext(context))
  if (!result.ok) return { ok: false, outcome: result.stop }
  const abortedAfterDevice = cancelledByAbort(context)
  if (abortedAfterDevice) return { ok: false, outcome: abortedAfterDevice }

  context.onStep?.('packaging')
  try {
    const reply = await context.orchestrator.replyFrom(context.request, input, result.material)
    if (isMethodFailure(reply)) {
      return { ok: false, outcome: outcomeOfMethodFailure(reply, context) }
    }
    return { ok: true, reply, ...(result.facts ? { facts: result.facts } : {}) }
  } catch (error) {
    return { ok: false, outcome: outcomeOfThrown(error) }
  }
}

/**
 * Test access: sign the test challenge the caller's request carries, then run
 * the local check the wallet never enforces (D-305, D-372). The caller builds
 * the request whose digest is the test challenge; the host judges the proof
 * through the orchestrator's own verdict member, so no page holds a ctx.
 */
export const testAccessHost = async (
  context: HostContext & { request: ApproverRequest; params?: unknown }
): Promise<CeremonyOutcome<TestAccessValue>> => {
  const signed = await signForRequest(context)
  if (!signed.ok) return signed.outcome
  context.onStep?.('checking')
  try {
    const verdict = await context.orchestrator.verify(
      context.request,
      context.request.place,
      signed.reply.proof
    )
    return outcomeOfCheck(verdict, {
      proof: signed.reply.proof,
      ...(signed.facts ? { facts: signed.facts } : {})
    })
  } catch (error) {
    return outcomeOfThrown(error)
  }
}

/**
 * Create claim: the reply for one place of a request (D-372). The method's
 * packaging runs its own local check before a reply leaves the device
 * (sdk.md D-206), so the host adds none.
 */
export const createClaimHost = async (
  context: HostContext & { request: ApproverRequest; params?: unknown }
): Promise<CeremonyOutcome<ClaimValue>> => {
  const signed = await signForRequest(context)
  if (!signed.ok) return signed.outcome
  return passed({ reply: signed.reply, ...(signed.facts ? { facts: signed.facts } : {}) })
}

/**
 * Health check: the unattended access test of D-309, a third-release feature
 * (D-313). A shell that answers not supported, with no retry, and asks nothing
 * of the method or the device. Marked as a shell: replace it when the
 * management surfaces that carry it land.
 */
export const HEALTH_CHECK_IS_SHELL = true

export const healthCheckHost = async (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context?: Partial<HostContext>
): Promise<CeremonyOutcome<never>> => notSupported('no-implementation')
