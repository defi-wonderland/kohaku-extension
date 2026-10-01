/**
 * @jest-environment jsdom
 *
 * The placement of an enrollment in its slot: the list takes the enrollment,
 * the draft takes the credential, and the list then drops every enrollment
 * whose credential the path no longer holds. The records sit on the harness's
 * storage double, and the harness loads the view, which needs a DOM.
 */
import type { Credential } from '@web/modules/social-recovery/sdk-interfaces'
import type { Enrollment, SetupRecords } from '@web/modules/social-recovery/shared/records'

import type { EnrollSearch } from '../types'
import {
  ACCOUNT,
  BOOK,
  CHAIN_ID,
  emptySlot,
  guardianConfigOf,
  pathWith,
  recordsWith
} from './harness'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const { placeEnrollment }: typeof import('../writes') = require('../writes')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const SEARCH: EnrollSearch = { kind: 'passkey', at: { clause: 0, member: 1 } }

const OLD: Credential = { method: BOOK.methods.passkey, config: '0xaa', label: 'Old laptop' }
const NEW: Credential = { method: BOOK.methods.passkey, config: '0xbb', label: 'New laptop' }
const GUARDIAN: Credential = {
  method: BOOK.methods.ecdsa,
  config: guardianConfigOf('0x2222222222222222222222222222222222222222')
}

const enrolled = (credential: Credential): Enrollment => ({ credential, test: 'not-tested' })

/** The setup records, with the writes of the enrollments list counted and the listed ones refused. */
const withRefusedListWrites = (setup: SetupRecords, refused: number[]): SetupRecords => {
  let writes = 0
  return {
    ...setup,
    enrollments: {
      ...setup.enrollments,
      write: async (value) => {
        writes += 1
        if (refused.includes(writes)) {
          throw new Error('storage full')
        }
        return setup.enrollments.write(value)
      }
    }
  }
}

const storedOf = async (setup: SetupRecords) => {
  const [draft, list] = await Promise.all([setup.setupDraft.read(), setup.enrollments.read()])
  if (draft.status !== 'present') {
    throw new Error('no draft stored')
  }
  return { clauses: draft.value.clauses, enrollments: list.status === 'present' ? list.value : [] }
}

describe('placing an enrollment', () => {
  const setupWith = async (clauses: Credential[], enrollments: Enrollment[]) => {
    const { records } = await recordsWith(pathWith(...clauses), enrollments)
    return records.setup(CHAIN_ID, ACCOUNT)
  }

  it('keeps the new enrollment and drops the replaced one on a retry after the last write failed', async () => {
    const setup = await setupWith([GUARDIAN, OLD], [enrolled(GUARDIAN), enrolled(OLD)])

    await expect(
      placeEnrollment(withRefusedListWrites(setup, [2]), SEARCH, BOOK, enrolled(NEW))
    ).rejects.toThrow('storage full')
    const between = await storedOf(setup)
    expect(between.clauses).toEqual(pathWith(GUARDIAN, NEW))
    expect(between.enrollments).toEqual([enrolled(GUARDIAN), enrolled(OLD), enrolled(NEW)])

    expect(await placeEnrollment(setup, SEARCH, BOOK, enrolled(NEW))).toEqual({
      status: 'placed',
      enrollment: enrolled(NEW)
    })
    const after = await storedOf(setup)
    expect(after.clauses).toEqual(pathWith(GUARDIAN, NEW))
    expect(after.enrollments).toEqual([enrolled(GUARDIAN), enrolled(NEW)])
  })

  it('replaces the old enrollment with the new one in a placement that does not fail', async () => {
    const setup = await setupWith([GUARDIAN, OLD], [enrolled(GUARDIAN), enrolled(OLD)])
    await placeEnrollment(setup, SEARCH, BOOK, enrolled(NEW))
    const after = await storedOf(setup)
    expect(after.clauses).toEqual(pathWith(GUARDIAN, NEW))
    expect(after.enrollments).toEqual([enrolled(GUARDIAN), enrolled(NEW)])
  })

  it('keeps the enrollment of a replaced credential the path still holds at another slot', async () => {
    const setup = await setupWith([OLD, OLD], [enrolled(OLD)])
    await placeEnrollment(setup, SEARCH, BOOK, enrolled(NEW))
    const after = await storedOf(setup)
    expect(after.clauses).toEqual(pathWith(OLD, NEW))
    expect(after.enrollments).toEqual([enrolled(OLD), enrolled(NEW)])
  })

  it('holds one enrollment for a credential placed twice in an empty slot', async () => {
    const setup = await setupWith([GUARDIAN, emptySlot('passkey')], [enrolled(GUARDIAN)])
    await placeEnrollment(setup, SEARCH, BOOK, enrolled(NEW))
    await placeEnrollment(setup, SEARCH, BOOK, enrolled(NEW))
    const after = await storedOf(setup)
    expect(after.clauses).toEqual(pathWith(GUARDIAN, NEW))
    expect(after.enrollments).toEqual([enrolled(GUARDIAN), enrolled(NEW)])
  })

  it('leaves the draft and the list as they were where the first write of the list fails', async () => {
    const setup = await setupWith([GUARDIAN, OLD], [enrolled(GUARDIAN), enrolled(OLD)])
    await expect(
      placeEnrollment(withRefusedListWrites(setup, [1]), SEARCH, BOOK, enrolled(NEW))
    ).rejects.toThrow('storage full')
    expect(await storedOf(setup)).toEqual({
      clauses: pathWith(GUARDIAN, OLD),
      enrollments: [enrolled(GUARDIAN), enrolled(OLD)]
    })
  })
})
