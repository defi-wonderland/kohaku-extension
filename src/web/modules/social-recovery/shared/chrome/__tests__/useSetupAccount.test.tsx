/**
 * @jest-environment jsdom
 *
 * The setup tab's account hook, read by small probes over the tab's real
 * session storage. The wallet's selected account is an external store, so a
 * test can change it the way the background's state push does. jsdom has no
 * `TextEncoder`, which viem reads when it loads, so the test sets Node's before
 * it loads the modules.
 */
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TextDecoder, TextEncoder } from 'util'

import type { Location, NavigateFunction } from 'react-router-dom'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import type { SetupAccount } from '@web/modules/social-recovery/shared/chrome'

Object.assign(globalThis, { TextEncoder, TextDecoder })
// React only runs effects and state updates inside act() when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockSelected: {
  state: { account: { addr: string } | null }
  listeners: Set<() => void>
} = { state: { account: null }, listeners: new Set() }

jest.mock('@web/hooks/useSelectedAccountControllerState', () => ({
  __esModule: true,
  default: () =>
    // eslint-disable-next-line global-require
    require('react').useSyncExternalStore(
      (listener: () => void) => {
        mockSelected.listeners.add(listener)
        return () => mockSelected.listeners.delete(listener)
      },
      () => mockSelected.state
    )
}))

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const React: typeof import('react') = require('react')
const { MemoryRouter, useNavigate }: typeof import('react-router-dom') = require('react-router-dom')
const useSetupAccount: typeof import('@web/modules/social-recovery/shared/chrome/useSetupAccount').default =
  require('@web/modules/social-recovery/shared/chrome/useSetupAccount').default
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const OTHER_ACCOUNT: Address = '0x2222222222222222222222222222222222222222'
const THIRD_ACCOUNT: Address = '0x3333333333333333333333333333333333333333'

// Each probe keeps the last value its hook returned, and the account of every render.
const reads: Record<string, SetupAccount> = {}
const rendered: Record<string, (Address | undefined)[]> = {}
const Probe = ({ name }: { name: string }) => {
  reads[name] = useSetupAccount()
  rendered[name] = [...(rendered[name] ?? []), reads[name].account]
  return null
}

// The router's navigate, kept so a test can move the tab the way a link or Back does.
let navigate: NavigateFunction
const Navigator = () => {
  navigate = useNavigate()
  return null
}

let container: HTMLDivElement
let root: Root

const select = (addr: string | null) =>
  act(() => {
    mockSelected.state = { account: addr === null ? null : { addr } }
    mockSelected.listeners.forEach((listener) => listener())
  })

// The probes stand on a setup step reached from another setup step.
const INSIDE_THE_SETUP = {
  pathname: '/social-recovery/setup/editor',
  state: { prevRoute: { pathname: '/social-recovery/setup' } }
}

const open = (...names: string[]) =>
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[INSIDE_THE_SETUP]}>
        {names.map((name) => (
          <Probe key={name} name={name} />
        ))}
      </MemoryRouter>
    )
  })

// A reload of the tab: the page goes and comes back over the same session storage.
const reload = (...names: string[]) => {
  act(() => root.unmount())
  root = createRoot(container)
  open(...names)
}

const switchToSelected = (name: string) =>
  act(() => {
    reads[name].switchToSelected()
  })

beforeEach(() => {
  sessionStorage.clear()
  Object.keys(reads).forEach((name) => delete reads[name])
  Object.keys(rendered).forEach((name) => delete rendered[name])
  mockSelected.state = { account: null }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  jest.restoreAllMocks()
})

describe("the setup tab's account", () => {
  it('works on the selected account when the tab opens, with no difference', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(false)
    expect(reads.screen.selected).toBeUndefined()
  })

  it('has no account while the wallet selects none', () => {
    open('screen')
    expect(reads.screen.account).toBeUndefined()
    expect(reads.screen.differs).toBe(false)
  })

  it('keeps the first account when the wallet selects another, and reports the other one', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    select(OTHER_ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(true)
    expect(reads.screen.selected).toBe(OTHER_ACCOUNT)
    select(THIRD_ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.selected).toBe(THIRD_ACCOUNT)
  })

  it('reports no difference once the wallet selects the first account again', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    select(OTHER_ACCOUNT)
    select(ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(false)
    expect(reads.screen.selected).toBeUndefined()
  })

  it('keeps the first account while the wallet selects none', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    select(null)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(false)
  })

  it('takes the account the wallet selects when the tab opened with none selected', () => {
    open('screen')
    select(ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    select(OTHER_ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(true)
  })

  it('keeps the first account across a reload of the tab', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    select(OTHER_ACCOUNT)
    reload('screen')
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(true)
    expect(reads.screen.selected).toBe(OTHER_ACCOUNT)
  })

  it('switches to the selected account, keeps it from then on, and reports no difference', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    select(OTHER_ACCOUNT)
    switchToSelected('screen')
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.differs).toBe(false)
    expect(reads.screen.selected).toBeUndefined()
    select(ACCOUNT)
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.differs).toBe(true)
    reload('screen')
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
  })

  it('switches every reader in the tab at once', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('chrome', 'screen')
    select(OTHER_ACCOUNT)
    expect(reads.chrome.account).toBe(ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    switchToSelected('chrome')
    expect(reads.chrome.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.differs).toBe(false)
  })

  it('ignores a stored account that is not an address and takes the selected one', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    // Whatever entry the tab keeps its account under now holds something else.
    const keys = Object.keys(sessionStorage).filter(
      (key) => sessionStorage.getItem(key) === ACCOUNT
    )
    expect(keys).toHaveLength(1)
    sessionStorage.setItem(keys[0], 'not-an-address')
    act(() => root.unmount())
    root = createRoot(container)
    mockSelected.state = { account: { addr: OTHER_ACCOUNT } }
    open('screen')
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.differs).toBe(false)
    // The selected account is kept from then on.
    select(THIRD_ACCOUNT)
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
  })

  it('ignores a selected account that is not an address', () => {
    mockSelected.state = { account: { addr: 'not-an-address' } }
    open('screen')
    expect(reads.screen.account).toBeUndefined()
    expect(reads.screen.differs).toBe(false)
    select(ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
  })

  it('follows the selected account when the session storage throws on every call', () => {
    const refuse = () => {
      throw new Error('storage refused')
    }
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse)
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(false)
    select(OTHER_ACCOUNT)
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.differs).toBe(false)
    switchToSelected('screen')
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
  })

  it('follows the selected account when the tab has no session storage to reach', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('storage blocked')
      }
    })
    try {
      mockSelected.state = { account: { addr: ACCOUNT } }
      open('screen')
      expect(reads.screen.account).toBe(ACCOUNT)
      select(OTHER_ACCOUNT)
      expect(reads.screen.account).toBe(OTHER_ACCOUNT)
      expect(reads.screen.differs).toBe(false)
    } finally {
      if (original) {
        Object.defineProperty(window, 'sessionStorage', original)
      }
    }
  })
})

// A history entry the router starts on, with its own key and route state.
const entry = (key: string, state?: unknown): Partial<Location> => ({
  pathname: '/social-recovery/setup',
  key,
  state
})

// The page comes up on the given history entry; every mount builds a new router,
// so no location carries over from an earlier mount.
const mountOn = (at: Partial<Location>, ...names: string[]) => {
  act(() => root.unmount())
  root = createRoot(container)
  Object.keys(rendered).forEach((name) => delete rendered[name])
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Navigator />
        {names.map((name) => (
          <Probe key={name} name={name} />
        ))}
      </MemoryRouter>
    )
  })
}

const go = (to: string | number, state?: unknown) =>
  act(() => {
    if (typeof to === 'number') {
      navigate(to)
    } else {
      navigate(to, { state })
    }
  })

const FROM_THE_DASHBOARD = { prevRoute: { pathname: '/dashboard' } }

describe('a visit of the setup', () => {
  // An earlier visit latched the first account; the wallet now selects the other one.
  const afterAnEarlierVisit = () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    open('screen')
    expect(reads.screen.account).toBe(ACCOUNT)
    mockSelected.state = { account: { addr: OTHER_ACCOUNT } }
  }

  it.each([
    ['no route state', undefined],
    ['a route state with no previous route', {}],
    ['a previous route that is not a string', { prevRoute: { pathname: 7 } }],
    ['the dashboard as the previous route', FROM_THE_DASHBOARD],
    [
      'another recovery route as the previous route',
      { prevRoute: { pathname: '/social-recovery/manage' } }
    ],
    [
      'a route that only starts like the setup',
      { prevRoute: { pathname: '/social-recovery/setupx' } }
    ]
  ])(
    'starts on the selected account after an arrival with %s, over an earlier latch',
    (_, state) => {
      afterAnEarlierVisit()
      mountOn(entry('arrival', state), 'screen')
      expect(rendered.screen).not.toContain(ACCOUNT)
      expect(reads.screen.account).toBe(OTHER_ACCOUNT)
      expect(reads.screen.differs).toBe(false)
      // The new visit keeps its account from then on.
      select(THIRD_ACCOUNT)
      expect(reads.screen.account).toBe(OTHER_ACCOUNT)
      expect(reads.screen.differs).toBe(true)
      expect(reads.screen.selected).toBe(THIRD_ACCOUNT)
    }
  )

  it('keeps the earlier latch when the page comes up inside the setup', () => {
    afterAnEarlierVisit()
    mountOn(entry('inside', { prevRoute: { pathname: '/social-recovery/setup/editor' } }), 'screen')
    expect(rendered.screen).not.toContain(OTHER_ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(true)
  })

  it('keeps the account across the navigation inside the setup while the wallet selects another', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    mountOn(entry('arrival', FROM_THE_DASHBOARD), 'screen')
    select(OTHER_ACCOUNT)
    go('/social-recovery/setup/editor', { prevRoute: { pathname: '/social-recovery/setup' } })
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(true)
    go('/social-recovery/setup/enroll', {
      prevRoute: { pathname: '/social-recovery/setup/editor' }
    })
    expect(rendered.screen).not.toContain(OTHER_ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.selected).toBe(OTHER_ACCOUNT)
  })

  it.each([
    ['a previous route outside the setup', FROM_THE_DASHBOARD],
    ['no route state', undefined]
  ])('keeps the account across a reload of the arrival entry with %s', (_, state) => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    mountOn(entry('arrival', state), 'screen')
    select(OTHER_ACCOUNT)
    mountOn(entry('arrival', state), 'screen')
    expect(rendered.screen).not.toContain(OTHER_ACCOUNT)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(true)
    // A second reload decides the same way.
    mountOn(entry('arrival', state), 'screen')
    expect(reads.screen.account).toBe(ACCOUNT)
  })

  it('keeps the switched account across a reload of the arrival entry', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    mountOn(entry('arrival', FROM_THE_DASHBOARD), 'screen')
    select(OTHER_ACCOUNT)
    switchToSelected('screen')
    select(ACCOUNT)
    mountOn(entry('arrival', FROM_THE_DASHBOARD), 'screen')
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.differs).toBe(true)
  })

  it('starts a new visit when a later arrival has another entry key', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    mountOn(entry('arrival', FROM_THE_DASHBOARD), 'screen')
    select(OTHER_ACCOUNT)
    mountOn(entry('later-arrival', FROM_THE_DASHBOARD), 'screen')
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.differs).toBe(false)
  })

  it('keeps the account when Back returns from a setup step to the arrival entry', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    mountOn(entry('arrival', FROM_THE_DASHBOARD), 'screen')
    select(OTHER_ACCOUNT)
    go('/social-recovery/setup/editor', { prevRoute: { pathname: '/social-recovery/setup' } })
    expect(reads.screen.account).toBe(ACCOUNT)
    go(-1)
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(true)
  })

  it('keeps the account when a passkey ceremony in the same tab returns to the enroll step', () => {
    mockSelected.state = { account: { addr: ACCOUNT } }
    mountOn(entry('arrival', FROM_THE_DASHBOARD), 'screen')
    select(OTHER_ACCOUNT)
    go('/social-recovery/setup/enroll', { prevRoute: { pathname: '/social-recovery/setup' } })
    // The enroll step opens the ceremony with a push from the step.
    go('/social-recovery/ceremony', {
      prevRoute: { pathname: '/social-recovery/setup/enroll' }
    })
    // The ceremony replaces its own entry with the step's route and no route state.
    act(() => {
      navigate('/social-recovery/setup/enroll', { replace: true })
    })
    expect(reads.screen.account).toBe(ACCOUNT)
    expect(reads.screen.differs).toBe(true)
  })

  it('gives the chrome and the screen the same account on every render of one arrival', () => {
    afterAnEarlierVisit()
    mountOn(entry('arrival', FROM_THE_DASHBOARD), 'chrome', 'screen')
    expect(rendered.chrome.length).toBeGreaterThan(0)
    expect(rendered.chrome).toEqual(rendered.screen)
    expect(rendered.screen.every((account) => account === OTHER_ACCOUNT)).toBe(true)
    select(THIRD_ACCOUNT)
    expect(reads.chrome.account).toBe(OTHER_ACCOUNT)
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.chrome.differs).toBe(true)
    expect(reads.screen.differs).toBe(true)
  })

  it("gives a reader that mounts later on the same arrival the visit's account", () => {
    afterAnEarlierVisit()
    mountOn(entry('arrival', FROM_THE_DASHBOARD), 'chrome')
    select(THIRD_ACCOUNT)
    // The same router stays mounted, so the location does not change.
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[entry('arrival', FROM_THE_DASHBOARD)]}>
          <Navigator />
          <Probe name="chrome" />
          <Probe name="screen" />
        </MemoryRouter>
      )
    })
    expect(rendered.screen).not.toContain(THIRD_ACCOUNT)
    expect(reads.screen.account).toBe(OTHER_ACCOUNT)
    expect(reads.chrome.account).toBe(OTHER_ACCOUNT)
  })
})
