/**
 * The doubles' own byte arithmetic. None of it is the SDK's: the real formats
 * (sdk.md D-204) ABI-encode the setup body, derive EIP-712 digests and seal the
 * backup under a real cipher. The doubles only need values that are
 * deterministic, distinct and round-trip, so they hash canonical JSON with
 * keccak256. A screen never reads these bytes as anything but opaque `Hex`.
 *
 * The one real encoding here is the handover payload (the action codec double),
 * which is `abi.encode(address newAuthority, address removedAuthority)` as
 * contracts D-105 lays it out.
 */
import { concat, hexToString, keccak256, pad, stringToHex } from 'viem'

import type {
  Address,
  ApproverRequest,
  AttemptRequest,
  CancelRequest,
  Configuration,
  Credential,
  Hex,
  PaymentOrder,
  SerializedPaymentOrder
} from '@web/modules/social-recovery/sdk-interfaces'

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'
export const ZERO_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

/** JSON with bigints written as `{"$bigint":"..."}` so they come back as bigints. */
export const toJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v))

export const fromJson = <T>(text: string): T =>
  JSON.parse(text, (_key, v) =>
    v && typeof v === 'object' && typeof v.$bigint === 'string' && Object.keys(v).length === 1
      ? BigInt(v.$bigint)
      : v
  ) as T

export const jsonHex = (value: unknown): Hex => stringToHex(toJson(value))

export const hexJson = <T>(hex: Hex): T => fromJson<T>(hexToString(hex))

/** A deterministic 32-byte value for anything JSON can carry. */
export const hashOf = (value: unknown): Hex => keccak256(jsonHex(value))

/** A deterministic address for a label, for the doubles' default fixtures. */
export const addressOf = (label: string): Address =>
  `0x${keccak256(stringToHex(`address:${label}`)).slice(26)}` as Address

export const blockHashOf = (blockNumber: number): Hex => hashOf({ block: blockNumber })

/** An address as a 32-byte topic. */
export const topicOf = (address: Address): Hex => pad(address.toLowerCase() as Hex, { size: 32 })

export const sameAddress = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** The default salt of D-110, keccak256(account, place), in the doubles' hashing. */
export const defaultSalt = (account: Address, place: number): Hex =>
  hashOf({ salt: account.toLowerCase(), place })

export const credentialHash = (method: Address, config: Hex, salt: Hex): Hex =>
  hashOf({ credential: [method.toLowerCase(), config, salt] })

/** One credential with its place and the salt that fills it. */
export interface PlacedCredential {
  place: number
  clause: number
  credential: Credential
  salt: Hex
}

/** The flat place numbering of D-103: body order across every clause. */
export const placesOf = (account: Address, configuration: Configuration): PlacedCredential[] => {
  const placed: PlacedCredential[] = []
  configuration.clauses.forEach((clause, clauseIndex) => {
    clause.credentials.forEach((credential) => {
      const place = placed.length
      placed.push({
        place,
        clause: clauseIndex,
        credential,
        salt: credential.salt ?? defaultSalt(account, place)
      })
    })
  })
  return placed
}

/** The doubles' setup body: what the real body of D-103 carries, as JSON bytes. */
export interface DoubleSetupBody {
  wait: bigint
  ignoresPause: boolean
  clauses: { threshold: number; credentials: Hex[] }[]
}

export const setupBodyOf = (account: Address, configuration: Configuration): Hex => {
  const placed = placesOf(account, configuration)
  const body: DoubleSetupBody = {
    wait: configuration.wait,
    ignoresPause: configuration.ignoresPause,
    clauses: configuration.clauses.map((clause, index) => ({
      threshold: clause.threshold,
      credentials: placed
        .filter((p) => p.clause === index)
        .map((p) => credentialHash(p.credential.method, p.credential.config, p.salt))
    }))
  }
  return jsonHex(body)
}

export const readSetupBody = (body: Hex): DoubleSetupBody => hexJson<DoubleSetupBody>(body)

export const setupCommitmentOf = (
  account: Address,
  action: Address,
  nonce: bigint,
  body: Hex
): Hex => hashOf({ commitment: [account.toLowerCase(), action.toLowerCase(), nonce, body] })

/** A configuration without its labels, which the commitment and the backup never carry. */
export const withoutLabels = (configuration: Configuration): Configuration => ({
  wait: configuration.wait,
  ignoresPause: configuration.ignoresPause,
  clauses: configuration.clauses.map((clause) => ({
    threshold: clause.threshold,
    credentials: clause.credentials.map(({ method, config, salt }) =>
      salt ? { method, config, salt } : { method, config }
    )
  }))
})

// ---------------------------------------------------------------------------
// The backup payload and the public note (D-204, D-375), in the doubles' bytes.
// ---------------------------------------------------------------------------

const SEALED_MARK = 'kohaku-double:sealed:'
const CLEAR_MARK = 'kohaku-double:clear:'
const SHAPE_MARK = 'kohaku-double:shape:'

const passwordTag = (password: string): string => hashOf({ password }).slice(2, 18)

const xorWithPassword = (text: string, password: string): string => {
  const key = hashOf({ key: password }).slice(2)
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const k = parseInt(key.slice((i * 2) % key.length, ((i * 2) % key.length) + 2), 16)
    // A keyed XOR is the doubles' stand-in cipher; it keeps the values unreadable, nothing more.
    // eslint-disable-next-line no-bitwise
    out += (text.charCodeAt(i) ^ k).toString(16).padStart(4, '0')
  }
  return out
}

const unxorWithPassword = (hexText: string, password: string): string => {
  const key = hashOf({ key: password }).slice(2)
  let out = ''
  for (let i = 0; i * 4 < hexText.length; i++) {
    const k = parseInt(key.slice((i * 2) % key.length, ((i * 2) % key.length) + 2), 16)
    // eslint-disable-next-line no-bitwise
    out += String.fromCharCode(parseInt(hexText.slice(i * 4, i * 4 + 4), 16) ^ k)
  }
  return out
}

/** The encrypted backup: unreadable without the password, and it says which password. */
export const sealBackup = (configuration: Configuration, password: string): Hex =>
  stringToHex(
    `${SEALED_MARK}${passwordTag(password)}:${xorWithPassword(
      toJson(withoutLabels(configuration)),
      password
    )}`
  )

/** The clear backup: the configuration in the clear, the public level's private field. */
export const clearBackup = (configuration: Configuration): Hex =>
  stringToHex(`${CLEAR_MARK}${toJson(withoutLabels(configuration))}`)

/** The public note of the shape-visible level: thresholds and methods, no config values. */
export const shapeNote = (configuration: Configuration): Hex =>
  stringToHex(
    `${SHAPE_MARK}${toJson({
      wait: configuration.wait,
      ignoresPause: configuration.ignoresPause,
      clauses: configuration.clauses.map((c) => ({
        threshold: c.threshold,
        methods: c.credentials.map((cr) => cr.method)
      }))
    })}`
  )

/** The public note of the public level: everything in the clear. */
export const clearNote = (configuration: Configuration): Hex =>
  stringToHex(`${CLEAR_MARK}${toJson(withoutLabels(configuration))}`)

export type BackupReading =
  | { form: 'empty' }
  | { form: 'clear'; configuration: Configuration }
  | { form: 'encrypted'; opened: true; configuration: Configuration }
  | { form: 'encrypted'; opened: false }
  | { form: 'unreadable' }

const safeText = (hex: Hex): string | undefined => {
  try {
    return hexToString(hex)
  } catch {
    return undefined
  }
}

/** Reads a private field: empty, clear, or encrypted (opened with the password when it fits). */
export const readBackup = (privateMetadata: Hex, password?: string): BackupReading => {
  if (!privateMetadata || privateMetadata === '0x') return { form: 'empty' }
  const text = safeText(privateMetadata)
  if (text === undefined) return { form: 'unreadable' }
  if (text.startsWith(CLEAR_MARK)) {
    return { form: 'clear', configuration: fromJson<Configuration>(text.slice(CLEAR_MARK.length)) }
  }
  if (text.startsWith(SEALED_MARK)) {
    const rest = text.slice(SEALED_MARK.length)
    const tag = rest.slice(0, 16)
    if (password === undefined || tag !== passwordTag(password)) {
      return { form: 'encrypted', opened: false }
    }
    try {
      const configuration = fromJson<Configuration>(unxorWithPassword(rest.slice(17), password))
      return { form: 'encrypted', opened: true, configuration }
    } catch {
      return { form: 'encrypted', opened: false }
    }
  }
  return { form: 'unreadable' }
}

/** Which D-375 level two metadata fields encode, read back from their markers. */
export const levelOfMetadata = (
  publicMetadata: Hex,
  privateMetadata: Hex
): 'private' | 'shape-visible' | 'public' => {
  const priv = privateMetadata && privateMetadata !== '0x' ? safeText(privateMetadata) : ''
  const pub = publicMetadata && publicMetadata !== '0x' ? safeText(publicMetadata) : ''
  if (priv?.startsWith(CLEAR_MARK) || pub?.startsWith(CLEAR_MARK)) return 'public'
  if (pub?.startsWith(SHAPE_MARK)) return 'shape-visible'
  return 'private'
}

// ---------------------------------------------------------------------------
// Digests and proofs (D-204, D-206), in the doubles' hashing.
// ---------------------------------------------------------------------------

/** The members a place's digest closes over, every number as a decimal string. */
export interface DigestMembers {
  chainId: string
  manager: Address
  digestVersion: string
  purpose: 'approval' | 'cancellation'
  account: Address
  action: Address
  attemptId: string
  setupNonce: string
  setupBodyHash: Hex
  payload?: Hex
  order?: SerializedPaymentOrder
  validUntil: string
  place: number
  method: Address
  config: Hex
  salt: Hex
}

export const serializeOrder = (order: PaymentOrder): SerializedPaymentOrder => ({
  token: order.token,
  amount: order.amount.toString(),
  payee: order.payee
})

export const deserializeOrder = (order: SerializedPaymentOrder): PaymentOrder => ({
  token: order.token,
  amount: BigInt(order.amount),
  payee: order.payee
})

export const digestOf = (m: DigestMembers): Hex =>
  hashOf({
    digest: [
      m.chainId,
      m.manager.toLowerCase(),
      m.digestVersion,
      m.purpose,
      m.account.toLowerCase(),
      m.action.toLowerCase(),
      m.attemptId,
      m.setupNonce,
      m.setupBodyHash,
      m.purpose === 'approval' ? m.payload ?? '0x' : null,
      m.purpose === 'approval' && m.order
        ? [m.order.token.toLowerCase(), m.order.amount, m.order.payee.toLowerCase()]
        : null,
      m.validUntil,
      m.place,
      m.method.toLowerCase(),
      m.config,
      m.salt
    ]
  })

/** The digest one approver's request names for its place. */
export const digestOfRequest = (request: ApproverRequest): Hex =>
  digestOf({
    chainId: request.chainId,
    manager: request.manager,
    digestVersion: request.digestVersion,
    purpose: request.purpose,
    account: request.account,
    action: request.action,
    attemptId: request.attemptId,
    setupNonce: request.setupNonce,
    setupBodyHash: request.setupBodyHash,
    payload: request.payload,
    order: request.order,
    validUntil: request.validUntil,
    place: request.place,
    method: request.method,
    config: request.config,
    salt: request.salt
  })

/** The digest a submitted request's proof at one place must be over. */
export const digestOfSubmission = (
  request: AttemptRequest | CancelRequest,
  domain: { chainId: number | bigint; manager: Address; digestVersion: string },
  proofIndex: number
): Hex => {
  const proof = request.proofs[proofIndex]
  const isApproval = 'payload' in request
  return digestOf({
    chainId: domain.chainId.toString(),
    manager: domain.manager,
    digestVersion: domain.digestVersion,
    purpose: isApproval ? 'approval' : 'cancellation',
    account: request.account,
    action: request.action,
    attemptId: request.attemptId.toString(),
    setupNonce: request.setupNonce.toString(),
    setupBodyHash: keccak256(request.setupBody),
    payload: isApproval ? (request as AttemptRequest).payload : undefined,
    order: isApproval ? serializeOrder((request as AttemptRequest).order) : undefined,
    validUntil: request.validUntil.toString(),
    place: Number(proof.place),
    method: proof.method,
    config: proof.config,
    salt: proof.salt
  })
}

/**
 * The proof a double method accepts for one credential over one digest. It
 * stands in for a signature, an assertion or a zero-knowledge proof: a test or a
 * ceremony host that wants a satisfying proof computes it here, and anything else
 * is a proof the credential's module would reject.
 */
export const doubleProof = (config: Hex, digest: Hex): Hex => keccak256(concat([config, digest]))

export { keccak256 }
