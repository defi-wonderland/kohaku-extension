import type { Network } from '@ambire-common/interfaces/network'
import { providerKeyOf } from '@web/modules/social-recovery/shared/client/extension-provider'
import type { DeploymentDescriptor } from '@web/modules/social-recovery/sdk-interfaces'
import {
  readWatcherRecord,
  startRecoveryWatcher,
  WATCHER_ALARM
} from '@web/modules/social-recovery/watcher'

import {
  ACCOUNT,
  BASIC_ACCOUNT,
  fakeAlarms,
  listed,
  memoryStorage,
  OTHER_ACCOUNT,
  scriptedChain,
  SEPOLIA,
  settle,
  stateWith
} from '@web/modules/social-recovery/watcher/__fixtures__/harness'

const NETWORK = {
  chainId: BigInt(SEPOLIA),
  rpcUrls: ['https://sepolia.example'],
  selectedRpcUrl: 'https://sepolia.example'
} as unknown as Network

const DEPLOYMENT = { deployedAt: 0 } as DeploymentDescriptor

const setUp = ({ accounts = [listed(ACCOUNT)], deployed = true, networked = true } = {}) => {
  const deployment = deployed ? DEPLOYMENT : undefined
  const network = networked ? NETWORK : undefined
  const chain = scriptedChain()
  ;[ACCOUNT, OTHER_ACCOUNT, BASIC_ACCOUNT].forEach((account) => {
    chain.deploy(account)
    chain.setState(account, stateWith())
  })
  const storage = memoryStorage()
  const { alarms, fire } = fakeAlarms()
  const onBadge = jest.fn()
  const destroy = jest.fn()
  const connect = jest.fn((record: Network) => ({
    reads: chain.reads,
    providerKey: providerKeyOf(record),
    destroy
  }))
  const watcher = startRecoveryWatcher({
    accounts: () => accounts,
    network: () => network,
    onBadge,
    deployment: () => deployment,
    alarms,
    storage,
    connect,
    now: () => 1_000,
    limitMs: 1_000
  })
  return { chain, storage, alarms, fire, onBadge, connect, destroy, watcher }
}

describe('the watcher', () => {
  it('registers an alarm of one minute and polls once at start', async () => {
    const { alarms, chain, onBadge } = setUp()
    await settle()

    expect(alarms.create).toHaveBeenCalledTimes(1)
    expect(alarms.create).toHaveBeenCalledWith(WATCHER_ALARM, { periodInMinutes: 1 })
    expect(chain.reads.latestBlock).toHaveBeenCalledTimes(1)
    expect(onBadge).toHaveBeenCalledWith(0)
  })

  it('polls on its own alarm and on no other', async () => {
    const { chain, fire } = setUp()
    await settle()

    fire('ALARMS_AUTO_LOCK')
    await settle()
    expect(chain.reads.latestBlock).toHaveBeenCalledTimes(1)

    fire(WATCHER_ALARM)
    await settle()
    expect(chain.reads.latestBlock).toHaveBeenCalledTimes(2)
  })

  it('starts no alarm and writes no record in a build with no deployed kit', async () => {
    const { alarms, storage, watcher } = setUp({ deployed: false })
    await settle()

    expect(watcher).toBeUndefined()
    expect(alarms.create).not.toHaveBeenCalled()
    expect(storage.entries.size).toBe(0)
  })

  it('skips the basic accounts and writes one record per smart account', async () => {
    const { chain, storage } = setUp({
      accounts: [listed(ACCOUNT), listed(BASIC_ACCOUNT, false), listed(OTHER_ACCOUNT)]
    })
    await settle()

    expect(chain.reads.stateOf.mock.calls.map(([account]) => account)).toEqual([
      ACCOUNT,
      OTHER_ACCOUNT
    ])
    expect(storage.entries.size).toBe(2)
    expect(await readWatcherRecord(storage, SEPOLIA, BASIC_ACCOUNT)).toBeUndefined()
  })

  it('skips a tick while the previous poll runs', async () => {
    const { chain, fire, watcher } = setUp()
    await settle()
    let answer: (() => void) | undefined
    chain.reads.latestBlock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ ...chain.head })
        })
    )

    const running = watcher?.tick()
    await settle()
    fire(WATCHER_ALARM)
    await settle()
    expect(chain.reads.latestBlock).toHaveBeenCalledTimes(2)

    answer?.()
    await running
    fire(WATCHER_ALARM)
    await settle()
    expect(chain.reads.latestBlock).toHaveBeenCalledTimes(3)
  })

  it('marks every watched account failed and badges it where the recovery chain has no network', async () => {
    const { onBadge, storage } = setUp({ networked: false })
    await settle()

    expect(onBadge).toHaveBeenCalledWith(1)
    expect((await readWatcherRecord(storage, SEPOLIA, ACCOUNT))?.failed?.message).toMatch(
      /no network for chain 11155111/
    )
  })

  it('keeps one provider while the network record keeps its provider fields', async () => {
    const { connect, destroy, watcher } = setUp()
    await settle()
    await watcher?.tick()

    expect(connect).toHaveBeenCalledTimes(1)
    watcher?.stop()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
