import i18n from '@common/config/localization'
import type { Clause } from '@web/modules/social-recovery/sdk-interfaces'
import { renderFullAddress } from '@web/modules/social-recovery/shared/display'
import { emptySlot } from '@web/modules/social-recovery/shared/records/slots'
import type { Enrollment } from '@web/modules/social-recovery/shared/records'

import {
  needsHostileMinorityLine,
  pathRowOf,
  privacyLinesOf,
  publicationItemsOf,
  publicationSentenceOf,
  renderWait
} from '../lead'
import {
  AADHAAR,
  ALICE,
  BOB,
  BOOK,
  CAROL,
  DAVE,
  enrolled,
  guardianAddress,
  group,
  PASSKEY,
  PASSPORT,
  PHONE_PASSKEY,
  required
} from './fixtures'

const { t } = i18n
const ITEMS = 'socialRecovery.disclosures.items'
const LEAD = 'socialRecovery.disclosures.itemsLead'
const PUBLICATION = 'socialRecovery.review.publication'

const sentence = (clauses: Clause[]) => publicationSentenceOf(clauses, BOOK, t)

describe('the publication sentence', () => {
  it('names one item in the singular where the path holds no guardian', () => {
    expect(sentence([required(PASSKEY)])).toBe(
      t(`${PUBLICATION}.methods`, { items: t(`${LEAD}.passkey`), count: 1 })
    )
  })

  it('takes the plural verb for several passkeys', () => {
    expect(sentence([group(1, PASSKEY, PHONE_PASSKEY)])).toBe(
      t(`${PUBLICATION}.methods`, { items: t(`${LEAD}.passkeys`), count: 2 })
    )
  })

  it('joins two items as a pair in the plural', () => {
    expect(sentence([group(2, PASSKEY, PASSPORT)])).toBe(
      t(`${PUBLICATION}.methods`, {
        items: t(`${ITEMS}.pair`, {
          first: t(`${LEAD}.passkey`),
          second: t(`${ITEMS}.passportIdentifier`)
        }),
        count: 2
      })
    )
  })

  it('joins three items as a triple', () => {
    expect(sentence([group(2, PASSKEY, PASSPORT, AADHAAR)])).toBe(
      t(`${PUBLICATION}.methods`, {
        items: t(`${ITEMS}.triple`, {
          first: t(`${LEAD}.passkey`),
          second: t(`${ITEMS}.passportIdentifier`),
          third: t(`${ITEMS}.aadhaar`)
        }),
        count: 2
      })
    )
  })

  it('adds the one guardian beside the other methods', () => {
    expect(sentence([group(2, PASSKEY, PASSPORT, ALICE)])).toBe(
      t(`${PUBLICATION}.methodsAndGuardian`, {
        items: t(`${ITEMS}.pair`, {
          first: t(`${LEAD}.passkey`),
          second: t(`${ITEMS}.passportIdentifier`)
        }),
        count: 2
      })
    )
  })

  it('adds several guardians beside one other method, in the singular', () => {
    expect(sentence([required(PASSPORT), group(2, ALICE, BOB, CAROL)])).toBe(
      t(`${PUBLICATION}.methodsAndGuardians`, {
        items: t(`${LEAD}.passportIdentifier`),
        count: 1
      })
    )
  })

  it('names the one guardian alone where the path holds nothing else', () => {
    expect(sentence([required(ALICE)])).toBe(t(`${PUBLICATION}.guardian`))
  })

  it('names the guardians alone where the path holds nothing else', () => {
    expect(sentence([group(2, ALICE, BOB, CAROL)])).toBe(t(`${PUBLICATION}.guardians`))
  })

  it('counts empty slots by the kind they wait for', () => {
    expect(sentence([group(1, emptySlot('ecdsa'), emptySlot('ecdsa'))])).toBe(
      t(`${PUBLICATION}.guardians`)
    )
  })

  it('reads the singular and the plural forms as different sentences', () => {
    expect(sentence([required(PASSKEY)])).not.toBe(sentence([group(1, PASSKEY, PHONE_PASSKEY)]))
    expect(sentence([required(PASSPORT)])).not.toBe(sentence([group(2, PASSKEY, PASSPORT)]))
  })

  it('has no second sentence for an empty path', () => {
    expect(sentence([])).toBeNull()
  })
})

describe('the publication items', () => {
  it('name a passkey, the passport identifier and the Aadhaar identity in that order', () => {
    expect(publicationItemsOf(['aadhaar', 'ecdsa', 'zkpassport', 'passkey'])).toEqual([
      'passkey',
      'passportIdentifier',
      'aadhaar'
    ])
  })

  it('name several passkeys once, and several passports once', () => {
    expect(publicationItemsOf(['passkey', 'zkpassport', 'passkey', 'zkpassport'])).toEqual([
      'passkeys',
      'passportIdentifier'
    ])
  })

  it('name nothing for guardians alone', () => {
    expect(publicationItemsOf(['ecdsa', 'ecdsa'])).toEqual([])
  })
})

describe('the waiting period', () => {
  const CHIPS: [bigint, string][] = [
    [86400n, 'hours24'],
    [172800n, 'hours48'],
    [259200n, 'hours72'],
    [604800n, 'days7']
  ]
  CHIPS.forEach(([wait, chip]) => {
    it(`names ${wait} seconds by the picker chip ${chip}`, () => {
      expect(renderWait(wait, t)).toBe(t(`socialRecovery.privacy.waitingPeriod.chips.${chip}`))
    })
  })

  it('names any other length by its count of hours', () => {
    expect(renderWait(36n * 3600n, t)).toBe(
      t('socialRecovery.display.remainingHours', { count: 36 })
    )
    expect(renderWait(3600n, t)).toBe(t('socialRecovery.display.remainingHours', { count: 1 }))
    expect(renderWait(36n * 3600n, t)).not.toBe(renderWait(3600n, t))
  })
})

describe('the hostile-minority guidance', () => {
  it('shows where a group holds three members', () => {
    expect(needsHostileMinorityLine([group(2, ALICE, BOB, PASSKEY)])).toBe(true)
  })

  it('shows where any one group of several holds three or more', () => {
    expect(
      needsHostileMinorityLine([
        required(PASSKEY),
        group(1, ALICE, BOB),
        group(3, ALICE, BOB, CAROL, DAVE)
      ])
    ).toBe(true)
  })

  it('does not show where every group holds two members or fewer', () => {
    expect(
      needsHostileMinorityLine([required(PASSKEY), required(PASSPORT), group(1, ALICE, BOB)])
    ).toBe(false)
  })
})

describe('a row of the path', () => {
  const CEREMONY = 'socialRecovery.ceremony'
  const chip = (id: string) => t(`socialRecovery.status.method.${id}`)
  const rowOf = (enrollment: Enrollment) => pathRowOf(enrollment.credential, [enrollment], BOOK, t)

  it('reads a passed test as tested with no line under it', () => {
    const row = rowOf(enrolled(ALICE))
    expect([row.chip, row.lines]).toEqual([chip('tested'), []])
  })

  it('reads an untested method with the untested line', () => {
    const row = rowOf(enrolled(ALICE, 'not-tested'))
    expect([row.chip, row.lines]).toEqual([chip('notTested'), [t(`${CEREMONY}.notTestedLine`)]])
  })

  it('reads a failed test with the cause the check reported, then that it may never work', () => {
    const row = rowOf(enrolled(ALICE, 'failed', { cause: 'check-rejected' }))
    expect([row.chip, row.lines]).toEqual([
      chip('testFailed'),
      [t(`${CEREMONY}.testFailedNoMatch`), t(`${CEREMONY}.testFailedLine`)]
    ])
  })

  it("reads a failed test with the browser's own error name as its cause", () => {
    const row = rowOf(enrolled(PASSKEY, 'failed', { cause: 'NotAllowedError' }))
    expect(row.lines[0]).toBe('NotAllowedError')
    expect(row.lines[1]).toBe(t(`${CEREMONY}.testFailedLine`))
  })

  it('shows no raw cause the wallet has no words for', () => {
    const row = rowOf(enrolled(ALICE, 'failed', { cause: 'service-unanswered' }))
    expect(row.lines).toEqual([t(`${CEREMONY}.testFailedLine`)])
  })

  it('reads an unavailable test with its line', () => {
    const row = rowOf(enrolled(ALICE, 'unavailable'))
    expect([row.chip, row.lines]).toEqual([
      chip('testUnavailable'),
      [t(`${CEREMONY}.testUnavailableLine`)]
    ])
  })

  it('reads a document the method cannot check as not supported with its line', () => {
    const row = rowOf(enrolled(PASSPORT, 'not-supported'))
    expect(row.chip).toBe(chip('notSupported'))
    expect(row.lines[0]).toBe(t(`${CEREMONY}.notSupportedLine`))
  })

  it('names a guardian by its full address beside the guardian noun', () => {
    const row = rowOf(enrolled(ALICE))
    expect([row.name, row.aside]).toEqual([
      renderFullAddress(guardianAddress('a1')),
      t('socialRecovery.display.nouns.guardian')
    ])
  })

  it('carries the identity line and the publication line on a passport row', () => {
    const row = rowOf(enrolled(PASSPORT))
    expect([row.name, row.lines]).toEqual([
      t('socialRecovery.methodNames.passport'),
      [
        t('socialRecovery.disclosures.identity'),
        t('socialRecovery.disclosures.passportPublication')
      ]
    ])
  })

  it('carries the identity line alone on an Aadhaar row', () => {
    expect(rowOf(enrolled(AADHAAR)).lines).toEqual([t('socialRecovery.disclosures.identity')])
  })

  it('names a synced passkey by its label with the synced word, its loss line and its origin line', () => {
    const row = rowOf(enrolled(PASSKEY, 'passed', { backup: 'synced' }))
    expect(row).toEqual({
      name: PASSKEY.label,
      aside: t('socialRecovery.review.passkeySynced'),
      chip: chip('tested'),
      lines: [t(`${CEREMONY}.syncedLoss`), t(`${CEREMONY}.passkeyOrigin`)]
    })
  })

  it('names a device-bound passkey with the device-bound word, its loss line and its origin line', () => {
    const row = rowOf(enrolled(PASSKEY, 'not-tested', { backup: 'device-bound' }))
    expect(row.aside).toBe(t('socialRecovery.review.passkeyDeviceBound'))
    expect(row.lines).toEqual([
      t(`${CEREMONY}.notTestedLine`),
      t(`${CEREMONY}.deviceBoundLoss`),
      t(`${CEREMONY}.passkeyOrigin`)
    ])
  })

  it('reads an empty slot by its kind as not yet active, with no line', () => {
    const row = pathRowOf(emptySlot('zkpassport'), [], BOOK, t)
    expect(row).toEqual({
      name: t('socialRecovery.methodNames.passport'),
      aside: null,
      chip: chip('notYetActive'),
      lines: []
    })
  })

  it('shows no chip for a credential the records hold no verdict for', () => {
    expect(pathRowOf(ALICE, [], BOOK, t).chip).toBeNull()
  })
})

describe('the privacy lines', () => {
  it('read Private with the recovery password set', () => {
    expect(privacyLinesOf('encrypted', true, t)).toEqual([t('socialRecovery.review.privateSet')])
  })

  it('read the Public level with its own line', () => {
    expect(privacyLinesOf('clear', false, t)).toEqual([
      t('socialRecovery.privacy.level.public.label'),
      t('socialRecovery.privacy.level.public.line')
    ])
  })

  it('read Private alone, never that a password is set, before the password is stored', () => {
    expect(privacyLinesOf('encrypted', false, t)).toEqual([
      t('socialRecovery.privacy.level.private.label')
    ])
  })
})
