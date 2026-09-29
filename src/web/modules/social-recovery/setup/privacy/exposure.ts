import { zeroAddress } from 'viem'

import type { Clause, Credential } from '@web/modules/social-recovery/sdk-interfaces'
import { sameAddress } from '@web/modules/social-recovery/shared/client'
import type { AddressBook } from '@web/modules/social-recovery/shared/client'
import type { Translate } from '@web/modules/social-recovery/shared/display'

import type { ExposureLines, MethodKind, OfferedLevel } from './types'

const EXPOSURE = 'socialRecovery.privacy.level.exposure'
const ITEMS = 'socialRecovery.disclosures.items'
const ITEMS_LEAD = 'socialRecovery.disclosures.itemsLead'

/**
 * The kind a row of the path holds. An enrolled credential names its method by
 * address; an empty slot has the zero method and names the kind it waits for
 * in its label. The label comes back from storage.
 */
export const methodKindOf = (credential: Credential, book: AddressBook): MethodKind | undefined => {
  const kinds = Object.keys(book.methods) as MethodKind[]
  if (sameAddress(credential.method, zeroAddress) && credential.config === '0x') {
    return kinds.find((kind) => kind === credential.label)
  }
  return kinds.find((kind) => sameAddress(credential.method, book.methods[kind]))
}

/**
 * The items of the unguessable line, each an item slug under the disclosures:
 * the passkeys and the passport of the path. An address row is guessable and
 * is never among them.
 */
const unguessableItemsOf = (kinds: MethodKind[]): string[] => {
  const passkeys = kinds.filter((kind) => kind === 'passkey').length
  const items: string[] = []
  if (passkeys === 1) items.push('passkey')
  if (passkeys > 1) items.push('passkeys')
  if (kinds.includes('zkpassport')) items.push('passport')
  return items
}

const joinItems = (items: string[], t: Translate): string =>
  items
    .slice(1)
    .reduce(
      (joined, item) => t(`${ITEMS}.pair`, { first: joined, second: t(`${ITEMS}.${item}`) }),
      t(`${ITEMS_LEAD}.${items[0]}`)
    )

/**
 * The exposure line of a path at a level. The guessability half renders only
 * where the path holds an address row, since an address is the only row a
 * stranger can guess, and never at Public, where every address is on chain in
 * the clear; the publication half renders for every path at every level.
 */
export const exposureLinesOf = (
  clauses: Clause[],
  level: OfferedLevel,
  book: AddressBook,
  t: Translate
): ExposureLines => {
  const kinds = clauses
    .flatMap(({ credentials }) => credentials)
    .map((credential) => methodKindOf(credential, book))
    .filter((kind): kind is MethodKind => kind !== undefined)
  const publication = t(`${EXPOSURE}.publication`)
  if (level === 'public' || !kinds.includes('ecdsa')) return { publication }
  const items = unguessableItemsOf(kinds)
  return {
    guardians: t(`${EXPOSURE}.guardians`),
    unguessable: items.length
      ? t(`${EXPOSURE}.unguessable`, { items: joinItems(items, t) })
      : undefined,
    publication
  }
}
