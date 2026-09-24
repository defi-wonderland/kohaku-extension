/**
 * PT-036, done entries 3 and 4: the closed chip sets of D-302, the screen word
 * of every kit noun and of the two passwords, and the four approval values with
 * the done screen's one exception.
 *
 * Sources: docs/social-recovery/briefs/PT-036.md (Interfaces and invariants,
 * Test expectations), docs/social-recovery/design/ux.md D-302,
 * docs/social-recovery/design/ux-copy.md UXC-14.
 */
import i18n from '@common/config/localization/localization'
import en from '@common/config/localization/translations/en.json'

import {
  APPROVAL_VALUES,
  ATTEMPT_CHIPS,
  Chip,
  chipKey,
  CHIP_SETS,
  ChipSetName,
  COLLECTION_CHIPS,
  CONCEPT_NOUNS,
  EDITOR_CHIPS,
  KIT_NOUNS,
  METHOD_CHIPS,
  nounKey,
  PARTY_NOUNS,
  PASSWORD_NAMES,
  passwordKey,
  RECOVERY_STATUS_CHIPS,
  renderApprovalValueName,
  renderChip,
  REQUEST_CHIPS,
  SESSION_CHIPS
} from '..'

const STATUS_PREFIX = 'socialRecovery.status.'

const words = <S extends ChipSetName>(set: S, chips: readonly Chip<S>[]) =>
  chips.map((chip) => {
    const key = chipKey(set, chip)
    expect(i18n.exists(key)).toBe(true)
    return renderChip(set, chip).toLowerCase()
  })

const sorted = (list: readonly string[]) => [...list].sort()

// Every key of every chip set, `socialRecovery.status.<block>.<chip>`.
const moduleKeys = (Object.keys(CHIP_SETS) as ChipSetName[]).flatMap((set) =>
  (CHIP_SETS[set] as readonly string[]).map((chip) => chipKey(set, chip as never))
)

// Every leaf key under socialRecovery.status of en.json.
const enStatusKeys = Object.entries(en.socialRecovery.status).flatMap(([block, entries]) =>
  Object.keys(entries).map((chip) => `${STATUS_PREFIX}${block}.${chip}`)
)

describe('the en.json chip blocks hold the module vocabulary and nothing else', () => {
  it('every key under socialRecovery.status is a chip of exactly one module set', () => {
    expect(sorted(enStatusKeys)).toEqual(sorted(moduleKeys))
  })

  it('no two module chips share one key', () => {
    expect(new Set(moduleKeys).size).toBe(moduleKeys.length)
  })

  it('each en.json block renders exactly the words D-302 lists for it', () => {
    const block = (name: keyof typeof en.socialRecovery.status) =>
      sorted(Object.values(en.socialRecovery.status[name]).map((w) => w.toLowerCase()))
    expect(block('method')).toEqual(
      sorted([
        'not started',
        'in progress',
        'tested',
        'not tested',
        'test failed',
        'test unavailable',
        'not supported',
        'not yet active',
        'saved',
        'live'
      ])
    )
    expect(block('collection')).toEqual(
      sorted([
        'not asked',
        'waiting',
        'declined',
        'unanswered',
        'complete',
        'not needed',
        'did not answer',
        'stopped'
      ])
    )
    // The attempt block also holds the session's one chip (D-302: a session
    // before submission reads not submitted and is no attempt).
    expect(block('attempt')).toEqual(
      sorted([
        'not submitted',
        'recovery in progress',
        'waiting',
        'execution due',
        'stopped',
        'cancelled'
      ])
    )
    expect(block('recovery')).toEqual(
      sorted(['set up', 'not set up', 'path locked', 'not active', 'cannot recover'])
    )
    expect(block('request')).toEqual(sorted(['expired', 'void', 'setup changed']))
    expect(block('editor')).toEqual(['still needed'])
    expect(sorted(Object.keys(en.socialRecovery.status))).toEqual(
      sorted(['method', 'collection', 'attempt', 'recovery', 'request', 'editor'])
    )
  })
})

describe('closed chip sets (D-302)', () => {
  it('a method in setup is exactly the ten D-302 words', () => {
    expect(sorted(words('method', METHOD_CHIPS))).toEqual(
      sorted([
        'not started',
        'in progress',
        'tested',
        'not tested',
        'test failed',
        'test unavailable',
        'not supported',
        'not yet active',
        'saved',
        'live'
      ])
    )
  })

  it('a row in collection is exactly the eight D-302 words', () => {
    expect(sorted(words('collection', COLLECTION_CHIPS))).toEqual(
      sorted([
        'not asked',
        'waiting',
        'declined',
        'unanswered',
        'complete',
        'not needed',
        'did not answer',
        'stopped'
      ])
    )
  })

  it('an attempt is exactly the five D-302 words, not submitted excluded', () => {
    expect(sorted(words('attempt', ATTEMPT_CHIPS))).toEqual(
      sorted(['recovery in progress', 'waiting', 'execution due', 'stopped', 'cancelled'])
    )
  })

  it('the recovery status is exactly set up, not set up and the three chips beside it', () => {
    expect(sorted(words('recovery', RECOVERY_STATUS_CHIPS))).toEqual(
      sorted(['set up', 'not set up', 'path locked', 'not active', 'cannot recover'])
    )
  })

  it('a session before submission reads exactly not submitted', () => {
    expect(words('session', SESSION_CHIPS)).toEqual(['not submitted'])
  })

  it('the chips that end a whole request are exactly expired, void and setup changed', () => {
    expect(sorted(words('request', REQUEST_CHIPS))).toEqual(
      sorted(['expired', 'void', 'setup changed'])
    )
  })

  it('the editor chip is exactly still needed', () => {
    expect(words('editor', EDITOR_CHIPS)).toEqual(['still needed'])
  })

  it('CHIP_SETS holds exactly these seven sets', () => {
    expect(sorted(Object.keys(CHIP_SETS))).toEqual(
      sorted(['method', 'collection', 'attempt', 'recovery', 'session', 'request', 'editor'])
    )
  })

  it('each set holds no duplicate chip', () => {
    Object.values(CHIP_SETS).forEach((set) => expect(new Set(set).size).toBe(set.length))
  })

  it('maps every chip to a key under socialRecovery.status', () => {
    moduleKeys.forEach((key) => expect(key.startsWith(STATUS_PREFIX)).toBe(true))
  })
})

describe('kit nouns and password names (D-302)', () => {
  const render = (key: string) => {
    expect(i18n.exists(key)).toBe(true)
    return i18n.t(key)
  }

  it('renders exactly the six kit nouns under the screen words D-302 fixes', () => {
    expect(KIT_NOUNS.map((noun) => render(nounKey(noun)))).toEqual([
      'Recovery registry',
      'Recovery module',
      'Publisher',
      'Security stop',
      'Setup number',
      'Attempt number'
    ])
  })

  it('renders the concept nouns under the UXC-10 names and the role word', () => {
    expect(CONCEPT_NOUNS.map((noun) => render(nounKey(noun)))).toEqual([
      'Recovery path',
      'Method',
      'Waiting period',
      'Guardian'
    ])
  })

  it("renders the method's admin and pause holder under their D-302 words", () => {
    expect(PARTY_NOUNS.map((noun) => render(nounKey(noun)))).toEqual([
      "The method's admin",
      'The party that can stop that method'
    ])
  })

  it('exports exactly the two password names', () => {
    expect(PASSWORD_NAMES.map((name) => render(passwordKey(name)))).toEqual([
      'Extension password',
      'Recovery password'
    ])
  })
})

describe('the four approval values and the done screen exception (D-302, UXC-14)', () => {
  it('holds exactly the four approval values', () => {
    expect(sorted(APPROVAL_VALUES)).toEqual(
      sorted(['newKey', 'keyBeingRemoved', 'payment', 'deadline'])
    )
  })

  it('names each value once everywhere but the done screen', () => {
    expect(APPROVAL_VALUES.map((value) => renderApprovalValueName(value))).toEqual([
      'New key',
      'Key being removed',
      'Payment',
      'Deadline'
    ])
    expect(
      APPROVAL_VALUES.map((value) => renderApprovalValueName(value, { doneScreen: false }))
    ).toEqual(['New key', 'Key being removed', 'Payment', 'Deadline'])
  })

  it('names the two keys controlled by and removed on the done screen, and only them', () => {
    expect(
      APPROVAL_VALUES.map((value) => renderApprovalValueName(value, { doneScreen: true }))
    ).toEqual(['Controlled by', 'Removed', 'Payment', 'Deadline'])
  })
})
