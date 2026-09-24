/**
 * PT-036, done entries 3 and 4: the closed chip sets of D-302 and the screen
 * word of every kit noun and of the two passwords.
 *
 * Sources: docs/social-recovery/briefs/PT-036.md (Interfaces and invariants,
 * Test expectations), docs/social-recovery/design/ux.md D-302.
 */
import i18n from '@common/config/localization/localization'

import {
  ATTEMPT_CHIPS,
  chipKey,
  COLLECTION_CHIPS,
  KIT_NOUNS,
  METHOD_CHIPS,
  nounKey,
  PASSWORD_NAMES,
  passwordKey,
  RECOVERY_STATUS_CHIPS
} from '..'

const t = (key: string) => i18n.t(key)

const words = (set: 'method' | 'collection' | 'attempt' | 'recovery', chips: readonly string[]) =>
  chips.map((chip) => {
    const key = chipKey(set, chip as never)
    expect(i18n.exists(key)).toBe(true)
    return t(key).toLowerCase()
  })

const sorted = (list: string[]) => [...list].sort()

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

  it('an attempt is exactly the five D-302 words', () => {
    expect(sorted(words('attempt', ATTEMPT_CHIPS))).toEqual(
      sorted(['recovery in progress', 'waiting', 'execution due', 'stopped', 'cancelled'])
    )
  })

  it('the recovery status is exactly set up, not set up and the three chips beside it', () => {
    expect(sorted(words('recovery', RECOVERY_STATUS_CHIPS))).toEqual(
      sorted(['set up', 'not set up', 'path locked', 'not active', 'cannot recover'])
    )
  })

  it('each set holds no duplicate chip', () => {
    ;[METHOD_CHIPS, COLLECTION_CHIPS, ATTEMPT_CHIPS, RECOVERY_STATUS_CHIPS].forEach((set) =>
      expect(new Set(set).size).toBe(set.length)
    )
  })

  it('maps every chip to a key under socialRecovery.status', () => {
    const all: [Parameters<typeof chipKey>[0], readonly string[]][] = [
      ['method', METHOD_CHIPS],
      ['collection', COLLECTION_CHIPS],
      ['attempt', ATTEMPT_CHIPS],
      ['recovery', RECOVERY_STATUS_CHIPS]
    ]
    all.forEach(([set, chips]) =>
      chips.forEach((chip) =>
        expect(chipKey(set, chip as never).startsWith('socialRecovery.status.')).toBe(true)
      )
    )
  })
})

describe('kit nouns and password names (D-302)', () => {
  it('renders every kit noun under the screen word D-302 fixes', () => {
    const rendered = KIT_NOUNS.map((noun) => {
      const key = nounKey(noun)
      expect(i18n.exists(key)).toBe(true)
      return t(key).toLowerCase()
    })
    expect(rendered).toEqual(
      expect.arrayContaining([
        'recovery registry',
        'recovery module',
        'publisher',
        'security stop',
        'setup number',
        'attempt number'
      ])
    )
  })

  it('exports exactly the two password names', () => {
    const rendered = PASSWORD_NAMES.map((name) => {
      const key = passwordKey(name)
      expect(i18n.exists(key)).toBe(true)
      return t(key).toLowerCase()
    })
    expect(sorted(rendered)).toEqual(sorted(['extension password', 'recovery password']))
  })
})
