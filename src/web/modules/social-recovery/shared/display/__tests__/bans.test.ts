/**
 * PT-036, done entries 3 and 4, I-26: Protected appears nowhere, and the banned
 * words of ux-copy.md reach no rendered chip, noun, label or value and no
 * exported string.
 *
 * Sources: docs/social-recovery/design/ux-copy.md (UXC-1 to UXC-7, UXC-9),
 * docs/social-recovery/design/invariants.yaml I-26, ux.md D-302.
 */
import en from '@common/config/localization/translations/en.json'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

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

const PAYEE: Address = '0x2b0f5e98ee98adc9865745e98802f333f72f6ef5'
const USDC: Address = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const ZERO: Address = '0x0000000000000000000000000000000000000000'
const TOKEN = { symbol: 'USDC', decimals: 6 }

// Every chip of every set, every noun of every list, every password name,
// value label and wallet word, as rendered.
const renderedVocabulary = (): string[] => [
  ...(Object.keys(display.CHIP_SETS) as display.ChipSetName[]).flatMap((set) =>
    (display.CHIP_SETS[set] as readonly string[]).map((chip) =>
      display.renderChip(set, chip as never)
    )
  ),
  ...[...display.KIT_NOUNS, ...display.CONCEPT_NOUNS, ...display.PARTY_NOUNS].map((noun) =>
    display.renderNoun(noun)
  ),
  ...display.PASSWORD_NAMES.map((name) => display.renderPasswordName(name)),
  ...display.VALUE_LABELS.map((label) => display.renderValueLabel(label)),
  ...display.WALLET_WORDS.map((word) => display.renderWalletWord(word)),
  ...display.APPROVAL_VALUES.flatMap((value) => [
    display.renderApprovalValueName(value),
    display.renderApprovalValueName(value, { doneScreen: true })
  ])
]

// One output of every value renderer.
const renderedValues = (): string[] => {
  const hidden = display.renderHiddenValue()
  const members = display.renderMemberList(['a', 'b', 'c', 'd', 'e'])
  const names = display.NAME_USES.map((use) => display.renderResolvedName('alice.eth', use))
  const deadline = display.renderDeadline({
    deadline: new Date('2026-08-13T16:04:00Z'),
    now: new Date('2026-08-12T17:04:00Z'),
    timeZone: 'Europe/Berlin'
  })
  return [
    hidden.dots,
    hidden.chip,
    members.more ?? '',
    ...names.flatMap((n) => [n?.name ?? '', n?.caveat ?? '']),
    display.renderPaymentOrder(undefined, TOKEN),
    display.renderPaymentOrder({ token: USDC, amount: 12_500_000n, payee: PAYEE }, TOKEN),
    display.renderPaymentOrder({ token: USDC, amount: 12_500_000n, payee: ZERO }, TOKEN),
    deadline.line ?? '',
    display.renderCountdown({ state: 'waiting', remainingMs: 1000 }),
    display.renderCountdown({ state: 'waiting', remainingMs: 1000, stopped: true }),
    display.renderCountdown({ state: 'executionDue', remainingMs: 0 }),
    display.renderCountdown({ state: 'executionDue', remainingMs: 0, stopped: true })
  ]
}

describe('bans over the display module (I-26, ux-copy.md)', () => {
  it('no exported string, vocabulary or key carries a banned word', () => {
    const exported = collect(display)
    // The walk reaches the vocabularies, so an empty walk cannot pass silently.
    expect(exported).toEqual(
      expect.arrayContaining(['recoveryRegistry', 'notStarted', 'stillNeeded', 'guardian'])
    )
    expect(hits(exported)).toEqual([])
  })

  it('no rendered chip of any set, noun of any list, name or label carries a banned word', () => {
    const rendered = renderedVocabulary()
    // 10 + 8 + 5 + 5 + 1 + 3 + 1 chips, 6 + 4 + 2 nouns: the walk is whole.
    expect(rendered).toEqual(
      expect.arrayContaining([
        'Not submitted',
        'Setup changed',
        'Still needed',
        'Guardian',
        'The party that can stop this method',
        'Controlled by'
      ])
    )
    expect(hits(rendered)).toEqual([])
  })

  it('no rendered chip, noun or label says protect or unprotected (UXC-6 reviewer rule)', () => {
    expect(renderedVocabulary().filter((s) => /protect/i.test(s))).toEqual([])
  })

  it('no rendered value carries a banned word or says protect', () => {
    const rendered = renderedValues()
    expect(hits(rendered)).toEqual([])
    expect(rendered.filter((s) => /protect/i.test(s))).toEqual([])
  })

  it('no socialRecovery value in en.json carries Protected', () => {
    expect(collect(en.socialRecovery).filter((s) => /\bProtected\b/.test(s))).toEqual([])
  })
})
