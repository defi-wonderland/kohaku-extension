/**
 * PT-038 done entry 3: the digest version the manager publishes through its
 * domain is checked when the client is built, and a disagreement refuses the
 * client before anything is prepared (sdk.md D-208 construction step 5,
 * ux.md D-319, the "update the wallet" state of D-306).
 */
import { ScriptedReadFailure } from '@web/modules/social-recovery/sdk-doubles'

import {
  buildRecoveryClient,
  createWorld,
  DigestVersionRefusal,
  failEverything,
  spyOnBuilder,
  spyOnPrepares
} from './harness'

afterEach(() => jest.restoreAllMocks())

describe('the digest-version check', () => {
  it('builds the client when the manager domain carries the descriptor digest version', async () => {
    const world = createWorld()
    expect(world.chain.manager.domain.version).toBe(world.descriptor.digestVersion)
    const client = await buildRecoveryClient(world.config)
    expect(typeof client.prepareStartAttempt).toBe('function')
  })

  it('refuses the client with the typed refusal when the domain disagrees', async () => {
    const world = createWorld()
    world.chain.manager.domain.version = `${world.descriptor.digestVersion}-other`
    const caught = await buildRecoveryClient(world.config).then(
      () => undefined,
      (e: unknown) => e
    )
    expect(caught).toBeInstanceOf(DigestVersionRefusal)
  })

  it('refuses before any prepare is possible, and no prepare member was called', async () => {
    const prepares = spyOnPrepares()
    const builder = spyOnBuilder()
    const world = createWorld()
    world.chain.manager.domain.version = '999'
    let client: unknown
    try {
      client = await buildRecoveryClient(world.config)
    } catch {
      client = undefined
    }
    expect(client).toBeUndefined()
    expect(prepares.length).toBeGreaterThan(0)
    prepares.forEach((spy) => expect(spy).not.toHaveBeenCalled())
    // The builder never handed a client out to the lane.
    const handedOut = await Promise.allSettled(
      builder.buildRecoveryClient.mock.results.map((r) => r.value as Promise<unknown>)
    )
    handedOut.forEach((r) => expect(r.status).toBe('rejected'))
  })

  it('does not read a failed domain read as a version disagreement', async () => {
    const world = createWorld()
    world.chain.failRead('manager.eip712Domain')
    failEverything(world.ethers, new Error('the node did not answer'))
    const caught = await buildRecoveryClient(world.config).then(
      () => undefined,
      (e: unknown) => e
    )
    expect(caught).toBeDefined()
    expect(caught).not.toBeInstanceOf(DigestVersionRefusal)
    expect(caught instanceof Error || caught instanceof ScriptedReadFailure).toBe(true)
  })
})
