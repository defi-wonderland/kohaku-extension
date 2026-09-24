/**
 * sdk.md D-204 Formatter: the two codec types and the calldata structs of
 * contracts D-103 the formats encode.
 *
 * Hand-written from docs/social-recovery/design/sdk.md, frozen at design commit
 * bd8780f7ad59a451035b15920c00015a2eee6e9b of defi-wonderland/mast-social-recovery-2.
 * Imported from no SDK package. Types only. Field names are the contracts
 * chapter's own; uint64 and uint256 travel as bigint, uint48 timestamps as number.
 */
import type { Address, Hex } from './common'

/**
 * What the account pays and to whom (contracts D-103, D-107). A zero amount pays
 * nobody; a zero payee leaves the order open for whoever executes.
 */
export interface PaymentOrder {
  token: Address
  amount: bigint
  payee: Address
}

/**
 * The Ambire recovery action's payload layout (sdk.md D-202, D-204; contracts
 * D-105): the new authority and the removed authority, nothing else.
 */
export interface Handover {
  newAuthority: Address
  removedAuthority: Address
}

/** One filled place: place, method, config, salt and proof (contracts D-103). */
export interface ProofPlace {
  place: bigint
  method: Address
  config: Hex
  salt: Hex
  proof: Hex
}

/** The opening submission `complete` yields under the approval purpose (contracts D-103). */
export interface AttemptRequest {
  account: Address
  action: Address
  attemptId: bigint
  setupNonce: bigint
  setupBody: Hex
  payload: Hex
  order: PaymentOrder
  validUntil: number
  proofs: ProofPlace[]
}

/** The cancellation `complete` yields under the cancellation purpose: no payload, no order (contracts D-103). */
export interface CancelRequest {
  account: Address
  action: Address
  attemptId: bigint
  setupNonce: bigint
  setupBody: Hex
  validUntil: number
  proofs: ProofPlace[]
}

/**
 * The action payload codec (sdk.md D-201, D-204): the action addresses it serves,
 * one per chain for the kit's own, and two pure functions over the action's
 * layout. The decoder refuses bytes its encoder would not reproduce.
 * `H` is the action's own layout; the shipped action's is `Handover`.
 */
export interface IActionCodec<H = Handover> {
  actions: Address[]
  encode(handover: H): Hex
  decode(payload: Hex): H
}

/**
 * The method codec type (sdk.md D-204), the `codec` member of `IRecoveryMethod`:
 * four pure functions over the method's config and proof layouts, each decode
 * refusing bytes its encode would not reproduce. The field records are the
 * method's own.
 */
export interface IMethodCodec<ConfigFields = unknown, ProofFields = unknown> {
  encodeConfig(fields: ConfigFields): Hex
  decodeConfig(config: Hex): ConfigFields
  encodeProof(fields: ProofFields): Hex
  decodeProof(proof: Hex): ProofFields
}
