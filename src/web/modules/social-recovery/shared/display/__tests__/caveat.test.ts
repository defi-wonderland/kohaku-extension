/**
 * PT-036, done entry 2, I-41: a resolved name beside a full address the reader
 * checks, or alone for an address the reader acts on, carries the caveat; a
 * name shown for information only does not.
 *
 * Sources: docs/social-recovery/design/ux.md D-302,
 * docs/social-recovery/design/invariants.yaml I-41.
 */
import { NAME_USES, renderResolvedName } from '..'

const CAVEAT = 'The name can change hands. Check the full address.'

describe('resolved name caveat (I-41)', () => {
  it('carries the caveat beside a full address the reader is asked to check', () => {
    expect(renderResolvedName('alice.eth', 'besideAddressToCheck')).toEqual({
      name: 'alice.eth',
      caveat: CAVEAT
    })
  })

  it('carries the caveat on a name rendered alone for an address the reader acts on', () => {
    expect(renderResolvedName('alice.eth', 'aloneForAction')).toEqual({
      name: 'alice.eth',
      caveat: CAVEAT
    })
  })

  it('carries no caveat on a name shown for information only', () => {
    expect(renderResolvedName('alice.eth', 'informationOnly')).toEqual({
      name: 'alice.eth',
      caveat: null
    })
  })

  it('knows exactly these three uses, so no fourth use can skip the caveat unseen', () => {
    expect([...NAME_USES].sort()).toEqual(
      ['aloneForAction', 'besideAddressToCheck', 'informationOnly'].sort()
    )
  })

  it('keeps the caveat on an ellipsized name (D-302: 24 characters)', () => {
    expect(renderResolvedName(`${'a'.repeat(30)}.eth`, 'besideAddressToCheck')).toEqual({
      name: `${'a'.repeat(23)}…`,
      caveat: CAVEAT
    })
  })

  it('returns null for an empty name in every use, so no caveat floats with no name', () => {
    NAME_USES.forEach((use) => expect(renderResolvedName('', use)).toBeNull())
  })

  it('returns null for a blank name in every use', () => {
    NAME_USES.forEach((use) => expect(renderResolvedName('  \t', use)).toBeNull())
  })

  it('narrows to a name with its caveat when the name is not empty', () => {
    const out = renderResolvedName('bob.eth', 'aloneForAction')
    expect(out).not.toBeNull()
    expect(out!.name).toBe('bob.eth')
    expect(out!.caveat).toBe(CAVEAT)
  })
})
