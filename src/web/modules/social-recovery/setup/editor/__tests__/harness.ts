import { parse, stringify } from '@ambire-common/libs/richJson/richJson'
import type { Address, Clause, Credential, Hex } from '@web/modules/social-recovery/sdk-interfaces'
import { addressBookOf } from '@web/modules/social-recovery/shared/client'
import type {
  Enrollment,
  RecordStorage,
  SetupRecords
} from '@web/modules/social-recovery/shared/records'
import { createWalletRecords } from '@web/modules/social-recovery/shared/records'

import { kindOf, sameCredential } from '../operations'

export const BOOK = addressBookOf('sepolia')

export const CHAIN_ID = 11155111
export const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'

const guardianConfig = (byte: string): Hex => `0x${byte.repeat(20)}`

export const ALICE: Credential = {
  method: BOOK.methods.ecdsa,
  config: guardianConfig('a1'),
  label: 'Alice'
}
export const BOB: Credential = {
  method: BOOK.methods.ecdsa,
  config: guardianConfig('b2'),
  label: 'Bob'
}
export const CAROL: Credential = {
  method: BOOK.methods.ecdsa,
  config: guardianConfig('c3'),
  label: 'Carol'
}
export const DAVE: Credential = {
  method: BOOK.methods.ecdsa,
  config: guardianConfig('d4'),
  label: 'Dave'
}
export const PASSKEY: Credential = {
  method: BOOK.methods.passkey,
  config: '0x0102030405060708',
  label: 'Laptop'
}
export const PASSPORT: Credential = {
  method: BOOK.methods.zkpassport,
  config: '0xfeedface'
}
export const AADHAAR: Credential = {
  method: BOOK.methods.aadhaar,
  config: '0xabcdef01'
}

export const ENROLLED = [ALICE, BOB, CAROL, DAVE, PASSKEY, PASSPORT, AADHAAR]

/** A required passkey row, then a group of two of three: two guardians and a passport. */
export const presetPath = (): Clause[] => [
  { threshold: 1, credentials: [PASSKEY] },
  { threshold: 2, credentials: [ALICE, BOB, PASSPORT] }
]

/** A required passkey row, then two groups: two of two guardians, and one of a guardian and a passport. */
export const twoGroupPath = (): Clause[] => [
  { threshold: 1, credentials: [PASSKEY] },
  { threshold: 2, credentials: [ALICE, BOB] },
  { threshold: 1, credentials: [CAROL, PASSPORT] }
]

export const enrolled = (credential: Credential): Enrollment => ({
  credential,
  test: 'passed'
})

/**
 * The extension's storage helper in memory: a non-string value is stored as
 * its rich JSON string, so a draft's `bigint` wait survives, and every `set`
 * is counted.
 */
export interface StorageDouble extends RecordStorage {
  raw: Map<string, string>
  sets: string[]
}

export const makeStorage = (): StorageDouble => {
  const raw = new Map<string, string>()
  const sets: string[] = []
  return {
    raw,
    sets,
    get: async (key, defaultValue) => {
      const stored = key && raw.get(key)
      return stored ? parse(stored) : defaultValue
    },
    set: async (key, value) => {
      sets.push(key)
      raw.set(key, typeof value === 'string' ? value : stringify(value))
      return null
    },
    remove: async (key) => {
      raw.delete(key)
      return null
    }
  }
}

export const makeRecords = (): { storage: StorageDouble; records: SetupRecords } => {
  const storage = makeStorage()
  const records = createWalletRecords({ storage }).setup(CHAIN_ID, ACCOUNT)
  return { storage, records }
}

// Jest runs every file under __tests__, this one included; its own check runs
// only when Jest runs this file, never from a file that imports the harness.
if (expect.getState().testPath === __filename) {
  describe('harness', () => {
    it('holds enrolled credentials that are pairwise different methods, each of a known kind', () => {
      ENROLLED.forEach((credential) => expect(kindOf(credential, BOOK)).toBeDefined())
      ENROLLED.forEach((a, i) =>
        ENROLLED.forEach((b, j) => expect(sameCredential(a, b)).toBe(i === j))
      )
    })

    it('stores a draft and reads it back with its bigint wait, counting the write', async () => {
      const { storage, records } = makeRecords()
      const draft = {
        wait: 86400n,
        clauses: presetPath(),
        ignoresPause: false,
        privacy: { publicMetadata: '0x' as const, backup: 'encrypted' as const }
      }
      await records.setupDraft.write(draft)
      const read = await records.setupDraft.read()
      expect(read.status === 'present' && read.value).toEqual(draft)
      expect(storage.sets).toHaveLength(1)
    })
  })
}
