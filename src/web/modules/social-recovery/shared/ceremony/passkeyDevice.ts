/**
 * The passkey device: the extension calls the authenticator itself,
 * `navigator.credentials.create` at enrollment and `navigator.credentials.get`
 * at a claim and at an access test, and hands the method the result
 * (ux-interfaces.md D-372, sdk.md D-206).
 *
 * - `rp.id` and `rpId` are the extension's origin host; the method receives
 *   the full origin string as its relying party id, and the credential's rp id
 *   hash must equal `sha256("chrome-extension://<id>")` (D-314).
 * - The synced or device-bound kind comes from the ceremony's own flags.
 * - A high `s` is lowered before the method receives the assertion.
 * - A browser error is read before the method runs.
 *
 * The credentials container, the relying party, the clock and the randomness
 * are parameters, so a test runs the device with a mocked
 * `navigator.credentials` and a fabricated authenticator data.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'
import { hexToBytes, isHex } from 'viem'

import type { CeremonyDevice, DeviceCallContext, DeviceResult } from './device'
import { dismissed, failed } from './verdicts'
import {
  authDataFromAttestationObject,
  CEREMONY_TIMEOUT_MS,
  fromBase64Url,
  normalizeDerSignature,
  passkeyFactsOf,
  readAuthenticatorData,
  RelyingParty,
  stopOfCeremonyError,
  toBytes,
  WebAuthnCall
} from './webauthn'

/** The relying party's display name the authenticator may show beside the rp id. */
export const RELYING_PARTY_NAME = 'Kohaku'

/**
 * The page's own passkey device: a device that carries the relying party it
 * was built over, so a host hands the method that relying party's origin
 * string and never one a caller chose.
 */
export interface PasskeyCeremonyDevice extends CeremonyDevice {
  readonly relyingParty: RelyingParty
}

/** The part of `navigator.credentials` the device calls. */
export interface CredentialsLike {
  create(options: CredentialCreationOptions): Promise<Credential | null>
  get(options: CredentialRequestOptions): Promise<Credential | null>
}

export interface PasskeyDeviceOptions {
  credentials: CredentialsLike
  relyingParty: RelyingParty
  timeoutMs?: number
  now?: () => number
  randomBytes?: (length: number) => Uint8Array
}

/** The creation options a passkey method's `enrollInput` returns (sdk.md D-206). */
export interface PasskeyEnrollInput {
  rp?: { id?: string; name?: string }
  user?: { id?: string; name?: string; displayName?: string }
  pubKeyCredParams?: { type: 'public-key'; alg: number }[]
  authenticatorSelection?: AuthenticatorSelectionCriteria
  attestation?: AttestationConveyancePreference
  excludeCredentials?: { type?: 'public-key'; id: string }[]
  challenge?: string
}

/** The request options a passkey method's `signingInput` returns (sdk.md D-206). */
export interface PasskeySigningInput {
  challenge: Hex | string
  rpId?: string
  userVerification?: UserVerificationRequirement
  allowCredentials?: { type?: 'public-key'; id: string }[]
}

/**
 * The assertion the method receives: the browser's `PublicKeyCredential` copied
 * field by field, with `response.signature` in the low-s form.
 */
export interface NormalizedAssertion {
  id: string
  rawId: ArrayBuffer
  type: string
  authenticatorAttachment: string | null
  response: {
    authenticatorData: ArrayBuffer
    clientDataJSON: ArrayBuffer
    signature: ArrayBuffer
    userHandle: ArrayBuffer | null
  }
  /** Whether the device lowered a high `s`. */
  signatureNormalized: boolean
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs
}

const ES256 = -7

const defaultRandomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/** A copy of `bytes` as its own ArrayBuffer, the buffer type WebAuthn's options take. */
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/** A credential id as bytes: base64url, the form `PublicKeyCredential.id` takes, or hex. */
export const credentialIdBytes = (id: string): Uint8Array =>
  isHex(id) ? hexToBytes(id) : fromBase64Url(id)

/** The challenge as bytes: the digest in hex, or base64url. */
export const challengeBytes = (challenge: string): Uint8Array =>
  isHex(challenge) ? hexToBytes(challenge) : fromBase64Url(challenge)

/**
 * Whether the method asked for the extension's own relying party: the full
 * origin string `chrome-extension://<id>` and nothing else. The bare id, an
 * empty string or no value is refused (D-314, D-372): the host hands the
 * method that origin string itself, so a method that names another value
 * names a relying party this extension does not serve.
 */
export const isOwnRelyingParty = (asked: string | undefined, rp: RelyingParty): boolean =>
  asked === rp.relyingPartyId

/**
 * The options `navigator.credentials.create` takes, from the method's input.
 * The method names the relying party by its origin string, the browser by the
 * host: the host replaces the id and keeps every other member the method set.
 * The hand-off asks for a cross-platform authenticator over the hybrid route.
 */
export const creationOptionsFrom = (
  input: PasskeyEnrollInput,
  rp: RelyingParty,
  settings: { handOff?: boolean; timeoutMs: number; challenge: Uint8Array; userId: Uint8Array }
): PublicKeyCredentialCreationOptions => {
  const name = input.user?.name || RELYING_PARTY_NAME
  const options: PublicKeyCredentialCreationOptions & { hints?: string[] } = {
    rp: { id: rp.rpId, name: input.rp?.name || RELYING_PARTY_NAME },
    user: {
      id: toArrayBuffer(input.user?.id ? credentialIdBytes(input.user.id) : settings.userId),
      name,
      displayName: input.user?.displayName || name
    },
    challenge: toArrayBuffer(
      input.challenge ? challengeBytes(input.challenge) : settings.challenge
    ),
    pubKeyCredParams: input.pubKeyCredParams?.length
      ? input.pubKeyCredParams
      : [{ type: 'public-key', alg: ES256 }],
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
      ...input.authenticatorSelection,
      ...(settings.handOff ? { authenticatorAttachment: 'cross-platform' } : {})
    },
    attestation: input.attestation ?? 'none',
    timeout: settings.timeoutMs,
    ...(input.excludeCredentials?.length
      ? {
          excludeCredentials: input.excludeCredentials.map((c) => ({
            type: 'public-key' as const,
            id: toArrayBuffer(credentialIdBytes(c.id))
          }))
        }
      : {}),
    ...(settings.handOff ? { hints: ['hybrid'] } : {})
  }
  return options
}

/** The options `navigator.credentials.get` takes, from the method's input. */
export const requestOptionsFrom = (
  input: PasskeySigningInput,
  rp: RelyingParty,
  settings: { handOff?: boolean; timeoutMs: number }
): PublicKeyCredentialRequestOptions => {
  const options: PublicKeyCredentialRequestOptions & { hints?: string[] } = {
    challenge: toArrayBuffer(challengeBytes(input.challenge)),
    rpId: rp.rpId,
    userVerification: input.userVerification ?? 'required',
    timeout: settings.timeoutMs,
    ...(input.allowCredentials?.length
      ? {
          allowCredentials: input.allowCredentials.map((c) => ({
            type: 'public-key' as const,
            id: toArrayBuffer(credentialIdBytes(c.id))
          }))
        }
      : {}),
    ...(settings.handOff ? { hints: ['hybrid'] } : {})
  }
  return options
}

type AttestationResponseLike = {
  attestationObject?: ArrayBuffer
  getAuthenticatorData?: () => ArrayBuffer
  getTransports?: () => string[]
}

type AssertionResponseLike = {
  authenticatorData: ArrayBuffer
  clientDataJSON: ArrayBuffer
  signature: ArrayBuffer
  userHandle?: ArrayBuffer | null
}

type PublicKeyCredentialLike = {
  id: string
  rawId: ArrayBuffer
  type: string
  authenticatorAttachment?: string | null
  response: unknown
  getClientExtensionResults?: () => AuthenticationExtensionsClientOutputs
}

const enrollmentAuthData = (response: AttestationResponseLike): Uint8Array | null => {
  if (typeof response.getAuthenticatorData === 'function') {
    return toBytes(response.getAuthenticatorData())
  }
  return response.attestationObject
    ? authDataFromAttestationObject(response.attestationObject)
    : null
}

/** The passkey device over a credentials container and a relying party. */
export const createPasskeyDevice = ({
  credentials,
  relyingParty,
  timeoutMs = CEREMONY_TIMEOUT_MS,
  now = () => Date.now(),
  randomBytes = defaultRandomBytes
}: PasskeyDeviceOptions): PasskeyCeremonyDevice => {
  const run = async (
    context: DeviceCallContext,
    webAuthnCall: WebAuthnCall,
    call: () => Promise<Credential | null>,
    read: (credential: PublicKeyCredentialLike) => DeviceResult
  ): Promise<DeviceResult> => {
    if (context.signal?.aborted) return { ok: false, stop: dismissed('cancelled', 'AbortError') }
    context.onStep?.(context.handOff ? 'waitingForPhone' : 'waitingForDevice')
    const startedAt = now()
    let credential: Credential | null
    try {
      credential = await call()
    } catch (error) {
      return {
        ok: false,
        stop: stopOfCeremonyError(error, {
          call: webAuthnCall,
          handOff: context.handOff,
          elapsedMs: now() - startedAt,
          timeoutMs
        })
      }
    }
    if (!credential) return { ok: false, stop: dismissed('cancelled') }
    if (context.signal?.aborted) return { ok: false, stop: dismissed('cancelled', 'AbortError') }
    try {
      return read(credential as unknown as PublicKeyCredentialLike)
    } catch (error) {
      return {
        ok: false,
        stop: failed('material-rejected')
      }
    }
  }

  return {
    relyingParty,

    async enroll(input: unknown, context: DeviceCallContext): Promise<DeviceResult> {
      const asked = input as PasskeyEnrollInput | undefined
      if (!isOwnRelyingParty(asked?.rp?.id, relyingParty)) {
        return { ok: false, stop: failed('relying-party-mismatch') }
      }
      const publicKey = creationOptionsFrom(asked ?? {}, relyingParty, {
        handOff: context.handOff,
        timeoutMs,
        challenge: randomBytes(32),
        userId: randomBytes(16)
      })
      return run(
        context,
        'create',
        () => credentials.create({ publicKey, signal: context.signal }),
        (credential) => {
          const response = credential.response as AttestationResponseLike
          const authData = enrollmentAuthData(response)
          if (!authData) throw new Error('The credential carries no authenticator data.')
          if (readAuthenticatorData(authData).rpIdHash !== relyingParty.rpIdHash) {
            return { ok: false, stop: failed('relying-party-mismatch') }
          }
          const facts = passkeyFactsOf({
            authenticatorData: authData,
            authenticatorAttachment: credential.authenticatorAttachment,
            transports: typeof response.getTransports === 'function' ? response.getTransports() : []
          })
          return { ok: true, material: { credential }, facts, credentialId: credential.id }
        }
      )
    },

    async sign(input: unknown, context: DeviceCallContext): Promise<DeviceResult> {
      const asked = input as PasskeySigningInput | undefined
      if (!asked?.challenge) return { ok: false, stop: failed('material-rejected') }
      if (!isOwnRelyingParty(asked.rpId, relyingParty)) {
        return { ok: false, stop: failed('relying-party-mismatch') }
      }
      const publicKey = requestOptionsFrom(asked, relyingParty, {
        handOff: context.handOff,
        timeoutMs
      })
      return run(
        context,
        'get',
        () => credentials.get({ publicKey, signal: context.signal }),
        (credential) => {
          const response = credential.response as AssertionResponseLike
          const authData = toBytes(response.authenticatorData)
          if (readAuthenticatorData(authData).rpIdHash !== relyingParty.rpIdHash) {
            return { ok: false, stop: failed('relying-party-mismatch') }
          }
          const { signature, normalized } = normalizeDerSignature(response.signature)
          const assertion: NormalizedAssertion = {
            id: credential.id,
            rawId: credential.rawId,
            type: credential.type,
            authenticatorAttachment: credential.authenticatorAttachment ?? null,
            response: {
              authenticatorData: response.authenticatorData,
              clientDataJSON: response.clientDataJSON,
              signature: toArrayBuffer(signature),
              userHandle: response.userHandle ?? null
            },
            signatureNormalized: normalized,
            getClientExtensionResults: () => credential.getClientExtensionResults?.() ?? {}
          }
          const facts = passkeyFactsOf({
            authenticatorData: authData,
            authenticatorAttachment: credential.authenticatorAttachment
          })
          return { ok: true, material: { assertion }, facts, credentialId: credential.id }
        }
      )
    }
  }
}
