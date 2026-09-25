/**
 * One host per call of a method's lifecycle: enroll, test access, create claim
 * and health check.
 *
 * A host takes the orchestrator and the method implementation as injected
 * parameters typed by `sdk-interfaces`, and never imports the SDK doubles: the
 * ESLint fence keeps them to `shared/client`. The tab gets both from the
 * resolver of `CeremonySourceProvider`; a test passes its own. Each host
 * renders its steps through `onStep`, honours `signal` as the abort, and
 * returns exactly one outcome of `verdicts.ts`: one of the four verdicts, or
 * the dismissal read before the method runs.
 *
 * "The method runs" means its packaging: `configFrom` at enrollment and
 * `replyFrom` at a test or a claim. The options calls, `enrollInput` and
 * `signingInput`, run before the device, since the device needs their output,
 * and act on nothing.
 *
 * The orchestrator's calls take no abort signal, so a host checks the signal
 * again after every call it awaits: an abort that arrives while the method
 * packages or checks ends in the cancelled note, and its answer is dropped.
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
import type { PasskeyCeremonyDevice } from './passkeyDevice'
import {
  CeremonyCall,
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
  /** The implementation, read for its `deviceBinding`. */
  method: IRecoveryMethod
  /**
   * The device a caller's record supplies, for a method whose material the
   * caller already holds (a guardian's address or signature, a zkPassport
   * result, an Aadhaar QR). Never used for the `browser-authenticator` binding.
   */
  device?: CeremonyDevice
  /**
   * The page's own devices by binding. A `browser-authenticator` method always
   * runs the page's own passkey device from here, so the rp id hash check and
   * the high-s normalization always run; where it is absent the host reports
   * not supported.
   */
  devices?: Partial<Record<DeviceBinding, CeremonyDevice>>
  /** The holder chose the browser's phone hand-off. */
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

type DeviceChoice = { device: CeremonyDevice; params: unknown }

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * The device a call runs and the params the method receives.
 *
 * A `browser-authenticator` method runs the page's own passkey device, never
 * one a caller's record supplies, and receives the relying party id of that
 * device: the page's full origin string. The host owns that id; a value the
 * caller passed is replaced. Any other binding runs the caller's device, or
 * the page's device for that binding.
 */
const chooseDevice = (context: HostContext, params: unknown): DeviceChoice | undefined => {
  if (context.method.deviceBinding === 'browser-authenticator') {
    const own = context.devices?.['browser-authenticator'] as
      | Partial<PasskeyCeremonyDevice>
      | undefined
    if (!own?.relyingParty) return undefined
    return {
      device: own as CeremonyDevice,
      params: { ...asRecord(params), relyingPartyId: own.relyingParty.relyingPartyId }
    }
  }
  const device = context.device ?? context.devices?.[context.method.deviceBinding]
  return device ? { device, params } : undefined
}

const cancelledByAbort = (context: HostContext) =>
  context.signal?.aborted ? dismissed('cancelled', 'AbortError') : null

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * The material the method's packaging receives. An in-page prover's material
 * takes an optional abort signal beside its data, since its proof runs for
 * tens of seconds inside `configFrom` or `replyFrom`: the host hands it the
 * ceremony's signal where the device set none. No other binding's material
 * takes a signal, so it passes unchanged.
 */
const materialFor = (context: HostContext, material: unknown): unknown => {
  if (context.method.deviceBinding !== 'in-browser-prover' || !context.signal) return material
  if (!isPlainRecord(material) || material.signal !== undefined) return material
  return { ...material, signal: context.signal }
}

/** What `outcomeOfMethodFailure` reads of the call: the hand-off and the method's binding. */
const failureOptions = (context: HostContext) => ({
  handOff: context.handOff,
  binding: context.method.deviceBinding
})

const deviceContext = (context: HostContext, call: CeremonyCall): DeviceCallContext => ({
  signal: context.signal,
  handOff: context.handOff,
  call,
  onStep: context.onStep
})

/**
 * Enroll: the options, the ceremony, then the config. A dismissed or refused
 * ceremony returns before `configFrom` runs; an enrollment failure reads
 * failed with its cause, a relying party the provider refused among them.
 */
export const enrollHost = async (
  context: HostContext & { methodAddress: Address; params: unknown }
): Promise<CeremonyOutcome<EnrollValue>> => {
  const aborted = cancelledByAbort(context)
  if (aborted) return aborted
  const chosen = chooseDevice(context, context.params)
  if (!chosen) return notSupported('no-implementation')
  const { device } = chosen

  context.onStep?.('preparing')
  let input: unknown
  try {
    input = context.orchestrator.enrollInput(context.methodAddress, chosen.params)
  } catch (error) {
    return outcomeOfThrown(error)
  }

  const result = await device.enroll(input, deviceContext(context, 'enroll'))
  if (!result.ok) return result.stop
  const abortedAfterDevice = cancelledByAbort(context)
  if (abortedAfterDevice) return abortedAfterDevice

  context.onStep?.('packaging')
  try {
    const config = await context.orchestrator.configFrom(
      context.methodAddress,
      input,
      materialFor(context, result.material)
    )
    const abortedInMethod = cancelledByAbort(context)
    if (abortedInMethod) return abortedInMethod
    if (isMethodFailure(config)) return outcomeOfMethodFailure(config, failureOptions(context))
    return passed({
      config,
      ...(result.facts ? { facts: result.facts } : {}),
      ...(result.credentialId ? { credentialId: result.credentialId } : {})
    })
  } catch (error) {
    return cancelledByAbort(context) ?? outcomeOfThrown(error)
  }
}

type SignedReply =
  | { ok: true; reply: ApproverReply; facts?: PasskeyFacts }
  | { ok: false; outcome: CeremonyOutcome<never> }

/** The signing half test access and create claim share: options, ceremony, reply. */
const signForRequest = async (
  context: HostContext & { request: ApproverRequest; params?: unknown },
  call: 'testAccess' | 'createClaim'
): Promise<SignedReply> => {
  const aborted = cancelledByAbort(context)
  if (aborted) return { ok: false, outcome: aborted }
  const chosen = chooseDevice(context, context.params)
  if (!chosen) return { ok: false, outcome: notSupported('no-implementation') }
  const { device } = chosen

  context.onStep?.('preparing')
  let input: unknown
  try {
    input = context.orchestrator.signingInput(context.request, chosen.params)
  } catch (error) {
    return { ok: false, outcome: outcomeOfThrown(error) }
  }

  const result = await device.sign(input, deviceContext(context, call))
  if (!result.ok) return { ok: false, outcome: result.stop }
  const abortedAfterDevice = cancelledByAbort(context)
  if (abortedAfterDevice) return { ok: false, outcome: abortedAfterDevice }

  context.onStep?.('packaging')
  try {
    const reply = await context.orchestrator.replyFrom(
      context.request,
      input,
      materialFor(context, result.material)
    )
    const abortedInMethod = cancelledByAbort(context)
    if (abortedInMethod) return { ok: false, outcome: abortedInMethod }
    if (isMethodFailure(reply)) {
      return { ok: false, outcome: outcomeOfMethodFailure(reply, failureOptions(context)) }
    }
    return { ok: true, reply, ...(result.facts ? { facts: result.facts } : {}) }
  } catch (error) {
    return { ok: false, outcome: cancelledByAbort(context) ?? outcomeOfThrown(error) }
  }
}

/**
 * Test access: sign the test challenge the caller's request carries, then run
 * the local check the wallet never enforces. The caller builds the request
 * whose digest is the test challenge; the host judges the proof through the
 * orchestrator's own verdict member, so no page holds a ctx.
 */
export const testAccessHost = async (
  context: HostContext & { request: ApproverRequest; params?: unknown }
): Promise<CeremonyOutcome<TestAccessValue>> => {
  const signed = await signForRequest(context, 'testAccess')
  if (!signed.ok) return signed.outcome
  context.onStep?.('checking')
  try {
    const verdict = await context.orchestrator.verify(
      context.request,
      context.request.place,
      signed.reply.proof
    )
    const abortedInCheck = cancelledByAbort(context)
    if (abortedInCheck) return abortedInCheck
    return outcomeOfCheck(verdict, {
      proof: signed.reply.proof,
      ...(signed.facts ? { facts: signed.facts } : {})
    })
  } catch (error) {
    return cancelledByAbort(context) ?? outcomeOfThrown(error)
  }
}

/**
 * Create claim: the reply for one place of a request. The method's packaging
 * runs its own local check before a reply leaves the device, so the host adds
 * none. An abort before the reply returns publishes no claim.
 */
export const createClaimHost = async (
  context: HostContext & { request: ApproverRequest; params?: unknown }
): Promise<CeremonyOutcome<ClaimValue>> => {
  const signed = await signForRequest(context, 'createClaim')
  if (!signed.ok) return signed.outcome
  return passed({ reply: signed.reply, ...(signed.facts ? { facts: signed.facts } : {}) })
}

/**
 * Health check: the unattended access test. This build does not run it, so
 * the host is a shell that answers not supported, with no retry, and asks
 * nothing of the method or the device.
 */
export const HEALTH_CHECK_IS_SHELL = true

export const healthCheckHost = async (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context?: Partial<HostContext>
): Promise<CeremonyOutcome<never>> => notSupported('no-implementation')
