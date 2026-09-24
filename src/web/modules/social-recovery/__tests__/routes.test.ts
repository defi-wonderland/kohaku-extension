/**
 * The social recovery routes of the setup brief, item 3.
 */
import routesConfig from '@common/modules/router/config/routesConfig/routesConfig'
import { WEB_ROUTES } from '@common/modules/router/constants/common'

const EXPECTED_KEYS = [
  'socialRecovery',
  'socialRecoveryCeremony',
  'socialRecoverySetup',
  'socialRecoveryCreate',
  'socialRecoveryRecover',
  'socialRecoveryFastTrack',
  'socialRecoveryRecovery',
  'socialRecoveryApprove',
  'socialRecoveryCancel',
  'socialRecoveryManage'
]

const webRoutes = WEB_ROUTES as Record<string, string>
const config = routesConfig as Record<string, { route: string; title: string; name: string }>

const socialRecoveryKeys = Object.keys(webRoutes).filter((key) => key.startsWith('socialRecovery'))

describe('social recovery routes', () => {
  it('declares the ten keys the brief names', () => {
    expect(socialRecoveryKeys.sort()).toEqual(expect.arrayContaining([...EXPECTED_KEYS].sort()))
    EXPECTED_KEYS.forEach((key) => expect(webRoutes[key]).toEqual(expect.any(String)))
  })

  it.each(socialRecoveryKeys)('%s has a routesConfig entry whose route is its path', (key) => {
    expect(config[key]).toBeDefined()
    expect(config[key].route).toBe(webRoutes[key])
    expect(config[key].title).toEqual(expect.any(String))
    expect(config[key].name).toEqual(expect.any(String))
  })

  it.each(socialRecoveryKeys)('%s path starts with social-recovery', (key) => {
    expect(webRoutes[key].startsWith('social-recovery')).toBe(true)
  })

  it('uses unique paths', () => {
    const paths = socialRecoveryKeys.map((key) => webRoutes[key])
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('shares no path with a route outside the module', () => {
    const others = Object.keys(webRoutes)
      .filter((key) => !key.startsWith('socialRecovery'))
      .map((key) => webRoutes[key])
    const clashes = socialRecoveryKeys.filter((key) => others.includes(webRoutes[key]))
    expect(clashes).toEqual([])
  })
})
