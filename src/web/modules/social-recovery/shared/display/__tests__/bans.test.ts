/**
 * PT-036, done entries 3 and 4, I-26: Protected appears nowhere, and the banned
 * words of ux-copy.md reach no rendered chip or noun and no exported string.
 *
 * Sources: docs/social-recovery/design/ux-copy.md (UXC-1 to UXC-7, UXC-9),
 * docs/social-recovery/design/invariants.yaml I-26, ux.md D-302.
 */
import i18n from '@common/config/localization/localization'
import en from '@common/config/localization/translations/en.json'

import * as display from '..'

const BANS: { rule: string; pattern: RegExp }[] = [
  { rule: 'UXC-1 policy', pattern: /\bpolic(?:y|ies)\b/i },
  { rule: 'UXC-2 proof', pattern: /\bproofs?\b/i },
  { rule: 'UXC-3 relayer', pattern: /\brelayers?\b/i },
  { rule: 'UXC-4 EIP-712', pattern: /\bEIP[-\s]?712\b/i },
  { rule: 'UXC-5 atomic', pattern: /\batomic(?:ally)?\b/i },
  { rule: 'UXC-6 Protected', pattern: /\bProtected\b/ },
  { rule: 'UXC-7 your people', pattern: /\byour\s+people\b/i },
  { rule: 'UXC-9 full wallet password', pattern: /\bfull\s+wallet\s+passwords?\b/i }
]

// Every string reachable from a value, depth first.
const collect = (value: unknown, out: string[] = [], seen = new Set<unknown>()): string[] => {
  if (typeof value === 'string') out.push(value)
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    Object.values(value as Record<string, unknown>).forEach((v) => collect(v, out, seen))
  }
  return out
}

const hits = (strings: string[]) =>
  strings.flatMap((s) =>
    BANS.filter(({ pattern }) => pattern.test(s)).map(({ rule }) => `${rule}: ${s}`)
  )

const renderedChipsAndNouns = (): string[] => {
  const out: string[] = []
  const sets: [Parameters<typeof display.chipKey>[0], readonly string[]][] = [
    ['method', display.METHOD_CHIPS],
    ['collection', display.COLLECTION_CHIPS],
    ['attempt', display.ATTEMPT_CHIPS],
    ['recovery', display.RECOVERY_STATUS_CHIPS]
  ]
  sets.forEach(([set, chips]) =>
    chips.forEach((chip) => out.push(i18n.t(display.chipKey(set, chip as never))))
  )
  display.KIT_NOUNS.forEach((noun) => out.push(i18n.t(display.nounKey(noun))))
  display.PASSWORD_NAMES.forEach((name) => out.push(i18n.t(display.passwordKey(name))))
  return out
}

describe('bans over the display module (I-26, ux-copy.md)', () => {
  it('no exported string, vocabulary or key carries a banned word', () => {
    const exported = collect(display)
    // The walk reaches the vocabularies, so an empty walk cannot pass silently.
    expect(exported).toEqual(expect.arrayContaining(['recoveryRegistry', 'notStarted']))
    expect(hits(exported)).toEqual([])
  })

  it('no rendered chip, noun or password name carries a banned word', () => {
    const rendered = renderedChipsAndNouns()
    expect(rendered.length).toBeGreaterThan(0)
    expect(hits(rendered)).toEqual([])
  })

  it('no rendered chip or noun says protect or unprotected (UXC-6 reviewer rule)', () => {
    expect(renderedChipsAndNouns().filter((s) => /protect/i.test(s))).toEqual([])
  })

  it('no socialRecovery value in en.json carries Protected', () => {
    expect(collect(en.socialRecovery).filter((s) => /\bProtected\b/.test(s))).toEqual([])
  })

  it('the rendered hidden value and no-payment words carry no banned word', () => {
    const hidden = display.renderHiddenValue()
    const noPayment = display.renderPaymentOrder(undefined, { symbol: 'USDC', decimals: 6 })
    expect(hits([hidden.dots, hidden.chip, noPayment])).toEqual([])
  })
})
