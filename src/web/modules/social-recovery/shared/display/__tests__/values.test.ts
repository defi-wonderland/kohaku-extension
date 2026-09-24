/**
 * PT-036, done entry 1: each value type of D-302 renders in exactly one form.
 *
 * Sources: docs/social-recovery/briefs/PT-036.md (Test expectations),
 * docs/social-recovery/tasks/PT-036-display-rules-and-the-status-vocabulary.md
 * (Done), docs/social-recovery/design/ux.md D-302. Every expectation is a
 * literal, never rebuilt with the calls the code makes.
 */
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import {
  ellipsizeName,
  renderApproval,
  renderFullAddress,
  renderHash,
  renderHiddenValue,
  renderMemberList,
  renderPaymentOrder,
  renderShortAddress,
  Translate
} from '..'

// The D-302 example address, checksummed (EIP-55).
const CHECKSUMMED = '0x2b0F5E98Ee98ADC9865745e98802F333f72F6ef5'
const LOWER = '0x2b0f5e98ee98adc9865745e98802f333f72f6ef5'
const UPPER = '0x2B0F5E98EE98ADC9865745E98802F333F72F6EF5'
// One letter's case flipped: mixed case with a checksum that does not hold.
const BAD_CHECKSUM = '0x2B0F5E98Ee98ADC9865745e98802F333f72F6ef5'

describe('short address (D-302: four and four hex digits after the prefix)', () => {
  it('renders the D-302 example 0x2b0F…6ef5', () => {
    expect(renderShortAddress(CHECKSUMMED)).toBe('0x2b0F…6ef5')
  })

  it('checksums a lowercase or an all-uppercase address', () => {
    expect(renderShortAddress(LOWER)).toBe('0x2b0F…6ef5')
    expect(renderShortAddress(UPPER)).toBe('0x2b0F…6ef5')
  })

  it('rejects a mixed-case address whose checksum does not hold', () => {
    expect(() => renderShortAddress(BAD_CHECKSUM)).toThrow()
  })
})

describe('full address (D-302: whole, no grouping)', () => {
  it('renders the checksummed address whole', () => {
    expect(renderFullAddress(LOWER)).toBe('0x2b0F5E98Ee98ADC9865745e98802F333f72F6ef5')
    expect(renderFullAddress(UPPER)).toBe('0x2b0F5E98Ee98ADC9865745e98802F333f72F6ef5')
  })

  it('rejects a mixed-case address whose checksum does not hold', () => {
    expect(() => renderFullAddress(BAD_CHECKSUM)).toThrow()
  })

  it('rejects a value that is not a 20-byte address', () => {
    expect(() => renderFullAddress('0x2b0f')).toThrow()
  })
})

describe('user-typed method name (D-302: caps at 24 characters)', () => {
  it('leaves a 24-character name unchanged', () => {
    expect(ellipsizeName('Abcdefghijklmnopqrstuvwx')).toBe('Abcdefghijklmnopqrstuvwx')
  })

  it('leaves a short name unchanged', () => {
    expect(ellipsizeName('My passkey')).toBe('My passkey')
  })

  it('caps a 25-character name at 24, the ellipsis the last of them', () => {
    expect(ellipsizeName('Abcdefghijklmnopqrstuvwxy')).toBe('Abcdefghijklmnopqrstuvw…')
  })

  it('caps a long name at the same 24', () => {
    expect(ellipsizeName('x'.repeat(80))).toBe(`${'x'.repeat(23)}…`)
  })

  it('counts a joined emoji as one character and never splits it', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
    // 24 graphemes, many more code points: unchanged.
    expect(ellipsizeName(`${'a'.repeat(23)}${family}`)).toBe(`${'a'.repeat(23)}${family}`)
    // 25 graphemes: the emoji is the 23rd and stays whole before the ellipsis.
    expect(ellipsizeName(`${'a'.repeat(22)}${family}bb`)).toBe(`${'a'.repeat(22)}${family}…`)
  })

  it('counts a flag as one character and never splits it', () => {
    const flag = '\u{1F1E9}\u{1F1EA}'
    expect(ellipsizeName(`${'a'.repeat(22)}${flag}cc`)).toBe(`${'a'.repeat(22)}${flag}…`)
  })

  // The empty-name rule (null, no name and no caveat) lives in
  // renderResolvedName and is tested in caveat.test.ts; the cut itself keeps
  // an empty user-typed name empty.
  it('leaves an empty name empty', () => {
    expect(ellipsizeName('')).toBe('')
  })
})

describe('transaction hash or challenge (D-302: twelve and six)', () => {
  const HASH = `0x0123456789ab${'c'.repeat(46)}fedcba`

  it('fixture is a 32-byte hash', () => {
    expect(HASH).toHaveLength(66)
  })

  it('renders 0x, twelve leading hex digits, an ellipsis and six trailing', () => {
    expect(renderHash(HASH)).toBe('0x0123456789ab…fedcba')
  })
})

describe('approval blob (D-302: twelve and eight)', () => {
  // A 65-byte signature-shaped blob.
  const BLOB = `0xa1b2c3d4e5f6${'0'.repeat(110)}9876fedc`

  it('fixture is a 65-byte blob', () => {
    expect(BLOB).toHaveLength(132)
  })

  it('renders 0x, twelve leading hex digits, an ellipsis and eight trailing', () => {
    expect(renderApproval(BLOB)).toBe('0xa1b2c3d4e5f6…9876fedc')
  })
})

describe('hidden value (D-302: sixteen dots beside a hidden chip)', () => {
  it('renders exactly sixteen dots and the Hidden chip', () => {
    expect(renderHiddenValue()).toEqual({
      dots: '••••••••••••••••',
      chip: 'Hidden'
    })
  })
})

describe('member list (D-302: three members then a count of the rest)', () => {
  const members = ['alice.eth', 'bob.eth', 'carol.eth', 'dave.eth', 'erin.eth']

  it('renders a list of three with no count', () => {
    expect(renderMemberList(members.slice(0, 3))).toEqual({
      shown: ['alice.eth', 'bob.eth', 'carol.eth'],
      restCount: 0,
      more: null
    })
  })

  it('renders a list of four as three then "1 more member"', () => {
    expect(renderMemberList(members.slice(0, 4))).toEqual({
      shown: ['alice.eth', 'bob.eth', 'carol.eth'],
      restCount: 1,
      more: '1 more member'
    })
  })

  it('renders a list of five as three then "2 more members"', () => {
    expect(renderMemberList(members)).toEqual({
      shown: ['alice.eth', 'bob.eth', 'carol.eth'],
      restCount: 2,
      more: '2 more members'
    })
  })

  it('renders a list of one or two whole with no count', () => {
    expect(renderMemberList(['alice.eth'])).toEqual({
      shown: ['alice.eth'],
      restCount: 0,
      more: null
    })
    expect(renderMemberList(['alice.eth', 'bob.eth'])).toEqual({
      shown: ['alice.eth', 'bob.eth'],
      restCount: 0,
      more: null
    })
  })

  it('renders every member on the D-392 checklist', () => {
    expect(renderMemberList(members, { showAll: true })).toEqual({
      shown: members,
      restCount: 0,
      more: null
    })
  })
})

describe('payment order (D-302: amount, symbol and payee, or no payment, one form)', () => {
  const USDC: Address = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const PAYEE: Address = LOWER
  const ZERO: Address = '0x0000000000000000000000000000000000000000'
  const token = { symbol: 'USDC', decimals: 6 }

  it('renders 12.50 USDC to the payee in the full form', () => {
    expect(renderPaymentOrder({ token: USDC, amount: 12_500_000n, payee: PAYEE }, token)).toBe(
      '12.50 USDC to 0x2b0F5E98Ee98ADC9865745e98802F333f72F6ef5'
    )
  })

  it('renders a whole amount with two decimals and a long fraction whole', () => {
    expect(renderPaymentOrder({ token: USDC, amount: 3_000_000n, payee: PAYEE }, token)).toBe(
      '3.00 USDC to 0x2b0F5E98Ee98ADC9865745e98802F333f72F6ef5'
    )
    expect(renderPaymentOrder({ token: USDC, amount: 1_234_567n, payee: PAYEE }, token)).toBe(
      '1.234567 USDC to 0x2b0F5E98Ee98ADC9865745e98802F333f72F6ef5'
    )
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

  it('takes the translate function as its third parameter and passes it the full payee', () => {
    // Compile-time, held by `npx tsc --noEmit` (ts-jest reports no type error
    // here): a payee-form option in the third place would make this false.
    type Third = Parameters<typeof renderPaymentOrder>[2]
    const thirdIsTranslate: Third extends Translate | undefined ? true : false = true
    expect(thirdIsTranslate).toBe(true)

    const calls: [string, Record<string, unknown> | undefined][] = []
    const t: Translate = (key, options) => {
      calls.push([key, options])
      return `<${key}>`
    }
    expect(renderPaymentOrder({ token: USDC, amount: 12_500_000n, payee: PAYEE }, token, t)).toBe(
      '<socialRecovery.display.paymentOrder>'
    )
    expect(calls).toEqual([
      [
        'socialRecovery.display.paymentOrder',
        {
          amount: '12.50',
          symbol: 'USDC',
          payee: '0x2b0F5E98Ee98ADC9865745e98802F333f72F6ef5'
        }
      ]
    ])
  })
})
