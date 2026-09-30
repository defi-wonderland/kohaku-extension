/**
 * One sentence that names a recovery path's shape without its members: the
 * kinds of method each clause holds and how many of them must answer. A
 * shape-visible setup shows this much to anyone, so the privacy step and the
 * review read it back to the holder.
 * Pure: the same input yields equal output and the input is never mutated.
 */
import type { Clause, Credential } from '@web/modules/social-recovery/sdk-interfaces'
import type { Translate } from '@web/modules/social-recovery/shared/display/types'
import { isEmptySlot, slotKindOf } from '@web/modules/social-recovery/shared/records/slots'
import type { SlotKind } from '@web/modules/social-recovery/shared/records/types'

import type { RuleLinesOptions } from './types'

/** The method name of each kind of method, a key under `socialRecovery.methodNames`. */
const METHOD_NAME_OF_KIND: { readonly [K in SlotKind]: string } = {
  ecdsa: 'socialRecovery.methodNames.guardians',
  passkey: 'socialRecovery.methodNames.passkey',
  zkpassport: 'socialRecovery.methodNames.passport',
  aadhaar: 'socialRecovery.methodNames.aadhaar'
}

/** The name of a method whose kind the wallet does not know. */
const UNKNOWN_KIND_NAME = 'socialRecovery.display.nouns.method'

const nameKeyOf = (
  credential: Credential,
  kindOfMethod: RuleLinesOptions['kindOfMethod']
): string => {
  const kind = isEmptySlot(credential) ? slotKindOf(credential) : kindOfMethod?.(credential.method)
  return kind ? METHOD_NAME_OF_KIND[kind] : UNKNOWN_KIND_NAME
}

/**
 * The names in the order the list reads, joined with the list words: `A`,
 * `A and B`, `A, B and C`. Past three names the middle ones join the second
 * slot of the three-name form.
 */
const joinNames = (names: readonly string[], t: Translate): string => {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) {
    return t('socialRecovery.disclosures.items.pair', { first: names[0], second: names[1] })
  }
  return t('socialRecovery.disclosures.items.triple', {
    first: names[0],
    second: names.slice(1, -1).join(', '),
    third: names[names.length - 1]
  })
}

/**
 * One clause: a required row reads its kind alone; a group reads its kinds,
 * each named once, then how many of its members must answer.
 */
const clausePart = (clause: Clause, options: RuleLinesOptions, t: Translate): string => {
  const nameKeys = [...new Set(clause.credentials.map((c) => nameKeyOf(c, options.kindOfMethod)))]
  const names = joinNames(
    nameKeys.map((key) => t(key)),
    t
  )
  if (clause.credentials.length === 1) return names
  const any = t('socialRecovery.shape.any').toLowerCase()
  const of = t('socialRecovery.shape.of').toLowerCase()
  const count = `${any} ${clause.threshold} ${of} ${clause.credentials.length}`
  return names === '' ? count : `${names}, ${count}`
}

/**
 * The path's shape in one sentence, `Passkey, Passport and Guardians, any 2 of
 * 3`, clauses joined by `and`. A clause with no member and a threshold of zero
 * asks nothing and is left out; with `skipMemberlessClauses`, every clause with
 * no member is left out. The sentence opens with a capital letter.
 */
export const renderShapeSentence = (
  clauses: readonly Clause[],
  options: RuleLinesOptions,
  t: Translate
): string => {
  const read = clauses.filter(
    (clause) =>
      clause.credentials.length > 0 || !(options.skipMemberlessClauses || clause.threshold === 0)
  )
  const and = ` ${t('socialRecovery.shape.and').toLowerCase()} `
  const sentence = read.map((clause) => clausePart(clause, options, t)).join(and)
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`
}
