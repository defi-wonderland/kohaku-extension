/**
 * Empty member slots. The draft's credential type has no empty member, so an
 * empty slot is a credential with the zero address as its method, empty config
 * bytes, and as its label the slug of the method kind it waits for. The editor
 * fills a slot by replacing that credential with an enrolled one.
 */
import { isAddressEqual, zeroAddress } from 'viem'

import type { Clause, Credential } from '@web/modules/social-recovery/sdk-interfaces'

import type { ShapeClause, SlotKind } from './types'

const SLOT_KINDS: readonly SlotKind[] = ['ecdsa', 'passkey', 'zkpassport', 'aadhaar']

/** The empty slot that waits for a method of `kind`. */
export const emptySlot = (kind: SlotKind): Credential => ({
  method: zeroAddress,
  config: '0x',
  label: kind
})

/** Whether a credential is an empty slot rather than an enrolled method. */
export const isEmptySlot = (credential: Credential): boolean =>
  isAddressEqual(credential.method, zeroAddress) && credential.config === '0x'

/**
 * The kind an empty slot waits for, or undefined for an enrolled credential or
 * a label that names no kind. The label comes back from storage.
 */
export const slotKindOf = (credential: Credential): SlotKind | undefined =>
  isEmptySlot(credential) ? SLOT_KINDS.find((kind) => kind === credential.label) : undefined

/** The clauses of a shape, every member slot empty. */
export const clausesOfShape = (shape: readonly ShapeClause[]): Clause[] =>
  shape.map(({ threshold, slots }) => ({ threshold, credentials: slots.map(emptySlot) }))
