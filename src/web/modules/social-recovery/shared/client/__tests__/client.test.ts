/**
 * PT-038 done entries 1 and 3: the extension builds one client from a
 * configuration naming one chain, the address book of the manager, the methods
 * and the action, and a provider adapter whose four reads route through the
 * extension's own provider; it hands the client no signer and no storage; with
 * no rail configured nothing in the client can send (ux-interfaces.md D-370,
 * sdk.md D-208, ux.md D-312).
 */
import { ProviderDouble } from '@web/modules/social-recovery/sdk-doubles'
import type { DeploymentDescriptor, IProvider } from '@web/modules/social-recovery/sdk-interfaces'

import {
  buildRecoveryClient,
  CLIENT_CONFIGURATION_KEYS,
  createWorld,
  functionMembersOf,
  keysUnder,
  lastArg,
  namesSignerOrStorage,
  providerDoubleReads,
  spyOnBuilder,
  underlyingCalls
} from './harness'

const IPROVIDER_READS = ['block', 'call', 'chainId', 'logs']

afterEach(() => jest.restoreAllMocks())

describe('buildRecoveryClient', () => {
  it('builds one recovery client from a configuration naming one chain and the address book', async () => {
    const world = createWorld()
    const client = await buildRecoveryClient(world.config)
    expect(typeof client.recoveryState).toBe('function')
    expect(typeof client.prepareStartAttempt).toBe('function')
    expect(typeof client.prepareExecuteHandover).toBe('function')
    expect(typeof client.prepareCancelByOwner).toBe('function')
  })

  it('hands the builder double exactly the configuration, the adapter and the descriptor', async () => {
    const spies = spyOnBuilder()
    const world = createWorld()
    await buildRecoveryClient(world.config)

    const descriptor = lastArg(spies.descriptor) as DeploymentDescriptor
    expect(descriptor).toEqual(world.descriptor)
    expect(descriptor.chainId).toBe(world.config.chainId)

    const configuration = lastArg(spies.config) as Record<string, unknown>
    expect(configuration).toBeDefined()
    Object.keys(configuration).forEach((key) =>
      expect(CLIENT_CONFIGURATION_KEYS as string[]).toContain(key)
    )

    const adapter = lastArg(spies.provider) as IProvider
    expect(adapter).toBeDefined()
    expect(adapter).not.toBeInstanceOf(ProviderDouble)
    IPROVIDER_READS.forEach((read) => expect(functionMembersOf(adapter)).toContain(read))

    expect(lastArg(spies.account)).toBe(world.account)
    expect(spies.buildRecoveryClient).toHaveBeenCalledTimes(1)
  })

  it('routes the construction reads through the extension provider, never the provider double', async () => {
    const doubleReads = providerDoubleReads()
    const world = createWorld()
    await buildRecoveryClient(world.config)
    doubleReads.forEach((spy) => expect(spy).not.toHaveBeenCalled())
    expect(underlyingCalls(world.ethers).length).toBeGreaterThan(0)
  })

  it('hands the client no signer and no storage', async () => {
    const spies = spyOnBuilder()
    const world = createWorld()
    await buildRecoveryClient(world.config)

    const handed = [
      spies.provider,
      spies.descriptor,
      spies.account,
      spies.action,
      spies.config,
      spies.policyManager,
      spies.eventManager,
      spies.method,
      spies.codec
    ].flatMap((spy) => spy.mock.calls.flat())

    const keys = handed.flatMap((value) => keysUnder(value, 3, [world.ethers, world.chain]))
    expect(keys.filter(namesSignerOrStorage)).toEqual([])
  })

  it('hands the client a provider that answers four reads and cannot send (D-373)', async () => {
    const spies = spyOnBuilder()
    const world = createWorld()
    await buildRecoveryClient(world.config)
    const adapter = lastArg(spies.provider) as object
    const members = functionMembersOf(adapter)
    expect(members.filter((m) => /send|sign|balance|estimate/i.test(m))).toEqual([])
  })

  it('binds the one chain the configuration names and refuses a provider on another (D-312)', async () => {
    const world = createWorld()
    world.ethers.answeredChainId = 1
    await expect(buildRecoveryClient(world.config)).rejects.toBeDefined()
  })

  it('configures no sponsor rail: nothing handed to the builder names a rail, sponsor or paymaster', async () => {
    const spies = spyOnBuilder()
    const world = createWorld()
    await buildRecoveryClient(world.config)
    const configuration = lastArg(spies.config) as Record<string, unknown>
    const keys = keysUnder(configuration, 3)
    expect(keys.filter((k) => /rail|sponsor|paymaster|relayer/i.test(k))).toEqual([])
  })
})
