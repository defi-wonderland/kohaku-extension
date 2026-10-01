/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'

import type { Account, AccountStates } from '@ambire-common/interfaces/account'
import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useKeystoreControllerState from '@web/hooks/useKeystoreControllerState'
import useNetworksControllerState from '@web/hooks/useNetworksControllerState'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { useAccountFacts } from '@web/modules/social-recovery/shared/client/useAccountFacts'

jest.mock('@web/hooks/useAccountsControllerState', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@web/hooks/useKeystoreControllerState', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@web/hooks/useNetworksControllerState', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@web/hooks/useProvidersControllerState', () => ({
  __esModule: true,
  default: () => ({ providers: {} })
}))
jest.mock('@web/hooks/useBackgroundService', () => ({
  __esModule: true,
  default: () => ({ dispatch: jest.fn() })
}))
// viem builds a TextEncoder and a TextDecoder when either entry loads, which
// jsdom lacks: Node's own are installed first, whichever entry loads first.
jest.mock('viem', () => {
  // eslint-disable-next-line global-require
  const { TextDecoder, TextEncoder } = require('util')
  Object.assign(globalThis, { TextDecoder, TextEncoder })
  return jest.requireActual('viem')
})
jest.mock('viem/chains', () => {
  // eslint-disable-next-line global-require
  const { TextDecoder, TextEncoder } = require('util')
  Object.assign(globalThis, { TextDecoder, TextEncoder })
  return jest.requireActual('viem/chains')
})

// React 18.3.0 exports `act` only as `unstable_act`; the react-dom re-export warns on every call.
const act: typeof React.act =
  (React as unknown as { act?: typeof React.act }).act ??
  (React as unknown as { unstable_act: typeof React.act }).unstable_act
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SEPOLIA = 11155111
const ACCOUNT = '0x00000000000000000000000000000000000a11ce' as Address
const KEY = '0x00000000000000000000000000000000000000c1' as Address

const LISTED: Account = {
  addr: ACCOUNT,
  associatedKeys: [KEY],
  initialPrivileges: [],
  creation: {
    factoryAddr: `0x${'fa'.repeat(20)}`,
    bytecode: '0x6000',
    salt: `0x${'00'.repeat(32)}`
  },
  preferences: { label: 'Account 1', pfp: ACCOUNT }
}

const stateOf = (isDeployed: boolean): AccountStates =>
  ({ [ACCOUNT]: { [String(SEPOLIA)]: { accountAddr: ACCOUNT, isDeployed, nonce: 0n } } } as never)

const NETWORK = { chainId: BigInt(SEPOLIA), name: 'Sepolia' }

const accountsState = useAccountsControllerState as jest.Mock
const keystoreState = useKeystoreControllerState as jest.Mock
const networksState = useNetworksControllerState as jest.Mock

type Reading = ReturnType<typeof useAccountFacts>

let root: Root
let latest: Reading | undefined

const Probe = ({ account }: { account: Address | undefined }) => {
  latest = useAccountFacts(account)
  return null
}

const render = async (account: Address | null = ACCOUNT) => {
  await act(async () => {
    root.render(React.createElement(Probe, { account: account ?? undefined }))
  })
}

/** What the controller states hand the hook; a test changes it and renders again. */
let wallet: {
  accounts?: Account[]
  accountStates?: AccountStates
  keys?: { addr: string; type: string }[]
  networks?: object[]
}

beforeEach(() => {
  wallet = {
    accounts: [LISTED],
    accountStates: stateOf(true),
    keys: [{ addr: KEY, type: 'internal' }],
    networks: [NETWORK]
  }
  accountsState.mockImplementation(() => ({
    accounts: wallet.accounts,
    accountStates: wallet.accountStates
  }))
  keystoreState.mockImplementation(() => ({ keys: wallet.keys }))
  networksState.mockImplementation(() => ({ networks: wallet.networks }))
  root = createRoot(document.createElement('div'))
  latest = undefined
})

afterEach(async () => {
  await act(async () => root.unmount())
  jest.clearAllMocks()
})

describe('useAccountFacts', () => {
  it("hands the selected account's facts from the accounts, keystore and networks states", async () => {
    await render()
    expect(latest).toMatchObject({
      status: 'ready',
      facts: {
        account: LISTED,
        deployed: true,
        key: { addr: KEY, type: 'internal' },
        creation: { factory: LISTED.creation?.factoryAddr, salt: LISTED.creation?.salt }
      }
    })
  })

  it('reads as loading until each state arrives, then ready', async () => {
    wallet.keys = undefined
    await render()
    expect(latest).toMatchObject({ status: 'loading' })
    wallet.keys = [{ addr: KEY, type: 'internal' }]
    await render()
    expect(latest?.status).toBe('ready')
  })

  it('reads the account again when its state on the chain changes', async () => {
    wallet.accountStates = stateOf(false)
    await render()
    expect(latest?.status === 'ready' && latest.facts.deployed).toBe(false)
    wallet.accountStates = stateOf(true)
    await render()
    expect(latest?.status === 'ready' && latest.facts.deployed).toBe(true)
  })

  it('reads a view-only account with no key, and an unlisted one as not listed', async () => {
    wallet.keys = []
    await render()
    expect(latest?.status === 'ready' && latest.facts).not.toHaveProperty('key')
    await render('0x00000000000000000000000000000000000b0b00' as Address)
    expect(latest).toMatchObject({ status: 'unavailable', cause: 'not-listed' })
  })

  it('reads as loading with no account selected', async () => {
    await render(null)
    expect(latest).toMatchObject({ status: 'loading' })
  })

  it('hands the same reading while nothing it reads changed', async () => {
    await render()
    const first = latest
    await render()
    expect(latest).toBe(first)
  })
})
