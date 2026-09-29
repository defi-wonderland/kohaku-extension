/**
 * The editor's operations over a path's clauses. Each one is pure: it returns
 * new clauses and never mutates its input, and a credential it moves keeps
 * its object.
 *
 * A required row is a clause of threshold one over one credential; every other
 * clause is a group, an empty group included. An empty slot is a credential
 * whose method is the zero address, whose config is empty and whose label is
 * its kind; it stands for a method the holder has yet to enroll.
 */
import { isAddressEqual, zeroAddress } from 'viem'

import type {
  Clause,
  Credential,
  SetupDraft,
  ValidationResult
} from '@web/modules/social-recovery/sdk-interfaces'
import type { AddressBook } from '@web/modules/social-recovery/shared/client'
import type { Enrollment } from '@web/modules/social-recovery/shared/records'

import type {
  ClauseRole,
  EditResult,
  MethodKind,
  PickerEntry,
  PickerTarget,
  SlotPosition
} from './types'

/** The method kinds in the order the picker lists them. */
export const METHOD_KINDS = ['passkey', 'ecdsa', 'zkpassport', 'aadhaar'] as const

/** The threshold a new group starts with, two of its members. */
export const NEW_GROUP_THRESHOLD = 2

/** The draft the editor starts from when the account has none stored. */
export const EMPTY_DRAFT: SetupDraft = {
  wait: 0n,
  clauses: [],
  ignoresPause: false,
  privacy: { publicMetadata: '0x', backup: 'encrypted' }
}

const DUPLICATE: EditResult = { status: 'refused', reason: 'duplicate' }

export const emptySlotOf = (kind: MethodKind): Credential => ({
  method: zeroAddress,
  config: '0x',
  label: kind
})

export const isEmptySlot = (credential: Credential): boolean =>
  isAddressEqual(credential.method, zeroAddress)

const isMethodKind = (label: string | undefined): label is MethodKind =>
  METHOD_KINDS.some((kind) => kind === label)

/**
 * The kind of a credential: an empty slot's label, or the address book's
 * method an enrolled credential's method is. A method the address book does
 * not hold has no kind.
 */
export const kindOf = (
  credential: Credential,
  addressBook: AddressBook
): MethodKind | undefined => {
  if (isEmptySlot(credential)) return isMethodKind(credential.label) ? credential.label : undefined
  return METHOD_KINDS.find((kind) => isAddressEqual(addressBook.methods[kind], credential.method))
}

/**
 * Two credentials are one enrolled method when their method addresses and
 * their config bytes match. An empty slot is never the same as anything.
 */
export const sameCredential = (a: Credential, b: Credential): boolean =>
  !isEmptySlot(a) &&
  !isEmptySlot(b) &&
  isAddressEqual(a.method, b.method) &&
  a.config.toLowerCase() === b.config.toLowerCase()

/** Whether the path holds this enrolled credential anywhere, leaving out one position. */
export const pathHolds = (
  clauses: readonly Clause[],
  credential: Credential,
  except?: SlotPosition
): boolean =>
  clauses.some((clause, c) =>
    clause.credentials.some(
      (held, m) =>
        !(except && except.clause === c && except.member === m) && sameCredential(held, credential)
    )
  )

export const roleOf = (clause: Clause): ClauseRole =>
  clause.threshold === 1 && clause.credentials.length === 1 ? 'required' : 'group'

/** How many methods the path holds, empty slots counted. */
export const methodCountOf = (clauses: readonly Clause[]): number =>
  clauses.reduce((sum, clause) => sum + clause.credentials.length, 0)

const replaceAt = (clauses: readonly Clause[], index: number, clause: Clause): Clause[] =>
  clauses.map((held, i) => (i === index ? clause : held))

/** Adds a required row over the credential: an empty slot or an enrolled credential. */
export const addRequired = (clauses: readonly Clause[], credential: Credential): EditResult => {
  if (pathHolds(clauses, credential)) return DUPLICATE
  return {
    status: 'applied',
    clauses: [...clauses, { threshold: 1, credentials: [credential] }],
    at: { clause: clauses.length, member: 0 }
  }
}

/** Removes one clause, a required row or a group with its members. */
export const removeClause = (clauses: readonly Clause[], index: number): Clause[] =>
  clauses.filter((_, i) => i !== index)

/** Adds a group with no member and the starting threshold. */
export const addGroup = (clauses: readonly Clause[]): Clause[] => [
  ...clauses,
  { threshold: NEW_GROUP_THRESHOLD, credentials: [] }
]

/** Adds a member to a group: an empty slot or an enrolled credential. */
export const addMember = (
  clauses: readonly Clause[],
  group: number,
  credential: Credential
): EditResult => {
  if (pathHolds(clauses, credential)) return DUPLICATE
  const { threshold, credentials } = clauses[group]
  return {
    status: 'applied',
    clauses: replaceAt(clauses, group, { threshold, credentials: [...credentials, credential] }),
    at: { clause: group, member: credentials.length }
  }
}

/** Removes one member; a group that loses its last member stays until it is removed. */
export const removeMember = (
  clauses: readonly Clause[],
  group: number,
  member: number
): Clause[] => {
  const { threshold, credentials } = clauses[group]
  return replaceAt(clauses, group, {
    threshold,
    credentials: credentials.filter((_, i) => i !== member)
  })
}

/** Sets a clause's threshold to any integer; the editor's refusals judge its bounds. */
export const setThreshold = (
  clauses: readonly Clause[],
  group: number,
  threshold: number
): Clause[] => replaceAt(clauses, group, { threshold, credentials: clauses[group].credentials })

/** Puts a credential into one position, an empty slot the enroll screen or the picker fills. */
export const fillSlot = (
  clauses: readonly Clause[],
  at: SlotPosition,
  credential: Credential
): EditResult => {
  if (pathHolds(clauses, credential, at)) return DUPLICATE
  const { threshold, credentials } = clauses[at.clause]
  return {
    status: 'applied',
    clauses: replaceAt(clauses, at.clause, {
      threshold,
      credentials: credentials.map((held, i) => (i === at.member ? credential : held))
    }),
    at
  }
}

/** A required row's credential joins a group, and the row goes. */
export const moveToGroup = (clauses: readonly Clause[], row: number, group: number): EditResult => {
  const [credential] = clauses[row].credentials
  if (pathHolds(clauses, credential, { clause: row, member: 0 })) return DUPLICATE
  const { threshold, credentials } = clauses[group]
  const joined = replaceAt(clauses, group, { threshold, credentials: [...credentials, credential] })
  return {
    status: 'applied',
    clauses: removeClause(joined, row),
    at: { clause: group > row ? group - 1 : group, member: credentials.length }
  }
}

/** A member leaves its group and becomes a required row. */
export const makeRequired = (
  clauses: readonly Clause[],
  group: number,
  member: number
): EditResult => {
  const credential = clauses[group].credentials[member]
  if (pathHolds(clauses, credential, { clause: group, member })) return DUPLICATE
  return {
    status: 'applied',
    clauses: [...removeMember(clauses, group, member), { threshold: 1, credentials: [credential] }],
    at: { clause: clauses.length, member: 0 }
  }
}

/**
 * The required rows become one group any one of whose members recovers, the
 * shape this wallet prefers at two methods. The group takes the first row's
 * place.
 */
export const makeItAGroup = (clauses: readonly Clause[]): Clause[] => {
  const rows = clauses.filter((clause) => roleOf(clause) === 'required')
  if (rows.length === 0) return [...clauses]
  const group: Clause = { threshold: 1, credentials: rows.flatMap((row) => row.credentials) }
  const first = clauses.indexOf(rows[0])
  return clauses.flatMap((clause, i) => {
    if (i === first) return [group]
    return roleOf(clause) === 'required' ? [] : [clause]
  })
}

/** Places a picked credential where the picker was opened for. */
export const placeAt = (
  clauses: readonly Clause[],
  target: PickerTarget,
  credential: Credential
): EditResult => {
  if (target.place === 'required') return addRequired(clauses, credential)
  if (target.place === 'member') return addMember(clauses, target.clause, credential)
  return fillSlot(clauses, { clause: target.clause, member: target.member }, credential)
}

/** The draft with new clauses, every other field kept. */
export const withClauses = (draft: SetupDraft, clauses: Clause[]): SetupDraft => ({
  ...draft,
  clauses
})

/** The enrolled credentials the picker lists, by kind, each marked where the path holds it. */
export const pickerEntriesOf = (
  enrollments: readonly Enrollment[],
  clauses: readonly Clause[],
  addressBook: AddressBook
): Record<MethodKind, PickerEntry[]> => {
  const entries: Record<MethodKind, PickerEntry[]> = {
    passkey: [],
    ecdsa: [],
    zkpassport: [],
    aadhaar: []
  }
  enrollments.forEach((enrollment) => {
    const kind = kindOf(enrollment.credential, addressBook)
    if (kind) {
      entries[kind].push({ enrollment, inPath: pathHolds(clauses, enrollment.credential) })
    }
  })
  return entries
}

/** The enrollment an enrolled credential came from, when the records hold it. */
export const enrollmentOf = (
  credential: Credential,
  enrollments: readonly Enrollment[]
): Enrollment | undefined =>
  enrollments.find((enrollment) => sameCredential(enrollment.credential, credential))

/** The search string the enroll screen reads: the kind and the slot it fills. */
export const enrollSearchOf = (kind: MethodKind, at: SlotPosition): string =>
  `?${new URLSearchParams({
    kind,
    clause: String(at.clause),
    member: String(at.member)
  }).toString()}`

/** Whether a path check found anything that blocks the next step. Warnings never block. */
export const blocksContinue = (result: ValidationResult): boolean => result.errors.length > 0
