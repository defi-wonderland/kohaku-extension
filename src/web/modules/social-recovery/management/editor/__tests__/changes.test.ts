/**
 * What the edit changes against the configuration it started from, the card
 * the changes make stale, and the member the rule still needs: marked while
 * its group sits at its threshold, its removal refused by the editor's own
 * rules, and the mark lifted once the threshold drops or a replacement joins.
 */
import {
  addedCredentialsOf,
  changesOf,
  makesCardStale,
  passwordChangedOf,
  stillNeededOf
} from '@web/modules/social-recovery/management/editor/changes'
import type { EditSession } from '@web/modules/social-recovery/management/editor/types'
import type {
  Clause,
  Credential,
  PrivacyLevel,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces'
import { privacyOfLevel } from '@web/modules/social-recovery/setup/privacy/writes'
import {
  addGroup,
  removeMember,
  setThreshold,
  shapeRefusalsOf
} from '@web/modules/social-recovery/setup/editor'

const credentialOf = (n: number): Credential => ({
  method: `0x${'1'.repeat(39)}${n}` as Credential['method'],
  config: `0x${n.toString(16).padStart(2, '0')}`
})

const A = credentialOf(1)
const B = credentialOf(2)
const C = credentialOf(3)
const D = credentialOf(4)

const COMMITTED: Clause[] = [{ threshold: 2, credentials: [A, B, C] }]

const sessionAt = (level: PrivacyLevel = 'private'): EditSession => ({
  configuration: { clauses: COMMITTED, wait: 172_800n, ignoresPause: true },
  setupNonce: 3n,
  setupCommitment: `0x${'ab'.repeat(32)}`,
  level,
  password: 'kept'
})

const draftOf = (
  clauses: Clause[] = COMMITTED,
  wait = 172_800n,
  level: PrivacyLevel = 'private'
): SetupDraft => {
  const body = { clauses, wait, ignoresPause: true }
  return {
    ...body,
    privacy: privacyOfLevel(
      { ...body, privacy: { publicMetadata: '0x', backup: 'encrypted' } },
      level
    )
  }
}

// A rule as the count of its members and its thresholds, enough to tell two rules apart.
const ruleOf = (clauses: readonly Clause[]): string =>
  clauses.map(({ threshold, credentials }) => `${threshold}/${credentials.length}`).join('+')

const rowsOf = (draft: SetupDraft, passwordChanged = false, session = sessionAt()) =>
  changesOf({ baseline: session, draft, passwordChanged, ruleOf })

describe('the changes of an edit', () => {
  it('lists nothing for the path as committed', () => {
    expect(rowsOf(draftOf())).toEqual([])
  })

  it('counts a replaced member as one added and one removed, and leaves the rule alone', () => {
    const rows = rowsOf(draftOf([{ threshold: 2, credentials: [A, B, D] }]))
    expect(rows).toEqual([{ kind: 'members', added: 1, removed: 1 }])
    expect(addedCredentialsOf(COMMITTED, [{ threshold: 2, credentials: [A, B, D] }])).toEqual([D])
  })

  it('names the rule before and after where the threshold moves', () => {
    expect(rowsOf(draftOf([{ threshold: 3, credentials: [A, B, C] }]))).toEqual([
      { kind: 'rule', before: '2/3', after: '3/3' }
    ])
  })

  it('names the waiting period before and after', () => {
    expect(rowsOf(draftOf(COMMITTED, 259_200n))).toEqual([
      { kind: 'waitingPeriod', before: 172_800n, after: 259_200n }
    ])
  })

  it('names the privacy level before and after, and a changed password', () => {
    expect(rowsOf(draftOf(COMMITTED, 172_800n, 'shape-visible'))).toEqual([
      { kind: 'privacy', before: 'private', after: 'shape-visible' }
    ])
    expect(rowsOf(draftOf(), true)).toEqual([{ kind: 'password' }])
  })
})

describe('the changed password', () => {
  it('reads changed where the holder typed one, and where the committed setup had none', () => {
    expect(passwordChangedOf(sessionAt(), draftOf(), 'kept')).toBe(false)
    expect(passwordChangedOf(sessionAt(), draftOf(), 'changed')).toBe(true)
    expect(passwordChangedOf(sessionAt('public'), draftOf(), 'kept')).toBe(true)
  })

  it('reads unchanged for a setup saved in the clear', () => {
    expect(passwordChangedOf(sessionAt(), draftOf(COMMITTED, 172_800n, 'public'), 'changed')).toBe(
      false
    )
  })
})

describe('the stale card line', () => {
  it('shows for a changed password or privacy level and for nothing else', () => {
    expect(makesCardStale([{ kind: 'password' }])).toBe(true)
    expect(makesCardStale([{ kind: 'privacy', before: 'private', after: 'public' }])).toBe(true)
    expect(
      makesCardStale([
        { kind: 'members', added: 1, removed: 0 },
        { kind: 'rule', before: 'a', after: 'b' },
        { kind: 'waitingPeriod', before: 1n, after: 2n }
      ])
    ).toBe(false)
    expect(makesCardStale([])).toBe(false)
  })
})

describe('the member the rule still needs', () => {
  const atThreshold: Clause[] = [{ threshold: 3, credentials: [A, B, C] }]

  it('marks the group whose threshold equals its members', () => {
    expect(stillNeededOf(atThreshold)).toEqual([{ clause: 0, required: 3, count: 3 }])
    expect(stillNeededOf(COMMITTED)).toEqual([])
  })

  it('refuses the path its removal leaves', () => {
    const removed = removeMember(atThreshold, 0, 1)
    expect(shapeRefusalsOf(draftOf(removed)).map(({ key }) => key)).toContain(
      'thresholdAboveMembers'
    )
  })

  it('lifts once the threshold drops', () => {
    const lowered = setThreshold(atThreshold, 0, 2)
    expect(stillNeededOf(lowered)).toEqual([])
    expect(shapeRefusalsOf(draftOf(removeMember(lowered, 0, 1)))).toEqual([])
  })

  it('lifts once a replacement joins the group', () => {
    const replaced: Clause[] = [{ threshold: 3, credentials: [A, B, C, D] }]
    expect(stillNeededOf(replaced)).toEqual([])
    expect(shapeRefusalsOf(draftOf(removeMember(replaced, 0, 1)))).toEqual([])
  })

  it('reads every group on its own', () => {
    const two = addGroup(atThreshold)
    expect(stillNeededOf(two).map(({ clause }) => clause)).toEqual([0])
  })
})
