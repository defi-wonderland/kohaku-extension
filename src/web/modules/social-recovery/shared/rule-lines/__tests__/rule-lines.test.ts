/**
 * PT-037 The rule lines.
 *
 * Sources: docs/social-recovery/briefs/PT-037.md ("Test expectations"),
 * docs/social-recovery/tasks/PT-037-the-rule-lines.md (Done),
 * docs/social-recovery/design/ux.md D-305 (every rule line and the shape that
 * earns it) and D-312 (one failure domain keyed on the method family; no
 * identity weight line, no "primary", no "offered"),
 * docs/social-recovery/design/ux-copy.md (UXC bans).
 *
 * The expected lines below were derived from D-305 before the implementation
 * was read. Keys are compared by their last segment, so a descriptor may carry
 * either the short key or the full `socialRecovery.ruleLines.<name>` path; the
 * rendering tests run every descriptor through a real i18next instance loaded
 * with the real en.json, which settles whether the key resolves.
 */
import i18next, { TFunction } from 'i18next'

import en from '@common/config/localization/translations/en.json'
import type {
  Clause,
  Credential,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces/interactor'

import { buildRuleLines, renderRuleLines } from '..'

type Hex = `0x${string}`

// One method address per family: the draft's credentials carry the method
// address, and D-312 keys the failure domain on the family.
const PASSKEY = '0x1000000000000000000000000000000000000001' as Hex
const PASSPORT = '0x2000000000000000000000000000000000000002' as Hex
const AADHAAR = '0x3000000000000000000000000000000000000003' as Hex
const GUARDIAN = '0x4000000000000000000000000000000000000004' as Hex

let configCounter = 0
const cred = (method: Hex): Credential => {
  configCounter += 1
  return { method, config: `0x${configCounter.toString(16).padStart(64, '0')}` as Hex }
}

// A required row is a clause of one credential at threshold one.
const row = (method: Hex): Clause => ({ threshold: 1, credentials: [cred(method)] })
const group = (threshold: number, methods: Hex[]): Clause => ({
  threshold,
  credentials: methods.map(cred)
})

const draft = (clauses: Clause[]): SetupDraft => ({
  wait: 604800n,
  clauses,
  ignoresPause: false,
  privacy: { publicMetadata: '0x' as Hex, backup: 'encrypted' }
})

const RULE_LINES = (en as { socialRecovery: { ruleLines: Record<string, string> } })
  .socialRecovery.ruleLines
const PREFIX = 'socialRecovery.ruleLines.'

const shortKey = (key: string): string => (key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key)

type Expected = { key: string; params?: Record<string, number> }

const SINGLE_METHOD: Expected[] = [
  { key: 'singleMethod' },
  { key: 'secondMethodOffer' },
  { key: 'platformFate' }
]

// The table of shapes of the brief's "Test expectations", with the lines D-305
// states for each, in D-305's order: the rows' line or the single-method
// warning with its offer, the group's count line, every member must answer,
// one failure domain, the setup line on different places, the sizing rule.
const SHAPES: { name: string; clauses: Clause[]; expected: Expected[] }[] = [
  {
    name: 'one row: the single-method warning with the second passkey or hardware key offer',
    clauses: [row(PASSKEY)],
    expected: SINGLE_METHOD
  },
  {
    name: 'two rows: both must answer, and the sizing rule line',
    clauses: [row(PASSKEY), row(PASSPORT)],
    expected: [{ key: 'bothMustAnswer' }, { key: 'differentPlaces' }, { key: 'sizingRule' }]
  },
  {
    name: 'three rows: all 3 must answer',
    clauses: [row(PASSKEY), row(PASSPORT), row(GUARDIAN)],
    expected: [{ key: 'allMustAnswer', params: { n: 3 } }, { key: 'differentPlaces' }]
  },
  {
    name: 'a group of one: one member is one method, the single-method warning',
    clauses: [group(1, [PASSKEY])],
    expected: SINGLE_METHOD
  },
  {
    name: 'a group of two at threshold one: either one alone',
    clauses: [group(1, [PASSKEY, PASSPORT])],
    expected: [{ key: 'eitherOneAlone' }, { key: 'differentPlaces' }]
  },
  {
    name: 'a group of three at threshold one: any one of these 3 alone',
    clauses: [group(1, [PASSKEY, PASSPORT, GUARDIAN])],
    expected: [{ key: 'anyOneOfM', params: { m: 3 } }, { key: 'differentPlaces' }]
  },
  {
    name: 'a group of three at threshold two: any 2 of these 3, losing more than 1',
    clauses: [group(2, [PASSKEY, PASSPORT, GUARDIAN])],
    expected: [{ key: 'anyNOfM', params: { n: 2, m: 3, spare: 1 } }, { key: 'differentPlaces' }]
  },
  {
    name: 'a group at threshold equal to its size: every member must answer',
    clauses: [group(3, [PASSKEY, PASSPORT, GUARDIAN])],
    expected: [
      { key: 'anyNOfM', params: { n: 3, m: 3, spare: 0 } },
      { key: 'everyMemberMustAnswer' },
      { key: 'differentPlaces' }
    ]
  },
  {
    name: 'a group beside required rows: together with your required methods',
    clauses: [row(PASSKEY), group(2, [PASSPORT, GUARDIAN, AADHAAR])],
    expected: [
      { key: 'togetherWithRequired', params: { n: 2, m: 3, spare: 1 } },
      { key: 'differentPlaces' }
    ]
  },
  {
    name: 'two groups: together with one member of each other group',
    clauses: [group(1, [PASSKEY, PASSPORT]), group(2, [GUARDIAN, AADHAAR, PASSKEY])],
    expected: [
      { key: 'togetherWithRequiredAndGroups', params: { n: 1, m: 2, spare: 1 } },
      { key: 'togetherWithRequiredAndGroups', params: { n: 2, m: 3, spare: 1 } },
      { key: 'differentPlaces' }
    ]
  },
  {
    name: 'a group whose members are all guardians: one failure domain',
    clauses: [group(2, [GUARDIAN, GUARDIAN, GUARDIAN])],
    expected: [
      { key: 'anyNOfM', params: { n: 2, m: 3, spare: 1 } },
      { key: 'oneFailureDomain' },
      { key: 'differentPlaces' }
    ]
  },
  {
    name: 'a group of a passport and an Aadhaar identity: two domains, no failure-domain line',
    clauses: [group(1, [PASSPORT, AADHAAR])],
    expected: [{ key: 'eitherOneAlone' }, { key: 'differentPlaces' }]
  }
]

// Further shapes the negative and purity assertions sweep.
const EXTRA_SHAPES: Clause[][] = [
  [row(PASSPORT)],
  [row(AADHAAR), row(PASSPORT)],
  [row(PASSKEY), group(1, [PASSPORT, AADHAAR])],
  [row(PASSKEY), group(2, [GUARDIAN, GUARDIAN, GUARDIAN])],
  [group(2, [PASSPORT, AADHAAR])],
  [
    row(PASSKEY),
    row(PASSPORT),
    group(1, [GUARDIAN, AADHAAR]),
    group(2, [GUARDIAN, GUARDIAN, GUARDIAN])
  ]
]
const EVERY_SHAPE: Clause[][] = [...SHAPES.map((s) => s.clauses), ...EXTRA_SHAPES]

const i18n = i18next.createInstance()
beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'app',
    resources: { en: { app: en } },
    interpolation: { escapeValue: false },
    initImmediate: false
  })
})
const t = ((key: string, params?: Record<string, unknown>) => i18n.t(key, params)) as TFunction

// The English a line renders to, filled by hand from en.json, independent of
// the implementation's rendering path.
const englishOf = (e: Expected): string =>
  RULE_LINES[e.key].replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = e.params?.[name]
    if (value === undefined) throw new Error(`missing param ${name} for ${e.key}`)
    return String(value)
  })

const linesOf = (clauses: Clause[]) => buildRuleLines(draft(clauses))
const keysOf = (clauses: Clause[]) => linesOf(clauses).map((l) => shortKey(l.key))
const renderedAll = () => EVERY_SHAPE.flatMap((clauses) => renderRuleLines(linesOf(clauses), t))

describe('buildRuleLines: the table of shapes (D-305)', () => {
  it.each(SHAPES)('$name', ({ clauses, expected }) => {
    const lines = linesOf(clauses)
    expect(lines.map((l) => shortKey(l.key))).toEqual(expected.map((e) => e.key))
    lines.forEach((line, i) => {
      const params = expected[i].params
      if (params) expect(line.params).toMatchObject(params)
    })
  })

  it('every key it returns names a real string under socialRecovery.ruleLines', () => {
    EVERY_SHAPE.forEach((clauses) => {
      keysOf(clauses).forEach((key) => expect(Object.keys(RULE_LINES)).toContain(key))
    })
  })

  it('a two item path as one group of any one of two carries no sizing rule line', () => {
    expect(keysOf([group(1, [PASSKEY, PASSPORT])])).not.toContain('sizingRule')
  })

  it('a row beside a group carries neither the single-method warning nor a threshold-one form', () => {
    const keys = keysOf([row(PASSKEY), group(1, [PASSPORT, GUARDIAN])])
    expect(keys).not.toContain('singleMethod')
    expect(keys).not.toContain('eitherOneAlone')
    expect(keys).not.toContain('bothMustAnswer')
  })

  it('a group of passkeys alone is one failure domain; a passport beside a passkey is not', () => {
    expect(keysOf([group(1, [PASSKEY, PASSKEY])])).toContain('oneFailureDomain')
    expect(keysOf([group(1, [PASSKEY, PASSPORT])])).not.toContain('oneFailureDomain')
  })
})

describe('renderRuleLines: the rendered English through the real en.json', () => {
  it.each(SHAPES)('$name', ({ clauses, expected }) => {
    const rendered = renderRuleLines(linesOf(clauses), t)
    expect(rendered).toEqual(expected.map(englishOf))
    rendered.forEach((s) => {
      expect(s).not.toMatch(/\{\{|\}\}/)
      expect(s).not.toMatch(/socialRecovery|ruleLines/)
    })
  })

  it('renders the exact sentences D-305 states for the placeholder lines', () => {
    expect(renderRuleLines(linesOf([row(PASSKEY), row(PASSPORT), row(GUARDIAN)]), t)[0]).toBe(
      'All 3 must answer. Losing any one locks you out.'
    )
    expect(renderRuleLines(linesOf([group(2, [PASSKEY, PASSPORT, GUARDIAN])]), t)[0]).toBe(
      'Any 2 of these 3 recover this account. Losing more than 1 locks you out.'
    )
    expect(renderRuleLines(linesOf([group(1, [PASSKEY, PASSPORT, GUARDIAN, AADHAAR])]), t)[0]).toBe(
      'Any one of these 4 alone can recover this account. Any one alone can also take it.'
    )
    expect(
      renderRuleLines(linesOf([row(PASSKEY), group(2, [PASSPORT, GUARDIAN, AADHAAR])]), t)[0]
    ).toBe(
      'Together with your required methods, any 2 of these 3 recover this account. Losing more than 1 locks you out.'
    )
  })
})

describe('negative assertions (D-312, ux-copy.md)', () => {
  it('renders at least one line for every shape', () => {
    EVERY_SHAPE.forEach((clauses) =>
      expect(renderRuleLines(linesOf(clauses), t).length).toBeGreaterThan(0)
    )
  })

  it('no output contains "primary" or "offered"', () => {
    renderedAll().forEach((s) => {
      expect(s).not.toMatch(/\bprimary\b/i)
      expect(s).not.toMatch(/\boffered\b/i)
    })
  })

  it("no output states the identity method's weight or raising a threshold", () => {
    renderedAll().forEach((s) => {
      expect(s).not.toMatch(/\bweigh(?:t|ts|s|ed)?\b/i)
      expect(s).not.toMatch(/\b(?:raise|raising|increase|increasing)\b/i)
      expect(s).not.toMatch(/\bsecondary\b/i)
    })
  })

  it('no output contains a banned word of ux-copy.md', () => {
    const bans = [
      /\bpolic(?:y|ies)\b/i,
      /\bproofs?\b/i,
      /\brelayers?\b/i,
      /\bEIP[-\s]?712\b/i,
      /\batomic(?:ally)?\b/i,
      /\bProtected\b/,
      /\bprotect(?:s|ed|ion)?\b/i,
      /\bunprotected\b/i,
      /\byour\s+people\b/i,
      /\bfull\s+wallet\s+passwords?\b/i
    ]
    renderedAll().forEach((s) => bans.forEach((ban) => expect(s).not.toMatch(ban)))
  })

  it('no descriptor key names a weight, primary, offered or threshold-raise line', () => {
    EVERY_SHAPE.forEach((clauses) =>
      keysOf(clauses).forEach((key) => expect(key).not.toMatch(/weight|primary|offered|raise/i))
    )
  })
})

describe('purity', () => {
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
      Object.values(value as object).forEach(deepFreeze)
      Object.freeze(value)
    }
    return value
  }

  it.each(EVERY_SHAPE.map((clauses, i) => ({ i, clauses })))(
    'same input twice yields equal output and the input is not mutated (shape $i)',
    ({ clauses }) => {
      const input = draft(clauses)
      const snapshot = structuredClone(input)
      const first = buildRuleLines(input)
      const second = buildRuleLines(input)
      expect(second).toEqual(first)
      expect(input).toEqual(snapshot)
      const frozen = deepFreeze(structuredClone(input))
      expect(buildRuleLines(frozen)).toEqual(first)
    }
  )
})
