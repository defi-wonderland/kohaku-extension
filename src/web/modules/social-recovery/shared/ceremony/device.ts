/**
 * The device call a host runs between the method's options and the method's
 * packaging: the extension calls the authenticator, the phone or the prover
 * itself and hands the method the material.
 *
 * A device returns the material, or a stop read before the method runs: the
 * cancelled or refused note, a relying party the extension does not serve, a
 * phone that never connected. A host never calls the method's packaging after
 * a stop.
 */
import type { CeremonyCall, CeremonyStop } from './verdicts'
import type { PasskeyFacts } from './webauthn'

/** The steps a host renders while it runs. */
export const CEREMONY_STEPS = [
  'preparing',
  'waitingForDevice',
  'waitingForPhone',
  'packaging',
  'checking'
] as const
export type CeremonyStep = typeof CEREMONY_STEPS[number]

export interface DeviceCallContext {
  /** Aborts the device call; an aborted call is the cancelled note. */
  signal?: AbortSignal
  /** The holder chose the browser's phone hand-off. */
  handOff?: boolean
  /** The lifecycle call the device serves; a test and a claim read a dismissal apart. */
  call?: CeremonyCall
  onStep?: (step: CeremonyStep) => void
}

export type DeviceResult =
  | {
      ok: true
      material: unknown
      /** The ceremony's own facts, a passkey's kind among them. */
      facts?: PasskeyFacts
      /** The credential id, base64url, where the ceremony minted or used one. */
      credentialId?: string
    }
  | { ok: false; stop: CeremonyStop }

export interface CeremonyDevice {
  /** The enrollment ceremony: `input` is what the method's `enrollInput` returned. */
  enroll(input: unknown, context: DeviceCallContext): Promise<DeviceResult>
  /** The signing ceremony: `input` is what the method's `signingInput` returned. */
  sign(input: unknown, context: DeviceCallContext): Promise<DeviceResult>
}

/**
 * A device whose material the caller already holds: the guardian's address at
 * enrollment, the signature the guardian's wallet returned, the proofs a
 * zkPassport bridge delivered or the QR data an Aadhaar upload decoded. The
 * device asks nothing of anyone.
 */
export const providedMaterialDevice = (material: {
  enroll?: unknown
  sign?: unknown
}): CeremonyDevice => ({
  enroll: async () => ({ ok: true, material: material.enroll }),
  sign: async () => ({ ok: true, material: material.sign })
})
