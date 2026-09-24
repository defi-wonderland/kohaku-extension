/**
 * Copy lint over the social recovery strings of en.json.
 *
 * Sources: docs/social-recovery/design/ux-copy.md (UXC-1 to UXC-7, UXC-9),
 * docs/social-recovery/design/ux.md D-300 (the string table is the copy-lint
 * surface) and D-302 (the closed chip vocabulary, I-26),
 * docs/social-recovery/briefs/chore-social-recovery-setup.md item 4.
 */
import fs from 'fs'
import path from 'path'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

const EN_JSON_PATH = path.resolve(
  __dirname,
  '../../../../common/config/localization/translations/en.json'
)

const enRaw = fs.readFileSync(EN_JSON_PATH, 'utf8')
const en = JSON.parse(enRaw) as JsonObject

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Entry = { keyPath: string; value: string }

// Walks every string value below `node`, depth first, keeping the key path.
const collectStrings = (node: JsonValue, keyPath: string, out: Entry[] = []): Entry[] => {
  if (typeof node === 'string') {
    out.push({ keyPath, value: node })
  } else if (Array.isArray(node)) {
    node.forEach((item, i) => collectStrings(item, `${keyPath}[${i}]`, out))
  } else if (isObject(node)) {
    Object.entries(node).forEach(([k, v]) => collectStrings(v, `${keyPath}/${k}`, out))
  }
  return out
}

// Walks every key below `node`, keeping the key path.
const collectKeys = (node: JsonValue, keyPath: string, out: Entry[] = []): Entry[] => {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectKeys(item, `${keyPath}[${i}]`, out))
  } else if (isObject(node)) {
    Object.entries(node).forEach(([k, v]) => {
      out.push({ keyPath: `${keyPath}/${k}`, value: k })
      collectKeys(v, `${keyPath}/${k}`, out)
    })
  }
  return out
}

// Whole-word bans. "Word-bounded" means a longer word that merely contains the
// term (proofread, waterproof, relayed) is not a hit, but the plural of
// the banned word is, since the ban names the term and its plural is the term.
const CASE_INSENSITIVE_BANS: { rule: string; term: string; pattern: RegExp }[] = [
  { rule: 'UXC-1', term: 'policy', pattern: /\bpolic(?:y|ies)\b/i },
  { rule: 'UXC-2', term: 'proof', pattern: /\bproofs?\b/i },
  { rule: 'UXC-3', term: 'relayer', pattern: /\brelayers?\b/i },
  // Hyphen, space or nothing between EIP and 712.
  { rule: 'UXC-4', term: 'EIP-712', pattern: /\bEIP[-\s]?712\b/i },
  { rule: 'UXC-5', term: 'atomic', pattern: /\batomic(?:ally)?\b/i },
  { rule: 'UXC-7', term: 'your people', pattern: /\byour\s+people\b/i },
  { rule: 'UXC-9', term: 'full wallet password', pattern: /\bfull\s+wallet\s+passwords?\b/i }
]

// UXC-6 / I-26: the label Protected, case-sensitive, whole word.
const PROTECTED_BAN = /\bProtected\b/

// D-302, the closed chip vocabulary.
const CHIP_VOCABULARY = [
  // a method in setup
  'not started',
  'in progress',
  'tested',
  'not tested',
  'test failed',
  'test unavailable',
  'not supported',
  'not yet active',
  'saved',
  'live',
  // a row in collection
  'not asked',
  'waiting',
  'declined',
  'unanswered',
  'complete',
  'not needed',
  'did not answer',
  'stopped',
  // an attempt
  'recovery in progress',
  'execution due',
  'cancelled',
  // the recovery status and the three extra chips
  'set up',
  'not set up',
  'path locked',
  'not active',
  'cannot recover'
]

const socialRecovery = en.socialRecovery
const strings = isObject(socialRecovery) ? collectStrings(socialRecovery, 'socialRecovery') : []
const keys = isObject(socialRecovery) ? collectKeys(socialRecovery, 'socialRecovery') : []

describe('socialRecovery strings in en.json', () => {
  it('has a non-empty socialRecovery block', () => {
    expect(isObject(socialRecovery)).toBe(true)
    expect(Object.keys(socialRecovery as JsonObject).length).toBeGreaterThan(0)
    expect(strings.length).toBeGreaterThan(0)
  })

  it('uses no ":" and no "." in any key (i18next separators)', () => {
    const offenders = keys
      .filter(({ value }) => value.includes('.') || value.includes(':'))
      .map(({ keyPath }) => keyPath)
    expect(offenders).toEqual([])
  })

  it.each(CASE_INSENSITIVE_BANS)('carries no $rule banned term "$term"', ({ pattern }) => {
    const offenders = strings
      .filter(({ value }) => pattern.test(value))
      .map(({ keyPath, value }) => `${keyPath}: ${value}`)
    expect(offenders).toEqual([])
  })

  it('carries no UXC-6 banned label "Protected" (case-sensitive)', () => {
    const offenders = strings
      .filter(({ value }) => PROTECTED_BAN.test(value))
      .map(({ keyPath, value }) => `${keyPath}: ${value}`)
    expect(offenders).toEqual([])
  })

  it('has "Protected" nowhere in en.json, as a key or a value (I-26)', () => {
    const all = [...collectStrings(en, ''), ...collectKeys(en, '')]
    const offenders = all
      .filter(({ value }) => PROTECTED_BAN.test(value))
      .map(({ keyPath, value }) => `${keyPath}: ${value}`)
    expect(offenders).toEqual([])
  })

  it('holds the whole D-302 chip vocabulary among the values of socialRecovery.status', () => {
    const status = isObject(socialRecovery) ? socialRecovery.status : undefined
    expect(isObject(status)).toBe(true)
    const statusValues = new Set(
      collectStrings(status as JsonValue, 'status').map(({ value }) => value.trim().toLowerCase())
    )
    const missing = CHIP_VOCABULARY.filter((chip) => !statusValues.has(chip))
    expect(missing).toEqual([])
  })
})

describe('copy-lint patterns (self-check)', () => {
  const hits = (text: string) => CASE_INSENSITIVE_BANS.filter(({ pattern }) => pattern.test(text))

  it('flags each banned term, its plural and its casing variants', () => {
    ;[
      'Policy',
      'policies',
      'PROOF',
      'proofs',
      'Relayer',
      'relayers',
      'EIP-712',
      'eip712',
      'Atomic',
      'atomically',
      'Your people',
      'Full wallet password'
    ].forEach((text) => expect(hits(text).length).toBe(1))
  })

  it('does not flag longer words that only contain a banned term', () => {
    ;['proofread', 'waterproof', 'relayed', 'atomicity-free', 'people', 'wallet password'].forEach(
      (text) => {
        const found = hits(text).map(({ term }) => term)
        expect(found).toEqual([])
      }
    )
  })

  it('reads Protected case-sensitively', () => {
    expect(PROTECTED_BAN.test('Protected')).toBe(true)
    expect(PROTECTED_BAN.test('protected')).toBe(false)
    expect(PROTECTED_BAN.test('Unprotected')).toBe(false)
  })
})
