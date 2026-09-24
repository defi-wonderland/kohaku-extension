/**
 * PT-036, done entry 1: each value type of D-302 renders in exactly one form.
 *
 * Sources: docs/social-recovery/briefs/PT-036.md (Test expectations),
 * docs/social-recovery/tasks/PT-036-display-rules-and-the-status-vocabulary.md
 * (Done), docs/social-recovery/design/ux.md D-302.
 */
import { getAddress } from 'ethers'

import {
  renderApproval,
  renderFullAddress,
  renderHash,
  renderHiddenValue,
  renderMemberList,
  renderMethodName,
  renderPaymentOrder,
  renderShortAddress
} from '..'

const ELLIPSIS = '…'

// A lowercase address whose checksum mixes cases, so a renderer that skips
// the checksum shows.
const LOWER = '0x2b0f4c5a1e9d3b7a8c6e2f1d0a9b8c7d6e5f6ef5'
const CHECKSUMMED = getAddress(LOWER)

describe('short address (D-302: four and four hex digits after the prefix)', () => {
  it('renders 0x, the first four hex digits, an ellipsis and the last four, checksummed', () => {
    const expected = `0x${CHECKSUMMED.slice(2, 6)}${ELLIPSIS}${CHECKSUMMED.slice(-4)}`
    expect(renderShortAddress(LOWER)).toBe(expected)
  })

  it('renders the same short form for any casing of one address', () => {
    expect(renderShortAddress(LOWER.toUpperCase().replace('0X', '0x'))).toBe(
      renderShortAddress(CHECKSUMMED)
    )
  })

  it('renders the D-302 example form 0x2b0F…6ef5 shape (4 + 4 hex digits)', () => {
    expect(renderShortAddress(LOWER)).toMatch(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/)
  })
})

describe('full address (D-302: whole, no grouping)', () => {
  it('renders the checksummed address whole', () => {
    expect(renderFullAddress(LOWER)).toBe(CHECKSUMMED)
  })

  it('carries no space, no ellipsis and no separator between digits', () => {
    const out = renderFullAddress(LOWER)
    expect(out).toHaveLength(42)
    expect(out).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})

describe('user-typed method name (D-302: caps at 24 characters)', () => {
  const NAME_24 = 'Abcdefghijklmnopqrstuvwx'
  const NAME_25 = 'Abcdefghijklmnopqrstuvwxy'

  it('fixtures have the lengths the edge needs', () => {
    expect(NAME_24).toHaveLength(24)
    expect(NAME_25).toHaveLength(25)
  })

  it('leaves a 24-character name unchanged', () => {
    expect(renderMethodName(NAME_24)).toBe(NAME_24)
  })

  it('leaves a short name unchanged', () => {
    expect(renderMethodName('My passkey')).toBe('My passkey')
  })

  it('ellipsizes a 25-character name', () => {
    const out = renderMethodName(NAME_25)
    expect(out).not.toBe(NAME_25)
    expect(out.endsWith(ELLIPSIS)).toBe(true)
    const kept = out.slice(0, -1)
    // The kept part is a prefix of the name and the whole caps at 24 or 24
    // plus the ellipsis; D-302 fixes the cap, not whether the ellipsis counts.
    expect(NAME_25.startsWith(kept)).toBe(true)
    expect([23, 24]).toContain(kept.length)
  })

  it('ellipsizes a long name to the same length as a 25-character one', () => {
    const long = 'x'.repeat(80)
    expect(renderMethodName(long)).toHaveLength(renderMethodName(NAME_25).length)
  })
})

describe('transaction hash or challenge (D-302: twelve and six)', () => {
  const HASH = `0x${'0123456789ab'}${'c'.repeat(46)}${'fedcba'}`

  it('fixture is a 32-byte hash', () => {
    expect(HASH).toHaveLength(66)
  })

  it('renders 0x, twelve leading hex digits, an ellipsis and six trailing', () => {
    expect(renderHash(HASH)).toBe(`0x0123456789ab${ELLIPSIS}fedcba`)
  })
})

describe('approval blob (D-302: twelve and eight)', () => {
  // A 65-byte signature-shaped blob.
  const BLOB = `0x${'a1b2c3d4e5f6'}${'0'.repeat(110)}${'9876fedc'}`

  it('fixture is a 65-byte blob', () => {
    expect(BLOB).toHaveLength(132)
  })

  it('renders 0x, twelve leading hex digits, an ellipsis and eight trailing', () => {
    expect(renderApproval(BLOB)).toBe(`0xa1b2c3d4e5f6${ELLIPSIS}9876fedc`)
  })
})

describe('hidden value (D-302: sixteen dots beside a hidden chip)', () => {
  it('renders exactly sixteen dots and the Hidden chip', () => {
    const out = renderHiddenValue()
    expect(out.value).toBe('•'.repeat(16))
    expect(out.chip).toBe('Hidden')
  })
})

describe('member list (D-302: three members then a count of the rest)', () => {
  const members = ['alice.eth', 'bob.eth', 'carol.eth', 'dave.eth', 'erin.eth']

  it('renders a list of three with no count', () => {
    const out = renderMemberList(members.slice(0, 3))
    expect(out.shown).toEqual(['alice.eth', 'bob.eth', 'carol.eth'])
    expect(out.more).toBeNull()
  })

  it('renders a list of four as three then "1 more member"', () => {
    const out = renderMemberList(members.slice(0, 4))
    expect(out.shown).toEqual(['alice.eth', 'bob.eth', 'carol.eth'])
    expect(out.more).toBe('1 more member')
  })

  it('renders a list of five as three then "2 more members"', () => {
    const out = renderMemberList(members)
    expect(out.shown).toEqual(['alice.eth', 'bob.eth', 'carol.eth'])
    expect(out.more).toBe('2 more members')
  })

  it('renders a list of one or two whole with no count', () => {
    expect(renderMemberList(['alice.eth'])).toEqual({ shown: ['alice.eth'], more: null })
    expect(renderMemberList(['alice.eth', 'bob.eth'])).toEqual({
      shown: ['alice.eth', 'bob.eth'],
      more: null
    })
  })
})

describe('payment order (D-302: amount, symbol and payee, or no payment)', () => {
  const USDC = getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
  const PAYEE = getAddress('0x1111111111111111111111111111111111111111')
  const ZERO = '0x0000000000000000000000000000000000000000'
  const token = { symbol: 'USDC', decimals: 6 }

  it('renders 12.50 USDC to the payee', () => {
    const out = renderPaymentOrder({ token: USDC, amount: 12_500_000n, payee: PAYEE }, token)
    expect(out.startsWith('12.50 USDC to ')).toBe(true)
    const payee = out.slice('12.50 USDC to '.length)
    expect([renderShortAddress(PAYEE), renderFullAddress(PAYEE)]).toContain(payee)
  })

  it('renders an open payee as "to whoever executes"', () => {
    expect(renderPaymentOrder({ token: USDC, amount: 12_500_000n, payee: ZERO }, token)).toBe(
      '12.50 USDC to whoever executes'
    )
  })

  it('renders a zero amount as the words no payment', () => {
    expect(renderPaymentOrder({ token: USDC, amount: 0n, payee: PAYEE }, token)).toBe('No payment')
  })

  it('renders an absent order as the words no payment', () => {
    expect(renderPaymentOrder(undefined, token)).toBe('No payment')
  })
})
