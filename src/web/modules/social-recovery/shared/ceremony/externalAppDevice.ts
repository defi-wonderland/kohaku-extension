/**
 * The external-app device: the zkPassport request the holder answers in the
 * zkPassport app on a phone.
 *
 * The method's input carries the request's opener. The device opens the
 * request, hands the screen its link to draw as a code the phone scans, and
 * follows the phone through the request's callbacks: received, generating,
 * result. An enrollment's material is the verified result with its unique
 * identifier and proofs; a signature's material is the proofs, the outer one
 * binding the digest's text.
 *
 * The phone's refusal is the refused note, an error the phone reported is a
 * failure with its message, and a request that does not open is a device that
 * did not answer. The device keeps no timer of its own: the tab's expiry
 * rules hold. After an abort no callback is honoured.
 */
import type { Input, Material, ZkPassportStackProof } from '@kohaku-eth/social-recovery'

import type {
  CeremonyDevice,
  CeremonyStop,
  DeviceCallContext,
  DeviceResult,
  ZkPassportRequestWithResult
} from './types'
import { dismissed, failed, unavailable } from './verdicts'

const OUTER_EVM_PREFIX = 'outer_evm'

/** How far from the end of the outer proof's public inputs its scoped nullifier sits. */
const SCOPED_NULLIFIER_FROM_END = 2

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const REQUEST_CALLBACKS = [
  'onRequestReceived',
  'onGeneratingProof',
  'onProofGenerated',
  'onSuccess',
  'onReject',
  'onError'
] as const

/** Whether the app library's answer is a request this device can follow. */
const isRequest = (value: unknown): value is ZkPassportRequestWithResult =>
  isRecord(value) &&
  typeof value.url === 'string' &&
  REQUEST_CALLBACKS.every((name) => typeof value[name] === 'function') &&
  (value.onResult === undefined || typeof value.onResult === 'function')

/** The opener the method's input carries, or undefined where it carries none. */
const openerOf = (input: Input): (() => Promise<unknown>) | undefined => {
  const open = input.openRequest
  return typeof open === 'function' ? () => Promise.resolve(open()) : undefined
}

/**
 * The unique identifier the outer proof's public inputs carry, as a decimal
 * string, where the proof lists them.
 */
const identifierOf = (proofs: readonly ZkPassportStackProof[]): string | undefined => {
  const outer = proofs.find(
    (proof) => typeof proof.name === 'string' && proof.name.startsWith(OUTER_EVM_PREFIX)
  )
  const inputs = outer?.publicInputs
  if (!Array.isArray(inputs) || inputs.length < SCOPED_NULLIFIER_FROM_END) {
    return undefined
  }
  const word: unknown = inputs[inputs.length - SCOPED_NULLIFIER_FROM_END]
  if (typeof word !== 'string') {
    return undefined
  }
  try {
    return BigInt(word).toString()
  } catch {
    return undefined
  }
}

const cancelled = (): DeviceResult => ({
  ok: false,
  stop: dismissed('cancelled', 'AbortError')
})

const stopped = (stop: CeremonyStop): DeviceResult => ({ ok: false, stop })

/**
 * Follows one opened request until the phone answers, refuses or errs, or the
 * signal aborts. `listen` registers the callback whose answer is the material.
 */
const follow = (
  request: ZkPassportRequestWithResult,
  context: DeviceCallContext,
  listen: (settle: (result: DeviceResult) => void, proofs: ZkPassportStackProof[]) => void
): Promise<DeviceResult> =>
  new Promise((resolve) => {
    const { signal } = context
    let settled = false
    let onAbort = () => {}
    const settle = (result: DeviceResult) => {
      if (settled) {
        return
      }
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    onAbort = () => settle(cancelled())
    const whileOpen =
      <A extends unknown[]>(callback: (...args: A) => void) =>
      (...args: A) => {
        if (!settled && !signal?.aborted) {
          callback(...args)
        }
      }
    if (signal?.aborted) {
      settle(cancelled())
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const generated: ZkPassportStackProof[] = []
    request.onRequestReceived(whileOpen(() => context.onStep?.('requestReceived')))
    request.onGeneratingProof(whileOpen(() => context.onStep?.('generating')))
    request.onProofGenerated(
      whileOpen((proof: ZkPassportStackProof) => {
        generated.push(proof)
        context.onStep?.('resultReceived')
      })
    )
    request.onReject(whileOpen(() => settle(stopped(dismissed('refused')))))
    request.onError(
      whileOpen((message: string) =>
        settle(stopped(failed('phone-error', typeof message === 'string' ? message : undefined)))
      )
    )
    listen(whileOpen(settle), generated)

    context.show?.({ kind: 'scanCode', url: request.url })
    context.onStep?.('waitingForPhone')
  })

/** Opens the request the input carries, or the stop of a request that does not open. */
const open = async (
  input: Input,
  context: DeviceCallContext
): Promise<ZkPassportRequestWithResult | DeviceResult> => {
  const opener = openerOf(input)
  if (!opener) {
    return stopped(unavailable('device-unavailable'))
  }
  let request: unknown
  try {
    request = await opener()
  } catch {
    return context.signal?.aborted ? cancelled() : stopped(unavailable('device-unavailable'))
  }
  if (context.signal?.aborted) {
    return cancelled()
  }
  return isRequest(request) ? request : stopped(unavailable('device-unavailable'))
}

const isDeviceResult = (value: ZkPassportRequestWithResult | DeviceResult): value is DeviceResult =>
  'ok' in value

/**
 * The enrollment's material: the result callback's verified result, or, where
 * the library offers no result callback, a verified result built from the
 * success callback's proofs when their outer proof lists its identifier.
 */
const listenForResult =
  (request: ZkPassportRequestWithResult) =>
  (settle: (result: DeviceResult) => void): void => {
    if (request.onResult) {
      request.onResult((response) => {
        settle(
          isRecord(response)
            ? { ok: true, material: { result: response } }
            : stopped(unavailable('device-unavailable'))
        )
      })
      return
    }
    request.onSuccess(({ proofs }) => {
      const delivered = Array.isArray(proofs) ? proofs : []
      const uniqueIdentifier = identifierOf(delivered)
      settle(
        uniqueIdentifier
          ? {
              ok: true,
              material: { result: { verified: true, uniqueIdentifier, proofs: delivered } }
            }
          : stopped(unavailable('device-unavailable'))
      )
    })
  }

/** The signature's material: the proofs the success callback delivers, else those generated. */
const listenForProofs =
  (request: ZkPassportRequestWithResult) =>
  (settle: (result: DeviceResult) => void, generated: ZkPassportStackProof[]): void => {
    request.onSuccess(({ proofs }) => {
      const material: Material = {
        proofs: Array.isArray(proofs) && proofs.length > 0 ? proofs : [...generated]
      }
      settle({ ok: true, material })
    })
  }

/** The device of the `external-app` binding, the zkPassport app on the holder's phone. */
export const externalAppDevice = (): CeremonyDevice => ({
  enroll: async (input, context) => {
    if (context.signal?.aborted) {
      return cancelled()
    }
    const request = await open(input, context)
    if (isDeviceResult(request)) {
      return request
    }
    return follow(request, context, listenForResult(request))
  },
  sign: async (input, context) => {
    if (context.signal?.aborted) {
      return cancelled()
    }
    const request = await open(input, context)
    if (isDeviceResult(request)) {
      return request
    }
    return follow(request, context, listenForProofs(request))
  }
})
