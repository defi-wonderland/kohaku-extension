/**
 * The social recovery routes of the setup brief, item 3
 * (docs/social-recovery/briefs/chore-social-recovery-setup.md).
 *
 * routesConfig is keyed by the route PATH, like every existing entry
 * (`[ROUTES.x]: { route: ROUTES.x, ... }`), so an entry is looked up as
 * config[WEB_ROUTES[key]].
 */
import routesConfig from '@common/modules/router/config/routesConfig/routesConfig'
import { WEB_ROUTES } from '@common/modules/router/constants/common'

// routesConfig imports `Platform` from react-native, whose index.js is Flow
// source that Jest cannot parse under the node environment. The mock keeps
// only `Platform.select`, returning the `default` branch (else `web`), which
// is what the web build reads.
jest.mock('react-native', () => ({
  Platform: {
    OS: 'web',
    select: (spec: Record<string, unknown>) =>
      spec.default !== undefined ? spec.default : spec.web
  }
}))

// UXC-10 (docs/social-recovery/design/ux-copy.md): the feature name.
const FEATURE_NAME = 'Account recovery'

const EXPECTED_ROUTES: Record<string, string> = {
  socialRecovery: 'social-recovery',
  socialRecoveryCeremony: 'social-recovery/ceremony',
  socialRecoverySetup: 'social-recovery/setup',
  socialRecoveryCreate: 'social-recovery/create',
  socialRecoveryRecover: 'social-recovery/recover',
  socialRecoveryFastTrack: 'social-recovery/fast-track',
  socialRecoveryRecovery: 'social-recovery/recovery',
  socialRecoveryApprove: 'social-recovery/approve',
  socialRecoveryCancel: 'social-recovery/cancel',
  socialRecoveryManage: 'social-recovery/manage'
}

type Entry = { route: string; title: string; name: string; withTitlePrefix?: boolean }

const webRoutes = WEB_ROUTES as unknown as Record<string, string>
const config = routesConfig as unknown as Record<string, Entry>

const socialRecoveryKeys = Object.keys(webRoutes).filter((key) => key.startsWith('socialRecovery'))

describe('social recovery routes', () => {
  it('declares the ten keys the brief names, with the brief paths', () => {
    Object.entries(EXPECTED_ROUTES).forEach(([key, path]) => {
      expect({ key, path: webRoutes[key] }).toEqual({ key, path })
    })
  })

  it.each(socialRecoveryKeys)('%s has a routesConfig entry keyed by its path', (key) => {
    const path = webRoutes[key]
    const entry = config[path]
    expect(entry).toBeDefined()
    expect(entry.route).toBe(path)
    expect(entry.name).toEqual(expect.any(String))
    expect(entry.name.length).toBeGreaterThan(0)
  })

  it.each(socialRecoveryKeys)('%s entry resolves its title to the feature name (UXC-10)', (key) => {
    const entry = config[webRoutes[key]]
    expect(entry).toBeDefined()
    // i18n.t returns the key itself when the key is missing from en.json,
    // so this also proves the title key resolves.
    expect(entry.title).toBe(FEATURE_NAME)
  })

  it.each(socialRecoveryKeys)('%s entry name resolves to a string, not an i18n key', (key) => {
    const entry = config[webRoutes[key]]
    expect(entry).toBeDefined()
    expect(entry.name.startsWith('socialRecovery.')).toBe(false)
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
