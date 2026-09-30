/**
 * The screen's record writes. An enrollment is written at once, before any
 * test: the enrollment joins the list, then the slot takes its credential in
 * one write of the draft and the path. A test updates its enrollment alone.
 */
import type { Credential } from '@web/modules/social-recovery/sdk-interfaces'
import type { AddressBook } from '@web/modules/social-recovery/shared/client'
import type {
  Enrollment,
  EnrollmentTestVerdict,
  SetupRecords
} from '@web/modules/social-recovery/shared/records'

import { heldElsewhere, sameCredential, slotStateOf, withSlotFilled } from './slot'
import type { EnrollSearch, PassedTest, PlaceResult, SlotState } from './types'

const enrollmentsOf = async (setup: SetupRecords): Promise<Enrollment[]> => {
  const read = await setup.enrollments.read()
  return read.status === 'present' ? read.value : []
}

/** What the slot the search names holds now. An absent draft holds no slot. */
export const readSlot = async (
  setup: SetupRecords,
  search: EnrollSearch,
  book: AddressBook
): Promise<SlotState> => {
  const [draft, enrollments] = await Promise.all([setup.setupDraft.read(), enrollmentsOf(setup)])
  if (draft.status !== 'present') {
    return { status: 'nothing' }
  }
  return slotStateOf(draft.value.clauses, search.at, search.kind, book, enrollments)
}

/**
 * Places a new enrollment in the slot: the slot must still be empty or hold
 * this screen's own credential, which the new one replaces with its
 * enrollment. A credential the path holds elsewhere is refused.
 *
 * The replaced enrollment leaves the list only once the draft holds the new
 * credential, so a failed draft write never leaves the old credential in the
 * slot without its enrollment.
 */
export const placeEnrollment = async (
  setup: SetupRecords,
  search: EnrollSearch,
  book: AddressBook,
  enrollment: Enrollment
): Promise<PlaceResult> => {
  const [draft, enrollments] = await Promise.all([setup.setupDraft.read(), enrollmentsOf(setup)])
  if (draft.status !== 'present') {
    return { status: 'slot-taken' }
  }
  const { clauses } = draft.value
  const slot = slotStateOf(clauses, search.at, search.kind, book, enrollments)
  if (slot.status === 'nothing') {
    return { status: 'slot-taken' }
  }
  if (heldElsewhere(clauses, enrollment.credential, search.at)) {
    return { status: 'duplicate' }
  }

  const others = enrollments.filter((e) => !sameCredential(e.credential, enrollment.credential))
  await setup.enrollments.write([...others, enrollment])
  try {
    await setup.writeDraftAndPath(withSlotFilled(draft.value, search.at, enrollment.credential))
  } catch (error: unknown) {
    // The slot never took the credential, so the list goes back to what it held.
    await setup.enrollments.write(enrollments).catch(() => undefined)
    throw error
  }
  if (slot.status === 'enrolled') {
    const replaced = slot.enrollment.credential
    await setup.enrollments.write(
      [...others, enrollment].filter((e) => !sameCredential(e.credential, replaced))
    )
  }
  return { status: 'placed', enrollment }
}

/**
 * Stores a test's verdict on the credential's enrollment, with the cause a
 * test that did not pass reported. A passed test may bring its challenge's
 * salt and time, and the facts the ceremony read again, whose kind becomes the
 * backup kind; the enrollment keeps its credential id, its backup kind, its
 * facts and its last passed test otherwise. Returns the
 * updated enrollment, or null where the list no longer holds the credential.
 */
export const recordTest = async (
  setup: SetupRecords,
  credential: Credential,
  test: EnrollmentTestVerdict,
  cause?: string,
  passedWith?: PassedTest
): Promise<Enrollment | null> => {
  const enrollments = await enrollmentsOf(setup)
  const found = enrollments.find((e) => sameCredential(e.credential, credential))
  if (!found) {
    return null
  }
  const facts = passedWith?.facts ?? found.facts
  const lastTest = passedWith?.lastTest ?? found.lastTest
  const backup = passedWith?.facts?.kind ?? found.backup
  const updated: Enrollment = {
    credential: found.credential,
    test,
    ...(cause ? { cause } : {}),
    ...(backup ? { backup } : {}),
    ...(found.credentialId ? { credentialId: found.credentialId } : {}),
    ...(facts ? { facts } : {}),
    ...(lastTest ? { lastTest } : {})
  }
  await setup.enrollments.write(enrollments.map((e) => (e === found ? updated : e)))
  return updated
}
