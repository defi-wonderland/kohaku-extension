/**
 * @jest-environment jsdom
 *
 * The save's route mounted whole: the settings chrome, the real records over
 * an in-memory `browser.storage.local`, the real recovery password holder, the
 * review's own reads and gate, and the save's real steps. The account's facts,
 * the recovery client and the send port are the three seams the test hands
 * in: the facts are the library's own smart account, the client a fake whose
 * reads and writes answer as each test sets them, and the port a recording
 * fake. A reload is a fresh mount with the password holder emptied, as a new
 * tab starts it.
 */
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TextDecoder, TextEncoder } from 'util'

import type { ThemeContextReturnType } from '@common/contexts/themeContext'
import type { ThemeProps } from '@common/styles/themeConfig'
import type {
  Clause,
  SetupConfirmation,
  SetupDraft,
  SetupState
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  FitCheckReading,
  RemovedKeyReading,
  SendPort
} from '@web/modules/social-recovery/shared/client'

Object.assign(globalThis, { TextEncoder, TextDecoder })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockSelected: { current: { addr: string; preferences: { label: string } } | null } = {
  current: null
}
const mockFacts: { current: unknown } = { current: { status: 'loading' } }
const mockClient: { current: unknown } = { current: { status: 'loading' } }
const mockPort: { current: SendPort | null } = { current: null }

jest.mock('@web/hooks/useSelectedAccountControllerState', () => ({
  __esModule: true,
  default: () => ({ account: mockSelected.current })
}))
jest.mock('@web/hooks/useKeystoreControllerState', () => ({
  __esModule: true,
  default: () => ({
    hasPasswordSecret: true,
    statuses: { unlockWithSecret: 'INITIAL' },
    errorMessage: ''
  })
}))
jest.mock('@web/hooks/useAccountsControllerState', () => ({
  __esModule: true,
  default: () => ({ accounts: [] })
}))
jest.mock('@web/modules/social-recovery/shared/client/useAccountFacts', () => ({
  useAccountFacts: () => mockFacts.current
}))
jest.mock('@web/modules/social-recovery/shared/client/useRecoveryClient', () => ({
  useRecoveryClient: () => mockClient.current
}))
jest.mock('@web/modules/social-recovery/shared/client', () => ({
  ...jest.requireActual('@web/modules/social-recovery/shared/client'),
  createSendPort: () => mockPort.current
}))
const mockEntries = new Map<string, unknown>()
jest.mock('@web/constants/browserapi', () => ({
  ...jest.requireActual('@web/constants/browserapi'),
  browser: {
    storage: {
      local: {
        get: async () => Object.fromEntries(mockEntries),
        set: async (items: Record<string, unknown>) => {
          Object.entries(items).forEach(([key, value]) => mockEntries.set(key, value))
        },
        remove: async (keys: string[]) => {
          keys.forEach((key) => mockEntries.delete(key))
        }
      }
    }
  }
}))
// Jest's config transforms neither images nor these packages' ES modules.
jest.mock('@web/assets/kohaku-horizontal.png', () => 'kohaku-horizontal.png')
jest.mock('react-native-keyboard-aware-scroll-view', () => ({
  KeyboardAwareScrollView: jest.requireActual('react-native').ScrollView
}))
jest.mock('@common/utils/clipboard', () => ({ setStringAsync: async () => true }))
// The spinner's animation needs a native module jsdom lacks.
jest.mock('@common/components/Spinner', () => ({ __esModule: true, default: () => null }))
// Jest resolves no `.web` platform file, so the navigation takes the web build's.
jest.mock('@common/hooks/useNavigation', () =>
  jest.requireActual('@common/hooks/useNavigation/useNavigation.web')
)

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const React: typeof import('react') = require('react')
const { MemoryRouter, useLocation }: typeof import('react-router-dom') = require('react-router-dom')
const {
  WEB_ROUTES
}: typeof import('@common/modules/router/constants/common') = require('@common/modules/router/constants/common')
const { t }: { t: (key: string, options?: object) => string } =
  require('@common/config/localization').default
const {
  ThemeContext
}: typeof import('@common/contexts/themeContext') = require('@common/contexts/themeContext')
const themeConfig: typeof import('@common/styles/themeConfig') = require('@common/styles/themeConfig')
const {
  BackgroundServiceContext
}: typeof import('@web/contexts/backgroundServiceContext') = require('@web/contexts/backgroundServiceContext')
const {
  emptySlot,
  readRecoveryPassword,
  setRecoveryPassword,
  wipeRecoveryPassword
}: typeof import('@web/modules/social-recovery/shared/records') = require('@web/modules/social-recovery/shared/records')
const ArmScreen: typeof import('../ArmScreen').default = require('../ArmScreen').default
const harness: typeof import('./harness') = require('./harness')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const {
  CHAIN_ID,
  chainReadsFor,
  confirmation,
  DESCRIPTOR,
  descriptionOf,
  draftOf,
  factsOf,
  PASSWORD,
  preparedOf,
  receiptsFor,
  REMOVED_KEY,
  sendPortFor,
  setupStateOf,
  smartAccount
} = harness

const THEME = Object.fromEntries(
  Object.entries(themeConfig.default).map(([name, byType]) => [
    name,
    byType[themeConfig.THEME_TYPES.LIGHT]
  ])
) as ThemeProps

const THEME_CONTEXT: ThemeContextReturnType = {
  theme: THEME,
  themeType: themeConfig.THEME_TYPES.LIGHT,
  selectedThemeType: themeConfig.THEME_TYPES.LIGHT,
  setThemeType: () => {}
}

// The background the route sends its requests through; the send port the test hands in replaces them.
const BACKGROUND = { dispatch: jest.fn(), windowId: undefined } as never

const location = { pathname: '', search: '' }
const LocationProbe = () => {
  const { pathname, search } = useLocation()
  location.pathname = pathname
  location.search = search
  return null
}

const DECLARATION = {
  answered: true as const,
  value: {
    admin: '0x0000000000000000000000000000000000000000' as const,
    pendingAdmin: '0x0000000000000000000000000000000000000000' as const,
    trustedKeys: [],
    pauseHolder: '0x0000000000000000000000000000000000000000' as const,
    pendingPauseHolder: '0x0000000000000000000000000000000000000000' as const
  }
}

/** How the chain and the client answer in one test. */
interface Chain {
  removedKey: RemovedKeyReading
  fitCheck: FitCheckReading
  setupState: SetupState
  paused: { answered: true; value: boolean } | { answered: false }
  confirm: SetupConfirmation | Error
  send: 'sent' | 'refused'
}

const CHAIN: Chain = {
  removedKey: { kind: 'named', key: REMOVED_KEY },
  fitCheck: { basis: 'deployed-code', fits: true },
  setupState: setupStateOf(false),
  paused: { answered: true, value: false },
  confirm: confirmation(true, true),
  send: 'sent'
}

let container: HTMLDivElement
let root: Root
let address: `0x${string}`
let chain: Chain
let port: ReturnType<typeof sendPortFor>
let prepareCommitSetup: jest.Mock
let confirmSetup: jest.Mock

const settle = () =>
  act(async () => {
    for (let round = 0; round < 6; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    }
  })

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const pageText = () => container.textContent ?? ''
const press = async (id: string) => {
  const node = byTestId(id)
  if (!node) throw new Error(`nothing to press: ${id}`)
  await act(async () => {
    node.click()
  })
  await settle()
}

const writeRecords = async (draft: SetupDraft, passwordSet = true) => {
  const { createWalletRecords, extensionRecordStorage } = jest.requireActual<
    typeof import('@web/modules/social-recovery/shared/records')
  >('@web/modules/social-recovery/shared/records')
  const setup = createWalletRecords({ storage: extensionRecordStorage }).setup(CHAIN_ID, address)
  await setup.setupDraft.write(draft)
  await setup.enrollments.write([])
  if (passwordSet) await setup.passwordSet.write('password-set')
}

const wireClient = (facts: 'ready' | 'loading' | 'view-only' | 'state-unread', deployed = true) =>
  smartAccount().then((account) => {
    port = sendPortFor(chain.send === 'sent' ? 'sent' : 'refused', address)
    mockPort.current = port
    prepareCommitSetup = jest.fn(async () => preparedOf(address, false))
    confirmSetup = jest.fn(async () => {
      if (chain.confirm instanceof Error) throw chain.confirm
      return chain.confirm
    })
    const kit = {
      chain: 'sepolia',
      descriptor: DESCRIPTOR,
      moduleReads: {
        trustedParties: async () => DECLARATION,
        moduleInfo: async () => ({
          answered: true,
          value: { name: 'method', version: '1.0.0', supportsInterface: true }
        }),
        paused: async () => chain.paused
      },
      setup: {
        setupState: async () => chain.setupState,
        describeSetup: async () => descriptionOf(),
        prepareCommitSetup,
        confirmSetup
      },
      walletReads: {
        removedKey: async () => chain.removedKey,
        fitCheck: async () => chain.fitCheck
      }
    }
    mockClient.current = {
      status: 'ready',
      client: kit,
      reads: chainReadsFor('enough'),
      receipts: receiptsFor('landed'),
      retry: jest.fn()
    }
    const retry = jest.fn()
    mockFacts.current =
      facts === 'ready'
        ? { status: 'ready', facts: factsOf(account, { deployed }), retry }
        : facts === 'view-only'
        ? { status: 'ready', facts: factsOf(account, { key: null }), retry }
        : facts === 'state-unread'
        ? { status: 'unavailable', cause: 'state-unread', retry }
        : { status: 'loading', retry }
  })

const mount = async () => {
  act(() => root.unmount())
  root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/${WEB_ROUTES.socialRecoverySetupSave}`]}>
        <ThemeContext.Provider value={THEME_CONTEXT}>
          <BackgroundServiceContext.Provider value={BACKGROUND}>
            <ArmScreen />
            <LocationProbe />
          </BackgroundServiceContext.Provider>
        </ThemeContext.Provider>
      </MemoryRouter>
    )
  })
  await settle()
}

/** A new tab: the password held in memory is gone, and the screen mounts afresh. */
const reload = async () => {
  wipeRecoveryPassword(CHAIN_ID, address)
  await mount()
}

beforeAll(async () => {
  address = (await smartAccount()).addr as `0x${string}`
})

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockEntries.clear()
  chain = { ...CHAIN }
  mockSelected.current = { addr: address, preferences: { label: 'Account 1' } }
  setRecoveryPassword(CHAIN_ID, address, PASSWORD)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  wipeRecoveryPassword(CHAIN_ID, address)
})

describe('the save route', () => {
  it('starts the save once on a ready arrival, and after the agreed check wipes the records and shows the saved screen', async () => {
    await writeRecords(draftOf('encrypted'))
    await wireClient('ready')
    await mount()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(byTestId('arm-saved')).not.toBeNull()
    expect(pageText()).toContain(t('socialRecovery.arm.title'))
    expect(mockEntries.size).toBe(0)
    expect(readRecoveryPassword(CHAIN_ID, address)).toBe(PASSWORD)

    await press('arm-saved-continue')
    expect(location.pathname).toBe(`/${WEB_ROUTES.socialRecoverySetupCard}`)
    expect(location.search).toBe('?level=hidden')
  })

  it('does not start a second save when the route renders again after the save ended', async () => {
    chain.send = 'refused'
    await writeRecords(draftOf('encrypted'))
    await wireClient('ready')
    await mount()
    expect(byTestId('arm-write-failedNotSent')).not.toBeNull()

    await act(async () => {
      mockSelected.current = { addr: address, preferences: { label: 'Renamed' } }
      root.render(
        <MemoryRouter initialEntries={[`/${WEB_ROUTES.socialRecoverySetupSave}`]}>
          <ThemeContext.Provider value={THEME_CONTEXT}>
            <BackgroundServiceContext.Provider value={BACKGROUND}>
              <ArmScreen />
            </BackgroundServiceContext.Provider>
          </ThemeContext.Provider>
        </MemoryRouter>
      )
    })
    await settle()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(mockEntries.size).toBeGreaterThan(0)
  })

  const BLOCKED: [string, string, (draft: { clauses: Clause[] }) => void][] = [
    [
      'a trust read that did not answer',
      'unavailable',
      () => {
        chain.paused = { answered: false }
      }
    ],
    [
      'a removed key the wallet cannot read',
      'removed-key-unreadable',
      () => {
        chain.removedKey = { kind: 'unavailable', cause: 'no-creation-record' }
      }
    ],
    [
      'an action that does not fit the account',
      'cannot-recover',
      () => {
        chain.fitCheck = { basis: 'deployed-code', fits: false }
      }
    ],
    [
      'an account that already has a setup',
      'already-set-up',
      () => {
        chain.setupState = setupStateOf(true)
      }
    ],
    [
      'a path with an empty slot',
      'empty-slot',
      (draft) => {
        // eslint-disable-next-line no-param-reassign
        draft.clauses = [{ threshold: 1, credentials: [emptySlot('passkey')] }]
      }
    ]
  ]

  BLOCKED.forEach(([named, kind, arrange]) =>
    it(`blocks on ${named} with the review blocker, and prepares and sends nothing`, async () => {
      const draft = draftOf('encrypted')
      arrange(draft)
      await writeRecords(draft)
      await wireClient('ready')
      await mount()

      expect(byTestId(`review-blocked-${kind}`)).not.toBeNull()
      expect(prepareCommitSetup).not.toHaveBeenCalled()
      expect(port.sendAccountBatch).not.toHaveBeenCalled()
    })
  )

  it('sends an encrypted save with no password in memory back to the privacy step, writing nothing', async () => {
    await writeRecords(draftOf('encrypted'))
    await wireClient('ready')
    wipeRecoveryPassword(CHAIN_ID, address)
    const before = JSON.stringify([...mockEntries])
    await mount()

    expect(byTestId('review-blocked-password-missing')).not.toBeNull()
    expect(prepareCommitSetup).not.toHaveBeenCalled()
    expect(port.sendAccountBatch).not.toHaveBeenCalled()
    expect(JSON.stringify([...mockEntries])).toBe(before)
    await press('review-blocked-privacy')
    expect(location.pathname).toBe(`/${WEB_ROUTES.socialRecoverySetupPrivacy}`)
  })
  ;(['loading', 'view-only', 'state-unread'] as const).forEach((facts) =>
    it(`prepares and sends nothing while the account facts read ${facts}`, async () => {
      await writeRecords(draftOf('encrypted'))
      await wireClient(facts)
      await mount()

      expect(prepareCommitSetup).not.toHaveBeenCalled()
      expect(port.sendAccountBatch).not.toHaveBeenCalled()
      expect(byTestId('arm-saved')).toBeNull()
    })
  )

  it('names the deployment in the cost line for an account with no code', async () => {
    chain.send = 'refused'
    await writeRecords(draftOf('encrypted'))
    await wireClient('ready', false)
    await mount()
    expect(byTestId('arm-cost-line')?.textContent).toBe(t('socialRecovery.costLines.saveDeploys'))
  })
})

describe('a reload of the save route after it ended', () => {
  it('after a saved setup: sends nothing again and shows no saved screen', async () => {
    await writeRecords(draftOf('encrypted'))
    await wireClient('ready')
    await mount()
    expect(byTestId('arm-saved')).not.toBeNull()

    chain.setupState = setupStateOf(true)
    await reload()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(prepareCommitSetup).toHaveBeenCalledTimes(1)
    expect(byTestId('arm-saved')).toBeNull()
    // The records are gone, so the draft reads as the default one, whose recovery password is not set.
    expect(byTestId('review-blocked-password-missing')).not.toBeNull()
  })

  it('after a disagreed check on a committed setup: sends nothing again and shows the second-setup block', async () => {
    chain.confirm = Object.assign(new Error('mismatch'), { code: 'confirm.commitment-mismatch' })
    await writeRecords(draftOf('clear'))
    await wireClient('ready')
    await mount()
    expect(byTestId('arm-disagreed-mismatch')).not.toBeNull()
    expect(mockEntries.size).toBeGreaterThan(0)

    chain.setupState = setupStateOf(true)
    await reload()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(byTestId('review-blocked-already-set-up')).not.toBeNull()
  })

  it('after a save never sent, at an encrypted backup: sends nothing and asks for the password again', async () => {
    chain.send = 'refused'
    await writeRecords(draftOf('encrypted'))
    await wireClient('ready')
    await mount()
    expect(byTestId('arm-write-failedNotSent')).not.toBeNull()

    await reload()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(byTestId('review-blocked-password-missing')).not.toBeNull()
  })

  it('after a save never sent, at a clear backup: opens the sign window again by itself', async () => {
    chain.send = 'refused'
    await writeRecords(draftOf('clear'))
    await wireClient('ready')
    await mount()
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)

    await reload()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(2)
  })
})
