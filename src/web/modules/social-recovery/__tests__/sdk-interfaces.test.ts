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

describe('sdk-interfaces barrel (runtime)', () => {
  it('loads through @web/modules/social-recovery/sdk-interfaces', () => {
    expect(sdkInterfaces).toBeDefined()
  })

  it('exports at least one as-const vocabulary', () => {
    expect(runtimeExports.length).toBeGreaterThan(0)
  })

  // it.each rejects an empty table; the test above already fails in that case.
  const table = runtimeExports.length > 0 ? runtimeExports : [['(no runtime export)', 'none']]
  it.each(table)(
    '%s is a closed vocabulary of literals (no function, no class)',
    (_name, value) => {
      expect(typeof value).not.toBe('function')
      expect(isLiteralTree(value)).toBe(true)
    }
  )
})
