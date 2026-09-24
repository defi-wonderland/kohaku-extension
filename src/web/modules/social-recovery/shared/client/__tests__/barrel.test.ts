/**
 * The lane's barrel is what a screen imports (brief "Outcome"): screens import
 * `@web/modules/social-recovery/shared/client` and never the doubles, so the
 * swap to the real SDK touches one folder. The stand-in that builds against
 * the doubles and the React hook stay out of it.
 */
import * as doubles from '@web/modules/social-recovery/sdk-doubles'
import * as lane from '@web/modules/social-recovery/shared/client'

describe('the lane barrel', () => {
  it('does not export the SDK stand-in', () => {
    expect(Object.keys(lane)).not.toContain('sdkStandIn')
  })

  it('does not export the React hook, so it loads in a Node test', () => {
    expect(Object.keys(lane)).not.toContain('useRecoveryClient')
  })

  it('hands a screen no class or function of the doubles', () => {
    const fromDoubles = new Set<unknown>(
      Object.values(doubles).filter((value) => typeof value === 'function')
    )
    const leaked = Object.entries(lane)
      .filter(([, value]) => typeof value === 'function' && fromDoubles.has(value))
      .map(([name]) => name)
    expect(leaked).toEqual([])
  })
})
