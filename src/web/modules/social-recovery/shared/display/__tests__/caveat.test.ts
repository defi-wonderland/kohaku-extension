/**
 * PT-036, done entry 2, I-41: a resolved name beside a full address the reader
 * checks, or alone for an address the reader acts on, carries the caveat; a
 * name shown for information only does not.
 *
 * Sources: docs/social-recovery/design/ux.md D-302,
 * docs/social-recovery/design/invariants.yaml I-41.
 */
import { renderFullAddress, renderResolvedName } from '..'

const CAVEAT = 'The name can change hands. Check the full address.'
const ADDRESS = '0x1111111111111111111111111111111111111111'

describe('resolved name caveat (I-41)', () => {
  it('carries the caveat beside a full address the reader is asked to check', () => {
    const out = renderResolvedName({ name: 'alice.eth', address: ADDRESS, purpose: 'check' })
    expect(out.name).toBe('alice.eth')
    expect(out.address).toBe(renderFullAddress(ADDRESS))
    expect(out.caveat).toBe(CAVEAT)
  })

  it('carries the caveat on a name rendered alone for an address the reader acts on', () => {
    const out = renderResolvedName({ name: 'alice.eth', address: ADDRESS, purpose: 'act' })
    expect(out.caveat).toBe(CAVEAT)
  })

  it('carries no caveat on a name shown for information only', () => {
    const out = renderResolvedName({ name: 'alice.eth', address: ADDRESS, purpose: 'info' })
    expect(out.caveat).toBeNull()
  })

  it('ellipsizes a resolved name past 24 characters (D-302)', () => {
    const long = `${'a'.repeat(30)}.eth`
    const out = renderResolvedName({ name: long, address: ADDRESS, purpose: 'check' })
    expect(out.name.endsWith('…')).toBe(true)
    expect(out.name.length).toBeLessThanOrEqual(25)
    expect(out.caveat).toBe(CAVEAT)
  })
})
