/**
 * Runtime check of the SDK interfaces barrel, setup brief item 2
 * (docs/social-recovery/briefs/chore-social-recovery-setup.md): types only,
 * plus `as const` objects for closed vocabularies. No function, no class.
 * The type surface itself is checked by tsc through sdk-interfaces.types.test.ts.
 */
import * as sdkInterfaces from '@web/modules/social-recovery/sdk-interfaces'

const runtimeExports = Object.entries(sdkInterfaces as Record<string, unknown>).filter(
  ([name]) => name !== '__esModule'
)

// Every leaf of an `as const` vocabulary is a string, number or boolean.
const isLiteralTree = (value: unknown): boolean => {
  if (['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isLiteralTree)
  if (typeof value === 'object' && value !== null) {
    return (
      Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isLiteralTree)
    )
  }
  return false
}

// The closed vocabularies the implementer declares `as const` in
// src/web/modules/social-recovery/sdk-interfaces/*.ts, by file.
const VOCABULARIES = [
  // interactor.ts (D-202)
  'SENDERS',
  'ATTEMPT_STATES',
  'BACKUP_FORMS',
  // events.ts (D-203)
  'CANCELLED_BY',
  'NOTIFICATION_KINDS',
  // utilities.ts (D-205)
  'SETUP_ERROR_CODES',
  'SETUP_WARNING_CODES',
  'REQUEST_ERROR_CODES',
  'REQUEST_WARNING_CODES',
  'RESTORE_CAUSES',
  'FINDING_SUBJECTS',
  'KIT_ERROR_SOURCES',
  'KIT_ERROR_NAMES',
  // methods.ts (D-206)
  'DEVICE_BINDINGS',
  'VERDICTS',
  'METHOD_FAILURE_CAUSES',
  'DEVICE_KINDS',
  // gathering.ts (D-207)
  'GATHERING_PURPOSES',
  'PLACE_STANDINGS',
  'GATHERING_RECORD_KINDS',
  'ADD_REFUSAL_REASONS',
  // privacy.ts (D-375)
  'PRIVACY_LEVELS'
]

const exported = sdkInterfaces as unknown as Record<string, unknown>

describe('sdk-interfaces barrel (runtime)', () => {
  VOCABULARIES.forEach((name) =>
    it(`exports ${name} as a non-empty list of unique strings`, () => {
      const value = exported[name]
      expect(Array.isArray(value)).toBe(true)
      const list = value as unknown[]
      expect(list.length).toBeGreaterThan(0)
      list.forEach((item) => expect(typeof item).toBe('string'))
      expect(new Set(list).size).toBe(list.length)
    })
  )

  it('holds the three restore causes of D-205', () => {
    expect(exported.RESTORE_CAUSES).toHaveLength(3)
  })

  it('holds the three privacy levels of D-375, private as the default', () => {
    expect(exported.PRIVACY_LEVELS).toHaveLength(3)
    expect(exported.PRIVACY_LEVELS).toContain(exported.DEFAULT_PRIVACY_LEVEL)
  })

  it('loads through @web/modules/social-recovery/sdk-interfaces', () => {
    expect(sdkInterfaces).toBeDefined()
  })

  it('exports at least one as-const vocabulary', () => {
    expect(runtimeExports.length).toBeGreaterThan(0)
  })

  runtimeExports.forEach(([name, value]) =>
    it(`${name} is a closed vocabulary of literals (no function, no class)`, () => {
      expect(typeof value).not.toBe('function')
      expect(isLiteralTree(value)).toBe(true)
    })
  )
})
