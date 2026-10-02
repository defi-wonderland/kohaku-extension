/**
 * @jest-environment jsdom
 *
 * The save's route mounted whole: the settings chrome, the real records over
 * an in-memory `browser.storage.local`, the real recovery password holder, the
 * review's own reads and gate, and the save's real steps. The account's facts,
 * the recovery client and the send port are the three seams the test hands
 * in: the facts are the library's own smart account, the client a fake whose
 * reads and writes answer as each test sets them, and the port a recording
 * fake.
 *
 * The route is reached the ways the wallet reaches it: by the review's push,
 * or by a reload, a typed address, back or forward, which the router reads as
 * a pop. A reload is a fresh mount at the route with the password holder
 * emptied, as a new tab starts it. An account switch remounts the step.
 *
 * The screen holds a save in progress outside itself, one per chain and
 * account, for as long as the screen is away from it. So each test runs on an
 * account of its own, and no test meets a save another test left behind.
 */
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TextDecoder, TextEncoder } from 'util'

import type { Account } from '@ambire-common/interfaces/account'
import type { ThemeContextReturnType } from '@common/contexts/themeContext'
import type { ThemeProps } from '@common/styles/themeConfig'
import type {
  Clause,
  SetupConfirmation,
  SetupDraft,
  SetupState
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  FeeReading,
  FitCheckReading,
  KeyHandle,
  RemovedKeyReading,
  SendPort
} from '@web/modules/social-recovery/shared/client'

Object.assign(globalThis, { TextEncoder, TextDecoder })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockSelected: {
  current: { addr: string; preferences: { label: string } } | null
  listeners: Set<() => void>
} = { current: null, listeners: new Set() }
const mockFacts = new Map<string, unknown>()
const mockClient: { current: unknown } = { current: { status: 'loading' } }
const mockPort: { current: SendPort | null } = { current: null }

jest.mock('@web/hooks/useSelectedAccountControllerState', () => ({
  __esModule: true,
  default: () => {
    const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react')
    const account = useSyncExternalStore(
      (listener: () => void) => {
        mockSelected.listeners.add(listener)
        return () => {
          mockSelected.listeners.delete(listener)
        }
      },
      () => mockSelected.current
    )
    return { account }
  }
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
  useAccountFacts: (account: string | undefined) =>
    mockFacts.get(account?.toLowerCase() ?? '') ?? mockFacts.get('loading')
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
const {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType
}: typeof import('react-router-dom') = require('react-router-dom')
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
  feeReading,
  keyedAccount,
  landedReceipt,
  nodeError,
  PASSWORD,
  preparedOf,
  receiptsFor,
  REMOVED_KEY,
  sendPortFor,
  setupStateOf
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

const REVIEW_PATH = `/${WEB_ROUTES.socialRecoverySetupReview}`
const SAVE_PATH = `/${WEB_ROUTES.socialRecoverySetupSave}`
const CARD_PATH = `/${WEB_ROUTES.socialRecoverySetupCard}`

/** Where the router stands, and its navigation, as the probe last read them. */
const router: {
  pathname: string
  search: string
  type: string
  navigate: ((to: string | number) => void) | null
} = { pathname: '', search: '', type: '', navigate: null }

const RouterProbe = () => {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  router.pathname = pathname
  router.search = search
  router.type = useNavigationType()
  router.navigate = (to) => {
    if (typeof to === 'number') {
      navigate(to)
    } else {
      navigate(to)
    }
  }
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
  send: 'sent' | 'refused' | 'not-a-transaction'
  estimation?: FeeReading
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
let seed = 0x51a7e
let account: Account
let key: KeyHandle
let address: `0x${string}`
let other: Account
let otherKey: KeyHandle
let chain: Chain
let port: ReturnType<typeof sendPortFor>
let prepareCommitSetup: jest.Mock
let confirmSetup: jest.Mock
let setupState: jest.Mock
let reads: ReturnType<typeof chainReadsFor>
let receipts: ReturnType<typeof receiptsFor>

const settle = () =>
  act(async () => {
    for (let round = 0; round < 8; round += 1) {
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
  if (!node) {
    throw new Error(`nothing to press: ${id}`)
  }
  await act(async () => {
    node.click()
  })
  await settle()
}

/** A promise the test settles by hand, for an edge that must hold a run at one step. */
const held = <T,>() => {
  let release: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const writeRecords = async (draft: SetupDraft, passwordSet = true, owner: string = address) => {
  const { createWalletRecords, extensionRecordStorage } = jest.requireActual<
    typeof import('@web/modules/social-recovery/shared/records')
  >('@web/modules/social-recovery/shared/records')
  const setup = createWalletRecords({ storage: extensionRecordStorage }).setup(
    CHAIN_ID,
    owner as `0x${string}`
  )
  await setup.setupDraft.write(draft)
  await setup.enrollments.write([])
  if (passwordSet) {
    await setup.passwordSet.write('password-set')
  }
}

const wireClient = (facts: 'ready' | 'loading' | 'view-only' | 'state-unread', deployed = true) => {
  port = sendPortFor(chain.send === 'sent' ? 'sent' : chain.send, address, chain.estimation)
  mockPort.current = port
  prepareCommitSetup = jest.fn(async () => preparedOf(address, false))
  confirmSetup = jest.fn(async () => {
    if (chain.confirm instanceof Error) {
      throw chain.confirm
    }
    return chain.confirm
  })
  setupState = jest.fn(async () => chain.setupState)
  reads = chainReadsFor('enough')
  receipts = receiptsFor('landed')
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
      setupState,
      describeSetup: async () => descriptionOf(),
      prepareCommitSetup,
      confirmSetup
    },
    walletReads: {
      removedKey: async () => chain.removedKey,
      fitCheck: async () => chain.fitCheck
    }
  }
  mockClient.current = { status: 'ready', client: kit, reads, receipts, retry: jest.fn() }
  const retry = jest.fn()
  mockFacts.set(
    address.toLowerCase(),
    facts === 'ready'
      ? { status: 'ready', facts: factsOf(account, { deployed, key }), retry }
      : facts === 'view-only'
      ? { status: 'ready', facts: factsOf(account, { key: null }), retry }
      : facts === 'state-unread'
      ? { status: 'unavailable', cause: 'state-unread', retry }
      : { status: 'loading', retry }
  )
  mockFacts.set(other.addr.toLowerCase(), {
    status: 'ready',
    facts: factsOf(other, { key: otherKey }),
    retry
  })
}

const select = (owner: string, label = 'Account 1') =>
  act(() => {
    mockSelected.current = { addr: owner, preferences: { label } }
    mockSelected.listeners.forEach((listener) => listener())
  })

const tree = (entries: string[], index: number) => (
  <MemoryRouter initialEntries={entries} initialIndex={index}>
    <ThemeContext.Provider value={THEME_CONTEXT}>
      <BackgroundServiceContext.Provider value={BACKGROUND}>
        <Routes>
          <Route path={SAVE_PATH} element={<ArmScreen />} />
          <Route path="*" element={null} />
        </Routes>
        <RouterProbe />
      </BackgroundServiceContext.Provider>
    </ThemeContext.Provider>
  </MemoryRouter>
)

const mountAt = async (entries: string[], index = entries.length - 1) => {
  act(() => root.unmount())
  root = createRoot(container)
  await act(async () => {
    root.render(tree(entries, index))
  })
  await settle()
}

const go = async (to: string | number) => {
  await act(async () => {
    router.navigate?.(to)
  })
  await settle()
}

/** The review's Save: an in-app push to the route. */
const openByPush = async () => {
  await mountAt([REVIEW_PATH])
  await go(SAVE_PATH)
}

/** The route's address typed into a tab that still holds the recovery password. */
const openByAddress = () => mountAt([SAVE_PATH])

/** A new tab: the password held in memory is gone, and the screen mounts afresh at the route. */
const reload = async () => {
  wipeRecoveryPassword(CHAIN_ID, address)
  await mountAt([SAVE_PATH])
}

/** Away to another account and back, which remounts the step at the same entry. */
const switchAway = async () => {
  await select(other.addr)
  await settle()
  await select(address)
  await settle()
}

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockEntries.clear()
  mockFacts.clear()
  mockFacts.set('loading', { status: 'loading', retry: jest.fn() })
  chain = { ...CHAIN }
  seed += 2
  ;({ account, key } = await keyedAccount(seed))
  ;({ account: other, key: otherKey } = await keyedAccount(seed + 1))
  address = account.addr as `0x${string}`
  mockSelected.current = { addr: address, preferences: { label: 'Account 1' } }
  setRecoveryPassword(CHAIN_ID, address, PASSWORD)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  wipeRecoveryPassword(CHAIN_ID, address)
  wipeRecoveryPassword(CHAIN_ID, other.addr as `0x${string}`)
})

describe('the start of the save', () => {
  it('starts once where the review pushed the route, replaces the push, and after the agreed check wipes the records and shows the saved screen', async () => {
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    await openByPush()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(port.sendAccountBatch.mock.calls[0][0]).toBe(address)
    expect(router.pathname).toBe(SAVE_PATH)
    expect(router.type).toBe('REPLACE')
    expect(byTestId('arm-saved')).not.toBeNull()
    expect(pageText()).toContain(t('socialRecovery.arm.title'))
    expect(mockEntries.size).toBe(0)
    expect(readRecoveryPassword(CHAIN_ID, address)).toBe(PASSWORD)

    await press('arm-saved-continue')
    expect(router.pathname).toBe(CARD_PATH)
    expect(router.search).toBe('?level=hidden')
  })

  it('does not start a second save when the route renders again after the save ended', async () => {
    chain.send = 'refused'
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    await openByPush()
    expect(byTestId('arm-write-failedNotSent')).not.toBeNull()

    await select(address, 'Renamed')
    await settle()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(byTestId('arm-write-failedNotSent')).not.toBeNull()
    expect(mockEntries.size).toBeGreaterThan(0)
  })

  it('does not start again on a remount at the entry the push started, and shows the Save button instead', async () => {
    chain.send = 'refused'
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    await openByPush()
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)

    await switchAway()

    expect(router.type).toBe('REPLACE')
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(byTestId('arm-write-failedNotSent')).toBeNull()
    expect(byTestId('arm-save')).not.toBeNull()
  })

  const POPS: [string, SetupDraft['privacy']['backup'], () => Promise<void>][] = [
    ['a reload', 'clear', reload],
    ['a typed address', 'encrypted', openByAddress],
    [
      'forward',
      'encrypted',
      async () => {
        await mountAt([REVIEW_PATH, SAVE_PATH], 0)
        await go(1)
      }
    ],
    [
      'back',
      'encrypted',
      async () => {
        await mountAt([SAVE_PATH, CARD_PATH], 1)
        await go(-1)
      }
    ]
  ]

  POPS.forEach(([named, backup, open]) =>
    it(`shows the summary with the Save button after ${named}, sends nothing by itself, and the button starts the save once`, async () => {
      await writeRecords(draftOf(backup))
      wireClient('ready')
      await open()

      expect(router.pathname).toBe(SAVE_PATH)
      expect(router.type).toBe('POP')
      expect(byTestId('arm-save')?.textContent).toBe(t('socialRecovery.review.save'))
      expect(byTestId('arm-removed-key')).not.toBeNull()
      expect(byTestId('arm-cost-line')).not.toBeNull()
      expect(prepareCommitSetup).not.toHaveBeenCalled()
      expect(port.sendAccountBatch).not.toHaveBeenCalled()

      await press('arm-save')

      expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
      expect(byTestId('arm-saved')).not.toBeNull()
      expect(byTestId('arm-save')).toBeNull()
    })
  )

  it('starts once on a double press of the Save button', async () => {
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    await openByAddress()
    const button = byTestId('arm-save')
    expect(button).not.toBeNull()

    await act(async () => {
      button?.click()
      button?.click()
    })
    await settle()

    expect(prepareCommitSetup).toHaveBeenCalledTimes(1)
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
  })

  it('reads the setup when the button starts the save, and ends as already set up where another tab saved meanwhile', async () => {
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    await openByAddress()
    expect(byTestId('arm-save')).not.toBeNull()
    const arrivalReads = setupState.mock.calls.length
    chain.setupState = setupStateOf(true)

    await press('arm-save')

    expect(setupState.mock.calls.length).toBe(arrivalReads + 1)
    expect(byTestId('review-blocked-already-set-up')).not.toBeNull()
    expect(prepareCommitSetup).not.toHaveBeenCalled()
    expect(port.sendAccountBatch).not.toHaveBeenCalled()
    expect(mockEntries.size).toBeGreaterThan(0)
  })

  it('reads the setup on the start the push made, and ends as already set up where one landed after the arrival read', async () => {
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    setupState.mockImplementationOnce(async () => {
      chain.setupState = setupStateOf(true)
      return setupStateOf(false)
    })
    await openByPush()

    expect(byTestId('review-blocked-already-set-up')).not.toBeNull()
    expect(prepareCommitSetup).not.toHaveBeenCalled()
    expect(port.sendAccountBatch).not.toHaveBeenCalled()
  })
})

describe('a save in progress across remounts', () => {
  const LIVE: [string, string, () => () => void][] = [
    [
      'while the gas check runs',
      'arm-write-checkingGas',
      () => {
        const gate = held<bigint>()
        reads.nativeBalance.mockImplementationOnce(() => gate.promise)
        return () => gate.release(10n ** 18n)
      }
    ],
    [
      'while the batch is submitting',
      'arm-write-submitting',
      () => {
        const gate = held<`0x${string}`>()
        port.sendAccountBatch.mockImplementationOnce(() => gate.promise)
        return () => gate.release(harness.TX_HASH)
      }
    ],
    [
      'while the check after the landing runs',
      'arm-confirming',
      () => {
        const gate = held<SetupConfirmation>()
        confirmSetup.mockImplementationOnce(() => gate.promise)
        return () => gate.release(confirmation(true, true))
      }
    ]
  ]

  LIVE.forEach(([named, shown, hold]) =>
    it(`takes up the save ${named} on a remount, sends nothing more, and saves once it ends`, async () => {
      await writeRecords(draftOf('encrypted'))
      wireClient('ready')
      const release = hold()
      await openByPush()
      expect(byTestId(shown)).not.toBeNull()

      await select(other.addr)
      await settle()
      expect(byTestId(shown)).toBeNull()
      await select(address)
      await settle()

      expect(byTestId(shown)).not.toBeNull()
      expect(byTestId('arm-save')).toBeNull()
      expect(prepareCommitSetup).toHaveBeenCalledTimes(1)

      await act(async () => {
        release()
      })
      await settle()

      expect(byTestId('arm-saved')).not.toBeNull()
      expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
      expect(prepareCommitSetup).toHaveBeenCalledTimes(1)
      expect(confirmSetup).toHaveBeenCalledTimes(1)
      expect(mockEntries.size).toBe(0)
    })
  )

  it("keeps another account's save apart: its own button, its own batch, and the first save still held", async () => {
    await writeRecords(draftOf('encrypted'))
    await writeRecords(draftOf('clear'), true, other.addr)
    wireClient('ready')
    const gate = held<`0x${string}`>()
    port.sendAccountBatch.mockImplementationOnce(() => gate.promise)
    await openByPush()
    expect(byTestId('arm-write-submitting')).not.toBeNull()

    await select(other.addr)
    await settle()
    expect(byTestId('arm-write-submitting')).toBeNull()
    expect(byTestId('arm-save')).not.toBeNull()
    await press('arm-save')
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(2)
    expect(port.sendAccountBatch.mock.calls[1][0]).toBe(other.addr)

    await select(address)
    await settle()
    expect(byTestId('arm-write-submitting')).not.toBeNull()
    await act(async () => {
      gate.release(harness.TX_HASH)
    })
    await settle()
    expect(byTestId('arm-saved')).not.toBeNull()
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(2)
  })

  /** How a save ended, what it showed, whether its batch left a setup on the account, and what the next arrival shows. */
  const ENDED: {
    named: string
    arrange: () => void
    ended: string
    setUp: boolean
    arrival: string
  }[] = [
    {
      named: 'saved',
      arrange: () => {},
      ended: 'arm-saved',
      setUp: true,
      arrival: 'review-blocked-already-set-up'
    },
    {
      named: 'already set up',
      arrange: () => {
        setupState.mockImplementationOnce(async () => {
          chain.setupState = setupStateOf(true)
          return setupStateOf(false)
        })
      },
      ended: 'review-blocked-already-set-up',
      setUp: true,
      arrival: 'review-blocked-already-set-up'
    },
    {
      named: 'never sent',
      arrange: () => {
        port.sendAccountBatch.mockRejectedValueOnce(new Error('the window closed'))
      },
      ended: 'arm-write-failedNotSent',
      setUp: false,
      arrival: 'arm-save'
    },
    {
      named: 'short of gas',
      arrange: () => {
        reads.nativeBalance.mockResolvedValueOnce(0n)
      },
      ended: 'arm-gas-blocker',
      setUp: false,
      arrival: 'arm-save'
    },
    {
      named: 'disagreed',
      arrange: () => {
        chain.confirm = confirmation(true, false)
      },
      ended: 'arm-disagreed-authorization',
      setUp: true,
      arrival: 'review-blocked-already-set-up'
    },
    {
      named: 'unanswered',
      arrange: () => {
        chain.confirm = new Error('the node did not answer')
      },
      ended: 'arm-unread',
      setUp: true,
      arrival: 'review-blocked-already-set-up'
    }
  ]

  ENDED.forEach(({ named, arrange, ended, setUp, arrival }) =>
    it(`reads the account again from the start on a remount after a save that ended ${named}`, async () => {
      await writeRecords(draftOf('encrypted'))
      wireClient('ready')
      arrange()
      await openByPush()
      expect(byTestId(ended)).not.toBeNull()
      const sends = port.sendAccountBatch.mock.calls.length
      const setupReads = setupState.mock.calls.length
      chain.setupState = setupStateOf(setUp)

      await switchAway()

      if (ended !== arrival) {
        expect(byTestId(ended)).toBeNull()
      }
      expect(byTestId(arrival)).not.toBeNull()
      expect(setupState.mock.calls.length).toBeGreaterThan(setupReads)
      expect(port.sendAccountBatch).toHaveBeenCalledTimes(sends)
    })
  )
})

describe('a receipt wait that failed after the batch was sent', () => {
  it('shows check again under the submitting state, keeps the records, and saves once checking again finds the receipt', async () => {
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    receipts.wait.mockRejectedValueOnce(nodeError()).mockRejectedValueOnce(nodeError())
    await openByPush()

    expect(byTestId('arm-write-submitting')).not.toBeNull()
    expect(byTestId('arm-check-again')?.textContent).toBe(t('socialRecovery.writes.tryAgain'))
    expect(confirmSetup).not.toHaveBeenCalled()
    expect(mockEntries.size).toBeGreaterThan(0)
    expect(byTestId('arm-saved')).toBeNull()

    receipts.wait.mockImplementation(async (hash: `0x${string}`) => landedReceipt(hash))
    await press('arm-check-again')

    expect(receipts.wait).toHaveBeenCalledTimes(3)
    expect(byTestId('arm-saved')).not.toBeNull()
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(mockEntries.size).toBe(0)
  })
})

describe('a save the wallet did not send', () => {
  it('offers no retry and no not-sent sentence where the port refused it as not a transaction', async () => {
    chain.send = 'not-a-transaction'
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    await openByPush()

    expect(byTestId('arm-write-failedNotSent')).not.toBeNull()
    expect(pageText()).toContain(t('socialRecovery.review.after.failedTitle'))
    expect(pageText()).not.toContain(t('socialRecovery.review.after.notSent'))
    expect(pageText()).not.toContain(t('socialRecovery.writes.tryAgain'))
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
  })

  it("leads to the deposit blocker where the sign screen's estimation read the key short, and Continue sends once the key holds enough", async () => {
    chain.send = 'refused'
    chain.estimation = feeReading({ error: true })
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    reads.nativeBalance.mockResolvedValueOnce(10n ** 18n).mockResolvedValueOnce(0n)
    await openByPush()

    expect(byTestId('arm-gas-blocker')).not.toBeNull()
    expect(byTestId('arm-write-failedNotSent')).toBeNull()
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)

    port.sendAccountBatch.mockResolvedValue(harness.TX_HASH)
    await press('arm-gas-continue')

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(2)
    expect(byTestId('arm-saved')).not.toBeNull()
  })
})

describe('the blocks on arrival', () => {
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
      wireClient('ready')
      await openByPush()

      expect(byTestId(`review-blocked-${kind}`)).not.toBeNull()
      expect(prepareCommitSetup).not.toHaveBeenCalled()
      expect(port.sendAccountBatch).not.toHaveBeenCalled()
    })
  )

  it('sends an encrypted save with no password in memory back to the privacy step, writing nothing', async () => {
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    wipeRecoveryPassword(CHAIN_ID, address)
    const before = JSON.stringify([...mockEntries])
    await openByPush()

    expect(byTestId('review-blocked-password-missing')).not.toBeNull()
    expect(prepareCommitSetup).not.toHaveBeenCalled()
    expect(port.sendAccountBatch).not.toHaveBeenCalled()
    expect(JSON.stringify([...mockEntries])).toBe(before)
    await press('review-blocked-privacy')
    expect(router.pathname).toBe(`/${WEB_ROUTES.socialRecoverySetupPrivacy}`)
  })
  ;(['loading', 'view-only', 'state-unread'] as const).forEach((facts) =>
    it(`prepares and sends nothing while the account facts read ${facts}`, async () => {
      await writeRecords(draftOf('encrypted'))
      wireClient(facts)
      await openByPush()

      expect(prepareCommitSetup).not.toHaveBeenCalled()
      expect(port.sendAccountBatch).not.toHaveBeenCalled()
      expect(byTestId('arm-saved')).toBeNull()
    })
  )

  it('names the deployment in the cost line for an account with no code', async () => {
    chain.send = 'refused'
    await writeRecords(draftOf('encrypted'))
    wireClient('ready', false)
    await openByPush()
    expect(byTestId('arm-cost-line')?.textContent).toBe(t('socialRecovery.costLines.saveDeploys'))
  })
})

describe('a reload of the save route after it ended', () => {
  it('after a saved setup: sends nothing again and shows the already-set-up block, not the saved screen', async () => {
    await writeRecords(draftOf('encrypted'))
    wireClient('ready')
    await openByPush()
    expect(byTestId('arm-saved')).not.toBeNull()

    chain.setupState = setupStateOf(true)
    await reload()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(prepareCommitSetup).toHaveBeenCalledTimes(1)
    expect(byTestId('arm-saved')).toBeNull()
    // The wiped records read as the default draft with no password set; the setup on the account wins.
    expect(byTestId('review-blocked-password-missing')).toBeNull()
    expect(byTestId('review-blocked-already-set-up')).not.toBeNull()
  })

  it('after a disagreed check on a committed setup: sends nothing again and shows the second-setup block', async () => {
    chain.confirm = Object.assign(new Error('mismatch'), { code: 'confirm.commitment-mismatch' })
    await writeRecords(draftOf('clear'))
    wireClient('ready')
    await openByPush()
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
    wireClient('ready')
    await openByPush()
    expect(byTestId('arm-write-failedNotSent')).not.toBeNull()

    await reload()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(byTestId('review-blocked-password-missing')).not.toBeNull()
  })

  it('after a save never sent, at a clear backup: opens no sign window by itself, and the Save button sends once more', async () => {
    chain.send = 'refused'
    await writeRecords(draftOf('clear'))
    wireClient('ready')
    await openByPush()
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)

    await reload()

    expect(port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(byTestId('arm-write-failedNotSent')).toBeNull()
    expect(byTestId('arm-save')).not.toBeNull()

    await press('arm-save')
    expect(port.sendAccountBatch).toHaveBeenCalledTimes(2)
  })
})
