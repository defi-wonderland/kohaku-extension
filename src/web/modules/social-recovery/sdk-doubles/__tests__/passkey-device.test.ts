import { PasskeyMethodDouble } from '@web/modules/social-recovery/sdk-doubles'
import type {
  ApproverReply,
  ApproverRequest,
  Hex
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  createClaimHost,
  createPasskeyDevice,
  enrollHost,
  relyingPartyOf,
  testAccessHost
} from '@web/modules/social-recovery/shared/ceremony'
import {
  authenticatorData,
  derSignature,
  EXTENSION_ID,
  EXTENSION_ORIGIN,
  fakeAttestation,
  ORIGIN_HASH,
  P256_N,
  SYNCED_FLAGS,
  toBuffer
} from '@web/modules/social-recovery/shared/ceremony/__tests__/harness'
import { toBase64Url } from '@web/modules/social-recovery/shared/webauthn'
import { bytesToBigInt, bytesToHex, hexToBytes, sha256, stringToBytes, stringToHex } from 'viem'

import { openRecovery } from './harness'

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const

const relyingParty = relyingPartyOf({ protocol: 'chrome-extension:', host: EXTENSION_ID })

const generateKey = async () => {
  const pair = (await crypto.subtle.generateKey(ECDSA_P256, true, [
    'sign',
    'verify'
  ])) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { privateKey: pair.privateKey, point: { x: raw.slice(1, 33), y: raw.slice(33, 65) } }
}

type Key = Awaited<ReturnType<typeof generateKey>>

const clientDataOf = (challenge: Uint8Array, origin = EXTENSION_ORIGIN) =>
  stringToBytes(JSON.stringify({ type: 'webauthn.get', challenge: toBase64Url(challenge), origin }))

/**
 * The credential `navigator.credentials.get` resolves: authenticator data under
 * the extension's relying party, the client data over `challenge`, and a DER
 * signature by `key` over `authenticatorData || sha256(clientDataJSON)`.
 */
const signedAssertion = async (
  key: Key,
  challenge: Uint8Array,
  {
    clientData = clientDataOf(challenge),
    signedClientData = clientData,
    highS = false,
    withSignature = true
  }: {
    clientData?: Uint8Array
    signedClientData?: Uint8Array
    highS?: boolean
    withSignature?: boolean
  } = {}
) => {
  const authData = authenticatorData({ flags: SYNCED_FLAGS })
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      ECDSA_SHA256,
      key.privateKey,
      toBuffer(Uint8Array.from([...authData, ...sha256(signedClientData, 'bytes')]))
    )
  )
  const r = bytesToBigInt(raw.slice(0, 32))
  const low = bytesToBigInt(raw.slice(32))
  const lowS = low > P256_N / BigInt(2) ? P256_N - low : low
  const signature = derSignature(r, highS ? P256_N - lowS : lowS)
  const rawId = Uint8Array.from({ length: 20 }, (_, i) => i + 1)
  return {
    id: toBase64Url(rawId),
    rawId: toBuffer(rawId),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: toBuffer(clientData),
      authenticatorData: toBuffer(authData),
      ...(withSignature ? { signature: toBuffer(signature) } : {}),
      userHandle: null
    },
    getClientExtensionResults: () => ({})
  }
}

const challengeOf = (options?: CredentialRequestOptions): Uint8Array =>
  new Uint8Array(options?.publicKey?.challenge as ArrayBuffer)

/** A world, a device over fake WebAuthn calls, and the hosts' shared context. */
const setUp = async ({
  create,
  get
}: {
  create: () => Promise<unknown>
  get: (options?: CredentialRequestOptions) => Promise<unknown>
}) => {
  const { world, requests } = await openRecovery()
  const credentials = {
    create: jest.fn(async () => (await create()) as Credential),
    get: jest.fn(async (options?: CredentialRequestOptions) => (await get(options)) as Credential)
  }
  const device = createPasskeyDevice({ credentials, relyingParty })
  const orchestrator = world.orchestrator()
  const context = {
    orchestrator,
    method: world.methods.passkey,
    devices: { 'browser-authenticator': device }
  }
  return { world, request: requests[0]!, credentials, context, orchestrator }
}

type Setup = Awaited<ReturnType<typeof setUp>>

const enroll = async (setup: Setup) =>
  enrollHost({
    ...setup.context,
    methodAddress: setup.world.descriptor.methodPasskey,
    params: { userName: 'holder' }
  })

const enrolledRequest = async (setup: Setup): Promise<ApproverRequest> => {
  const outcome = await enroll(setup)
  if (outcome.kind !== 'verdict' || outcome.verdict !== 'passed') {
    throw new Error(`the enrollment did not pass: ${JSON.stringify(outcome)}`)
  }
  return {
    ...setup.request,
    method: setup.world.descriptor.methodPasskey,
    config: outcome.value.config
  }
}

const claim = async (setup: Setup, request: ApproverRequest): Promise<ApproverReply> => {
  const outcome = await createClaimHost({ ...setup.context, request })
  if (outcome.kind !== 'verdict' || outcome.verdict !== 'passed') {
    throw new Error(`the claim did not pass: ${JSON.stringify(outcome)}`)
  }
  return outcome.value.reply
}

describe('the passkey device into the passkey method double', () => {
  it('enrolls a config that holds the credential key beside the relying party hash', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async () => null
    })
    const outcome = await enroll(setup)
    expect(outcome).toMatchObject({ kind: 'verdict', verdict: 'passed' })
    if (outcome.kind !== 'verdict' || outcome.verdict !== 'passed') {
      return
    }
    expect(setup.world.methods.passkey.codec.decodeConfig(outcome.value.config)).toEqual({
      x: bytesToHex(key.point.x),
      y: bytesToHex(key.point.y),
      rpIdHash: sha256(stringToHex(EXTENSION_ORIGIN))
    })
    expect(sha256(stringToHex(EXTENSION_ORIGIN))).toBe(ORIGIN_HASH)
  })

  it('reads the key from the authenticator data where the browser offers no getPublicKey', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => {
        const { credential } = fakeAttestation({ flags: SYNCED_FLAGS, point: key.point })
        const response = credential.response as AuthenticatorAttestationResponse
        return {
          ...credential,
          response: {
            clientDataJSON: response.clientDataJSON,
            attestationObject: response.attestationObject,
            getTransports: () => ['internal']
          }
        }
      },
      get: async () => null
    })
    const outcome = await enroll(setup)
    if (outcome.kind !== 'verdict' || outcome.verdict !== 'passed') {
      throw new Error(`the enrollment did not pass: ${JSON.stringify(outcome)}`)
    }
    expect(setup.world.methods.passkey.codec.decodeConfig(outcome.value.config)).toMatchObject({
      x: bytesToHex(key.point.x),
      y: bytesToHex(key.point.y)
    })
  })

  it('ends material-rejected for a credential without a readable key', async () => {
    const setup = await setUp({
      create: async () => ({
        id: 'AQID',
        rawId: toBuffer(Uint8Array.from([1, 2, 3])),
        type: 'public-key',
        authenticatorAttachment: 'platform',
        response: {
          getAuthenticatorData: () => toBuffer(authenticatorData({ flags: SYNCED_FLAGS })),
          getPublicKey: () => null,
          getTransports: () => ['internal']
        },
        getClientExtensionResults: () => ({})
      }),
      get: async () => null
    })
    expect(await enroll(setup)).toMatchObject({
      kind: 'verdict',
      verdict: 'failed',
      cause: 'material-rejected'
    })
  })

  it('packages a reply the double verifies satisfied, and the access test passes', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async (options) => signedAssertion(key, challengeOf(options))
    })
    const request = await enrolledRequest(setup)
    const reply = await claim(setup, request)
    await expect(setup.orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
      'satisfied'
    )
    expect(await testAccessHost({ ...setup.context, request })).toMatchObject({
      kind: 'verdict',
      verdict: 'passed'
    })
  })

  it('satisfies with a high s the device lowers before the method runs', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async (options) => signedAssertion(key, challengeOf(options), { highS: true })
    })
    const request = await enrolledRequest(setup)
    const reply = await claim(setup, request)
    await expect(setup.orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
      'satisfied'
    )
  })

  it('rejects a reply whose client data was changed after signing', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async (options) => {
        const challenge = challengeOf(options)
        return signedAssertion(key, challenge, {
          clientData: clientDataOf(challenge, 'chrome-extension://another'),
          signedClientData: clientDataOf(challenge)
        })
      }
    })
    const request = await enrolledRequest(setup)
    const reply = await claim(setup, request)
    await expect(setup.orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
      'rejected'
    )
    expect(await testAccessHost({ ...setup.context, request })).toMatchObject({
      verdict: 'failed',
      cause: 'check-rejected'
    })
  })

  it('rejects a reply signed by a key other than the enrolled one', async () => {
    const enrolled = await generateKey()
    const other = await generateKey()
    const setup = await setUp({
      create: async () =>
        fakeAttestation({ flags: SYNCED_FLAGS, point: enrolled.point }).credential,
      get: async (options) => signedAssertion(other, challengeOf(options))
    })
    const request = await enrolledRequest(setup)
    const reply = await claim(setup, request)
    await expect(setup.orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
      'rejected'
    )
  })

  it('rejects a reply signed over another challenge', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async () => signedAssertion(key, new Uint8Array(32).fill(0x5a))
    })
    const request = await enrolledRequest(setup)
    const reply = await claim(setup, request)
    await expect(setup.orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
      'rejected'
    )
  })

  it('ends material-rejected for an assertion without a signature', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async (options) => signedAssertion(key, challengeOf(options), { withSignature: false })
    })
    const request = await enrolledRequest(setup)
    expect(await createClaimHost({ ...setup.context, request })).toMatchObject({
      kind: 'verdict',
      verdict: 'failed',
      cause: 'material-rejected'
    })
  })

  it('refuses an assertion without a signature when it reaches the method itself', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async () => null
    })
    const request = await enrolledRequest(setup)
    const input = setup.orchestrator.signingInput(request, { relyingPartyId: EXTENSION_ORIGIN })
    const assertion = await signedAssertion(key, new Uint8Array(32), { withSignature: false })
    await expect(setup.orchestrator.replyFrom(request, input, { assertion })).resolves.toEqual({
      kind: 'reply-failure',
      cause: 'material-rejected'
    })
  })

  it('packages a high s the method receives as its low half', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async () => null
    })
    const request = await enrolledRequest(setup)
    const input = setup.orchestrator.signingInput(request, {
      relyingPartyId: EXTENSION_ORIGIN
    }) as { challenge: Hex }
    const assertion = await signedAssertion(key, hexToBytes(input.challenge), { highS: true })
    const reply = (await setup.orchestrator.replyFrom(request, input, {
      assertion
    })) as ApproverReply
    const { s } = setup.world.methods.passkey.codec.decodeProof(reply.proof) as { s: Hex }
    expect(BigInt(s) <= P256_N / BigInt(2)).toBe(true)
    await expect(setup.orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
      'satisfied'
    )
  })
})

describe('the passkey method double without WebCrypto', () => {
  it('judges nothing where the runtime has no crypto.subtle', async () => {
    const key = await generateKey()
    const setup = await setUp({
      create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point: key.point }).credential,
      get: async (options) => signedAssertion(key, challengeOf(options))
    })
    const request = await enrolledRequest(setup)
    const reply = await claim(setup, request)
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      await expect(setup.orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
        'not-judged'
      )
    } finally {
      if (saved) {
        Object.defineProperty(globalThis, 'crypto', saved)
      } else {
        delete (globalThis as { crypto?: unknown }).crypto
      }
    }
    await expect(setup.orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
      'satisfied'
    )
  })
})

describe("the passkey double's willing device", () => {
  it('returns material that satisfies the config it commits', async () => {
    const { world, requests } = await openRecovery()
    const double = new PasskeyMethodDouble()
    const request: ApproverRequest = {
      ...requests[0]!,
      method: world.descriptor.methodPasskey,
      config: double.satisfyingConfig(EXTENSION_ORIGIN)
    }
    const orchestrator = world.orchestrator()
    const input = orchestrator.signingInput(request, { relyingPartyId: EXTENSION_ORIGIN })
    const reply = (await orchestrator.replyFrom(
      request,
      input,
      await double.satisfyingMaterial(request)
    )) as ApproverReply
    await expect(orchestrator.verify(request, request.place, reply.proof)).resolves.toBe(
      'satisfied'
    )
    const elsewhere = { ...request, config: double.satisfyingConfig('wallet.example') }
    await expect(orchestrator.verify(elsewhere, request.place, reply.proof)).resolves.toBe(
      'rejected'
    )
  })
})
