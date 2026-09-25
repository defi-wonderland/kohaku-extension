/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'

import type { Network } from '@ambire-common/interfaces/network'
import { getRpcProvider } from '@ambire-common/services/provider/getRpcProvider'
import useNetworksControllerState from '@web/hooks/useNetworksControllerState'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { buildRecoveryClient } from '@web/modules/social-recovery/shared/client/build-client'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'

// The client build is stubbed: the SDK doubles need a TextEncoder that jsdom lacks,
// and these tests look at the provider the hook builds, not at the client.
jest.mock('@web/modules/social-recovery/shared/client/build-client', () => ({
  buildRecoveryClient: jest.fn(),
  isDigestVersionRefusal: () => false
}))
jest.mock('@ambire-common/services/provider/getRpcProvider', () => ({
  getRpcProvider: jest.fn()
}))
jest.mock('@web/hooks/useNetworksControllerState', () => ({
  __esModule: true,
  default: jest.fn()
}))

const buildProvider = getRpcProvider as jest.Mock
const buildClient = buildRecoveryClient as jest.Mock
const networksState = useNetworksControllerState as jest.Mock

// React 18.3.0 exports `act` only as `unstable_act`; the react-dom re-export warns on every call.
const { unstable_act: act } = React as unknown as { unstable_act: typeof React.act }
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SEPOLIA = 11155111
const ACCOUNT = '0x00000000000000000000000000000000000a11ce' as Address

const sepolia = (overrides: Partial<Network> = {}): Network =>
  ({
    chainId: BigInt(SEPOLIA),
    name: 'Sepolia',
    rpcUrls: ['https://rpc.example/sepolia'],
    selectedRpcUrl: 'https://rpc.example/sepolia',
    rpcProvider: 'colibri',
    proverRpcUrl: 'https://prover.example/one',
    consensusRpcUrl: 'https://consensus.example/one',
    heliosCheckpoint: `0x${'01'.repeat(32)}`,
    ...overrides
  } as Network)

interface ProviderMock {
  send: jest.Mock
  destroy: jest.Mock
}

let built: ProviderMock[]
let network: Network
let latest: ReturnType<typeof useRecoveryClient> | undefined
let root: Root

const Probe = ({ account }: { account: Address }) => {
  latest = useRecoveryClient(account)
  return null
}

const render = async () => {
  await act(async () => {
    root.render(React.createElement(Probe, { account: ACCOUNT }))
  })
}

/** Hands the hook another network record, as the controller state pushes one. */
const pushNetwork = async (next: Network) => {
  network = next
  await render()
}

beforeEach(() => {
  built = []
  buildProvider.mockImplementation(() => {
    const provider = { send: jest.fn(), destroy: jest.fn() }
    built.push(provider)
    return provider
  })
  buildClient.mockImplementation(async ({ chain, account }) => ({ chain, account }))
  network = sepolia()
  networksState.mockImplementation(() => ({ networks: [network] }))
  root = createRoot(document.createElement('div'))
  latest = undefined
})

afterEach(async () => {
  await act(async () => root.unmount())
  jest.clearAllMocks()
})

describe('useRecoveryClient over the network record', () => {
  it('builds one provider for the network record and a ready client over it', async () => {
    await render()
    expect(buildProvider).toHaveBeenCalledTimes(1)
    expect(buildProvider.mock.calls[0][0]).toBe(network)
    expect(buildClient).toHaveBeenCalledTimes(1)
    expect(latest?.status).toBe('ready')
  })

  it('tears the provider down when the hook unmounts', async () => {
    await render()
    await act(async () => root.unmount())
    expect(built[0].destroy).toHaveBeenCalledTimes(1)
  })

  const INPUTS: [keyof Network, string][] = [
    ['proverRpcUrl', 'https://prover.example/two'],
    ['consensusRpcUrl', 'https://consensus.example/two']
  ]
  INPUTS.forEach(([input, value]) =>
    it(`builds a new provider and tears down the old one when only ${input} changes`, async () => {
      await render()
      const [first] = built
      await pushNetwork(sepolia({ [input]: value }))
      expect(buildProvider).toHaveBeenCalledTimes(2)
      expect(buildProvider.mock.calls[1][0]).toMatchObject({ [input]: value })
      expect(first.destroy).toHaveBeenCalledTimes(1)
      expect(built[1].destroy).not.toHaveBeenCalled()
      expect(buildClient).toHaveBeenCalledTimes(2)
      expect(latest?.status).toBe('ready')
    })
  )

  it('keeps the provider when only the light client checkpoint changes, since the background writes each new one', async () => {
    network = sepolia({ rpcProvider: 'helios' })
    await render()
    await pushNetwork(sepolia({ rpcProvider: 'helios', heliosCheckpoint: `0x${'02'.repeat(32)}` }))
    expect(buildProvider).toHaveBeenCalledTimes(1)
    expect(built[0].destroy).not.toHaveBeenCalled()
    expect(buildClient).toHaveBeenCalledTimes(1)
    expect(latest?.status).toBe('ready')
  })

  it('builds nothing new and tears nothing down when an equal network record arrives', async () => {
    await render()
    await pushNetwork(sepolia())
    await pushNetwork(sepolia())
    expect(buildProvider).toHaveBeenCalledTimes(1)
    expect(built[0].destroy).not.toHaveBeenCalled()
    expect(buildClient).toHaveBeenCalledTimes(1)
    expect(latest?.status).toBe('ready')
  })
})
