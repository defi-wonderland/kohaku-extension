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
const useSetupAccount: typeof import('@web/modules/social-recovery/shared/chrome/useSetupAccount').default =
  require('@web/modules/social-recovery/shared/chrome/useSetupAccount').default
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const OTHER_ACCOUNT: Address = '0x2222222222222222222222222222222222222222'
const THIRD_ACCOUNT: Address = '0x3333333333333333333333333333333333333333'

// Each probe keeps the last value its hook returned.
const reads: Record<string, SetupAccount> = {}
const Probe = ({ name }: { name: string }) => {
  reads[name] = useSetupAccount()
  return null
}

let container: HTMLDivElement
let root: Root

const select = (addr: string | null) =>
  act(() => {
    mockSelected.state = { account: addr === null ? null : { addr } }
    mockSelected.listeners.forEach((listener) => listener())
  })

const open = (...names: string[]) =>
  act(() => {
    root.render(
      <>
        {names.map((name) => (
          <Probe key={name} name={name} />
        ))}
      </>
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
