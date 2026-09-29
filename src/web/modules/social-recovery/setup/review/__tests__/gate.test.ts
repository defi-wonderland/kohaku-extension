import { emptySlot } from '@web/modules/social-recovery/shared/records/slots'

import { accountReadsToRetry, saveGateOf, untestedInPath } from '../gate'
import { trustRowsOf } from '../trust'
import type { AccountReads, MethodReads, SaveGateInput } from '../types'
import {
  ALICE,
  answered,
  BOOK,
  declaration,
  descriptionOf,
  enrolled,
  group,
  info,
  OTHER_KEY,
  PASSKEY,
  readsOf,
  REMOVED_KEY,
  required,
  setupStateOf,
  SHIPPED,
  THIRD_PARTY,
  THIRD_PARTY_MODULE,
  UNANSWERED
} from './fixtures'

const passkeyRows = (reads: MethodReads) =>
  trustRowsOf({
    clauses: [required(PASSKEY)],
    enrollments: [],
    reads: readsOf([[BOOK.methods.passkey, reads]]),
    shippedMethods: SHIPPED,
    addressBook: BOOK
  })

const ANSWERED_ROWS = passkeyRows(answered())
const UNAVAILABLE_ROWS = passkeyRows({
  trustedParties: declaration(),
  moduleInfo: info(),
  paused: UNANSWERED
})
const PENDING_ROWS = passkeyRows({ trustedParties: declaration(), moduleInfo: info() })

const TWO_AUTHORITIES = descriptionOf([
  { address: REMOVED_KEY, isAuthority: true },
  { address: OTHER_KEY, isAuthority: true }
])

const READS: AccountReads = {
  removedKey: { status: 'answered', value: { kind: 'named', key: REMOVED_KEY } },
  fitCheck: { status: 'answered', value: { basis: 'deployed-code', fits: true } },
  setupState: { status: 'answered', value: setupStateOf(false) },
  description: { status: 'answered', value: descriptionOf() }
}

const REMOVED_KEY_UNNAMED: AccountReads['removedKey'] = {
  status: 'answered',
  value: { kind: 'unavailable', cause: 'no-key-entry' }
}
const SEVERAL_KEYS: AccountReads['removedKey'] = {
  status: 'answered',
  value: { kind: 'unavailable', cause: 'several-key-entries' }
}
const NO_CREATION_RECORD: AccountReads['removedKey'] = {
  status: 'answered',
  value: { kind: 'unavailable', cause: 'no-creation-record' }
}
const DOES_NOT_FIT: AccountReads['fitCheck'] = {
  status: 'answered',
  value: { basis: 'deployed-code', fits: false }
}
const HAS_SETUP: AccountReads['setupState'] = { status: 'answered', value: setupStateOf(true) }
const KEY_COUNT: AccountReads['description'] = { status: 'answered', value: TWO_AUTHORITIES }

const gateOf = (input: Partial<SaveGateInput> = {}) =>
  saveGateOf({
    recordsLoaded: true,
    clientReady: true,
    trustRows: ANSWERED_ROWS,
    untested: false,
    ...READS,
    ...input
  })

describe('the save gate', () => {
  it('lets Save run once every read answered and nothing blocks it', () => {
    expect(gateOf()).toEqual({ canSave: true, blocked: null, notTested: false })
  })

  it('keeps Save disabled with nothing blocking while the records or the client are not ready', () => {
    expect(gateOf({ recordsLoaded: false })).toMatchObject({ canSave: false, blocked: null })
    expect(gateOf({ clientReady: false })).toMatchObject({ canSave: false, blocked: null })
    expect(
      gateOf({ clientReady: false, trustRows: UNAVAILABLE_ROWS, setupState: HAS_SETUP })
    ).toMatchObject({ canSave: false, blocked: null })
  })

  it('keeps Save disabled with nothing blocking while a read is still running', () => {
    expect(gateOf({ trustRows: PENDING_ROWS })).toMatchObject({ canSave: false, blocked: null })
    expect(gateOf({ trustRows: [] })).toMatchObject({ canSave: false, blocked: null })
    const names = ['removedKey', 'fitCheck', 'setupState', 'description'] as const
    names.forEach((name) => {
      expect(gateOf({ [name]: { status: 'pending' } })).toMatchObject({
        canSave: false,
        blocked: null
      })
    })
  })

  describe('each blocker alone', () => {
    it('reads unavailable where a trust read did not answer', () => {
      expect(gateOf({ trustRows: UNAVAILABLE_ROWS })).toMatchObject({
        canSave: false,
        blocked: { kind: 'unavailable' }
      })
    })

    it('reads unavailable where the fit check threw', () => {
      expect(gateOf({ fitCheck: { status: 'failed' } })).toMatchObject({
        canSave: false,
        blocked: { kind: 'unavailable' }
      })
    })

    it('reads unavailable where the setup read threw', () => {
      expect(gateOf({ setupState: { status: 'failed' } })).toMatchObject({
        canSave: false,
        blocked: { kind: 'unavailable' }
      })
    })

    it('reads the removed key unreadable where the reading names no key', () => {
      expect(gateOf({ removedKey: REMOVED_KEY_UNNAMED })).toMatchObject({
        canSave: false,
        blocked: { kind: 'removed-key-unreadable' }
      })
    })

    it('reads the removed key unreadable where its read threw', () => {
      expect(gateOf({ removedKey: { status: 'failed' } })).toMatchObject({
        canSave: false,
        blocked: { kind: 'removed-key-unreadable' }
      })
    })

    it('reads cannot recover where the fit check refuses', () => {
      expect(gateOf({ fitCheck: DOES_NOT_FIT })).toMatchObject({
        canSave: false,
        blocked: { kind: 'cannot-recover', reason: 'not-supported' }
      })
    })

    it('reads cannot recover with the count where more than one key holds authority', () => {
      expect(gateOf({ description: KEY_COUNT })).toMatchObject({
        canSave: false,
        blocked: { kind: 'cannot-recover', reason: 'key-count', count: 2 }
      })
    })

    it('counts only the candidate keys that hold authority', () => {
      const description = descriptionOf([
        { address: REMOVED_KEY, isAuthority: true },
        { address: OTHER_KEY, isAuthority: false }
      ])

      expect(gateOf({ description: { status: 'answered', value: description } })).toMatchObject({
        canSave: true,
        blocked: null
      })
    })

    it('reads already set up where the account holds a setup', () => {
      expect(gateOf({ setupState: HAS_SETUP })).toMatchObject({
        canSave: false,
        blocked: { kind: 'already-set-up' }
      })
    })
  })

  describe('the order of the blockers', () => {
    it('shows unavailable before every other blocker', () => {
      expect(
        gateOf({
          trustRows: UNAVAILABLE_ROWS,
          removedKey: REMOVED_KEY_UNNAMED,
          description: KEY_COUNT,
          setupState: HAS_SETUP
        }).blocked
      ).toEqual({ kind: 'unavailable' })
      expect(
        gateOf({ fitCheck: { status: 'failed' }, removedKey: { status: 'failed' } }).blocked
      ).toEqual({ kind: 'unavailable' })
    })

    it('shows the removed key unreadable before cannot recover and already set up', () => {
      expect(
        gateOf({
          removedKey: REMOVED_KEY_UNNAMED,
          fitCheck: DOES_NOT_FIT,
          description: KEY_COUNT,
          setupState: HAS_SETUP
        }).blocked
      ).toEqual({ kind: 'removed-key-unreadable' })
    })

    it('shows the unsupported account before the key count', () => {
      expect(gateOf({ fitCheck: DOES_NOT_FIT, description: KEY_COUNT }).blocked).toEqual({
        kind: 'cannot-recover',
        reason: 'not-supported'
      })
    })

    it('shows cannot recover before already set up', () => {
      expect(gateOf({ fitCheck: DOES_NOT_FIT, setupState: HAS_SETUP }).blocked).toEqual({
        kind: 'cannot-recover',
        reason: 'not-supported'
      })
      expect(gateOf({ description: KEY_COUNT, setupState: HAS_SETUP }).blocked).toEqual({
        kind: 'cannot-recover',
        reason: 'key-count',
        count: 2
      })
    })
  })

  describe("the wallet's reading of several keys", () => {
    it('reads cannot recover with the count the description gives', () => {
      expect(gateOf({ removedKey: SEVERAL_KEYS, description: KEY_COUNT })).toMatchObject({
        canSave: false,
        blocked: { kind: 'cannot-recover', reason: 'key-count', count: 2 }
      })
    })

    it('reads cannot recover with no count where the description threw', () => {
      const gate = gateOf({ removedKey: SEVERAL_KEYS, description: { status: 'failed' } })

      expect(gate.canSave).toBe(false)
      expect(gate.blocked).toEqual({ kind: 'cannot-recover', reason: 'key-count' })
    })

    it('reads cannot recover with no count where the description counts a single authority', () => {
      expect(gateOf({ removedKey: SEVERAL_KEYS }).blocked).toEqual({
        kind: 'cannot-recover',
        reason: 'key-count'
      })
    })

    it('never reads the removed key unreadable', () => {
      expect(gateOf({ removedKey: SEVERAL_KEYS }).blocked).not.toEqual({
        kind: 'removed-key-unreadable'
      })
    })

    it('shows the unsupported account before the key count', () => {
      expect(
        gateOf({ removedKey: SEVERAL_KEYS, fitCheck: DOES_NOT_FIT, description: KEY_COUNT }).blocked
      ).toEqual({ kind: 'cannot-recover', reason: 'not-supported' })
    })

    it('shows the key count before already set up', () => {
      expect(gateOf({ removedKey: SEVERAL_KEYS, setupState: HAS_SETUP }).blocked).toEqual({
        kind: 'cannot-recover',
        reason: 'key-count'
      })
    })

    it('shows unavailable before the key count', () => {
      expect(
        gateOf({ removedKey: SEVERAL_KEYS, setupState: { status: 'failed' } }).blocked
      ).toEqual({ kind: 'unavailable' })
    })
  })

  it('reads the removed key unreadable where the account has no creation record', () => {
    expect(gateOf({ removedKey: NO_CREATION_RECORD, description: KEY_COUNT })).toMatchObject({
      canSave: false,
      blocked: { kind: 'removed-key-unreadable' }
    })
  })

  describe('while a read it depends on is still running', () => {
    it('shows no block while the removed key is pending, even where the setup read found a setup', () => {
      expect(gateOf({ removedKey: { status: 'pending' }, setupState: HAS_SETUP })).toEqual({
        canSave: false,
        blocked: null,
        notTested: false
      })
    })

    it('shows no block while the description is pending, even where the fit check refuses', () => {
      expect(
        gateOf({ description: { status: 'pending' }, fitCheck: DOES_NOT_FIT }).blocked
      ).toBeNull()
    })

    it('shows no block while a trust read is pending, even where an account read threw', () => {
      expect(
        gateOf({ trustRows: PENDING_ROWS, setupState: { status: 'failed' } }).blocked
      ).toBeNull()
    })

    it('shows no block while the fit check is pending, even where the removed key has no name', () => {
      expect(
        gateOf({ fitCheck: { status: 'pending' }, removedKey: REMOVED_KEY_UNNAMED }).blocked
      ).toBeNull()
    })

    it('still warns of an untested method', () => {
      expect(gateOf({ removedKey: { status: 'pending' }, untested: true })).toEqual({
        canSave: false,
        blocked: null,
        notTested: true
      })
    })
  })

  it('warns of an untested method beside an enabled Save', () => {
    expect(gateOf({ untested: true })).toEqual({ canSave: true, blocked: null, notTested: true })
  })

  it('warns of an untested method beside whichever blocker applies', () => {
    expect(gateOf({ untested: true, setupState: HAS_SETUP })).toEqual({
      canSave: false,
      blocked: { kind: 'already-set-up' },
      notTested: true
    })
  })

  it('never lets the doors block Save, whether their read threw or answered', () => {
    expect(gateOf({ description: { status: 'failed' } })).toEqual({
      canSave: true,
      blocked: null,
      notTested: false
    })
  })

  it('lets a third-party module count as a trust read that answered', () => {
    const trustRows = trustRowsOf({
      clauses: [group(2, PASSKEY, THIRD_PARTY)],
      enrollments: [],
      reads: readsOf([
        [BOOK.methods.passkey, answered()],
        [THIRD_PARTY_MODULE, answered(declaration(), info(false))]
      ]),
      shippedMethods: SHIPPED,
      addressBook: BOOK
    })

    expect(gateOf({ trustRows })).toMatchObject({ canSave: true, blocked: null })
  })
})

describe('whether a method of the path is untested', () => {
  it('holds where a credential has no passed test', () => {
    expect(untestedInPath([required(ALICE)], [enrolled(ALICE, 'not-tested')])).toBe(true)
    expect(untestedInPath([required(ALICE)], [enrolled(ALICE, 'failed')])).toBe(true)
    expect(untestedInPath([required(ALICE)], [])).toBe(true)
  })

  it('does not hold where every credential passed its test', () => {
    expect(untestedInPath([group(1, ALICE, PASSKEY)], [enrolled(ALICE), enrolled(PASSKEY)])).toBe(
      false
    )
  })

  it('does not count an empty slot as an untested method', () => {
    expect(untestedInPath([group(1, ALICE, emptySlot('passkey'))], [enrolled(ALICE)])).toBe(false)
  })
})

describe('the account reads a retry runs again', () => {
  it('names every read that threw', () => {
    expect(
      accountReadsToRetry({
        removedKey: { status: 'failed' },
        fitCheck: { status: 'failed' },
        setupState: { status: 'failed' },
        description: { status: 'failed' }
      })
    ).toEqual(['removedKey', 'fitCheck', 'setupState', 'description'])
  })

  it('names the removed key where it could not be named', () => {
    expect(accountReadsToRetry({ ...READS, removedKey: REMOVED_KEY_UNNAMED })).toEqual([
      'removedKey'
    ])
  })

  it('does not name the removed key where the account holds several keys', () => {
    expect(accountReadsToRetry({ ...READS, removedKey: SEVERAL_KEYS })).toEqual([])
  })

  it('names the removed key where the account has no creation record', () => {
    expect(accountReadsToRetry({ ...READS, removedKey: NO_CREATION_RECORD })).toEqual([
      'removedKey'
    ])
  })

  it('names nothing that answered or is still running', () => {
    expect(accountReadsToRetry(READS)).toEqual([])
    expect(
      accountReadsToRetry({ ...READS, fitCheck: { status: 'pending' }, setupState: HAS_SETUP })
    ).toEqual([])
  })
})
