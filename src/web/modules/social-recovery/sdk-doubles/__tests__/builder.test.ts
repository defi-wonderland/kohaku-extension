import {
  addressOf,
  type CodedError,
  type RecoveryKitBuilderDouble
} from '@web/modules/social-recovery/sdk-doubles'
import type {
  DeploymentDescriptor,
  IMethodModuleReads,
  IProvider,
  IRecoveryActionInteractor
} from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, eachIt, membersOf, NO_PAYMENT, WINDOW, World } from './harness'

/** Every way to build from a builder; each runs the construction checks. */
const BUILD_PATHS = {
  buildSetupClient: (b: RecoveryKitBuilderDouble) => b.buildSetupClient(),
  buildRecoveryClient: (b: RecoveryKitBuilderDouble) => b.buildRecoveryClient(),
  buildMethodsOrchestrator: (b: RecoveryKitBuilderDouble) => b.buildMethodsOrchestrator(),
  recoveryAction: (b: RecoveryKitBuilderDouble) => b.recoveryAction(),
  methodModuleReads: (b: RecoveryKitBuilderDouble) => b.methodModuleReads()
}
type BuildPath = keyof typeof BUILD_PATHS

/** The code a build path refuses with, thrown or rejected; undefined where it builds. */
const refusalCode = async (
  builder: RecoveryKitBuilderDouble,
  path: BuildPath
): Promise<string | undefined> => {
  try {
    await BUILD_PATHS[path](builder)
    return undefined
  } catch (e) {
    return (e as CodedError).code
  }
}

const PATHS = Object.keys(BUILD_PATHS) as BuildPath[]

const MANAGER_ONLY = [
  'stateOf',
  'hashApproval',
  'hashCancel',
  'eip712Domain',
  'prepareCommitSetup',
  'prepareClearSetup',
  'prepareStartAttempt',
  'prepareCancelByProofs',
  'prepareCancelByOwner',
  'prepareCancelByVeto'
]

describe('builder double', () => {
  it('builds the two clients and the orchestrator', async () => {
    const world = createWorld()
    const builder = world.builder()
    const setup = await builder.buildSetupClient()
    const recovery = await builder.buildRecoveryClient()
    expect(typeof setup.setupState).toBe('function')
    expect(typeof recovery.recoveryState).toBe('function')
    expect(setup.events).toBe(recovery.events)
    expect(typeof builder.buildMethodsOrchestrator().describeRequest).toBe('function')
  })

  it('hands out the module reads alone, never the manager’s prepares', async () => {
    const reads: IMethodModuleReads = await createWorld().builder().methodModuleReads()
    expect(typeof reads.moduleInfo).toBe('function')
    expect(typeof reads.paused).toBe('function')
    expect(typeof reads.trustedParties).toBe('function')
    const members = membersOf(reads)
    MANAGER_ONLY.forEach((name) => expect(members).not.toContain(name))
    expect(members.filter((m) => m.startsWith('prepare'))).toEqual([])
    expect(members).not.toContain('armingCall')
  })

  it('hands out the action interactor alone, never the arming seam', async () => {
    const action: IRecoveryActionInteractor = await createWorld().builder().recoveryAction()
    ;['supportsAccount', 'isAuthority', 'isAuthorized', 'holdsAnyPrivilege', 'actionInfo'].forEach(
      (name) => expect(typeof (action as unknown as Record<string, unknown>)[name]).toBe('function')
    )
    const members = membersOf(action)
    expect(members).not.toContain('armingCall')
    expect(members.filter((m) => m.startsWith('prepare'))).toEqual([])
    expect((action as unknown as Record<string, unknown>).armingCall).toBeUndefined()
  })

  it('supplies the shipped codec for the chain’s own action when none is registered', async () => {
    const world = createWorld()
    const committed = world.script.setupCommitted('private')
    world.script.authorized(true)
    const recovery = await world
      .builder()
      .action(world.descriptor.action, world.actionPart)
      .buildRecoveryClient()
    const gathering = await recovery.initRecoveryGathering(
      committed.configuration,
      { newAuthority: world.keys.fresh, removedAuthority: world.keys.held },
      NO_PAYMENT,
      { window: WINDOW }
    )
    expect(gathering.request.payload).toBe(
      world.codec.encode({ newAuthority: world.keys.fresh, removedAuthority: world.keys.held })
    )
    world.chain.openAttempt({ ready: true, payload: gathering.request.payload })
    const { attempt } = await recovery.recoveryState()
    const execute = await recovery.prepareExecuteHandover(attempt, gathering.request.payload!)
    // The consume, the grant and the revoke: the payload decoded under the action's codec.
    expect(execute.describes).toHaveLength(3)
    expect(execute.simulation?.ok).toBe(true)
  })

  it('refuses a domain whose chain id differs from the descriptor’s only beyond 2^53', async () => {
    const world = createWorld({ descriptor: { chainId: 2 ** 53 } })
    expect(await refusalCode(world.builder(), 'buildSetupClient')).toBeUndefined()
    const { domain } = world.chain.manager
    world.chain.manager.domain = { ...domain, chainId: 2n ** 53n + 1n }
    expect(Number(world.chain.manager.domain.chainId)).toBe(world.descriptor.chainId)
    expect(await refusalCode(world.builder(), 'buildSetupClient')).toBe('construction.domain')
  })

  eachIt(PATHS)('refuses a foreign account on %s', async (path) => {
    const world = createWorld()
    const builder = world.builder()
    builder.account(world.keys.fresh)
    expect(await refusalCode(builder, path)).toBe('construction.account')
  })

  describe('a descriptor the scripted chain does not serve', () => {
    // The client paths run the provider and domain checks first, so a wrong
    // network reads as chain-id or domain there; the orchestrator reads no
    // chain, so it refuses the descriptor as unserved.
    const mismatches: [string, (d: DeploymentDescriptor) => DeploymentDescriptor, string][] = [
      ['chain id', (d) => ({ ...d, chainId: d.chainId + 1 }), 'construction.chain-id'],
      ['manager', (d) => ({ ...d, manager: addressOf('another-manager') }), 'construction.domain'],
      ['action', (d) => ({ ...d, action: addressOf('another-action') }), 'construction.unserved']
    ]
    mismatches.forEach(([field, mismatch, clientCode]) =>
      eachIt(PATHS)(`is refused on %s for its ${field}`, async (path) => {
        const world = createWorld()
        const builder = world.builder()
        builder.descriptor(mismatch(world.descriptor))
        const expected = path === 'buildMethodsOrchestrator' ? 'construction.unserved' : clientCode
        expect(await refusalCode(builder, path)).toBe(expected)
      })
    )
  })

  eachIt(PATHS)(
    'refuses an action address the scripted chain does not serve on %s',
    async (path) => {
      const world = createWorld()
      const builder = world.builder()
      builder.action(addressOf('another-action'), world.actionPart)
      expect(await refusalCode(builder, path)).toBe('construction.unserved')
    }
  )

  describe('a provider on another network', () => {
    const answering = (world: World, chainId: number): IProvider => ({
      chainId: async () => chainId,
      call: (to, data, from, tag) => world.provider.call(to, data, from, tag),
      logs: (filter, range) => world.provider.logs(filter, range),
      block: (tag) => world.provider.block(tag)
    })

    it('is refused as chain-id when it answers another chain than the descriptor', async () => {
      const world = createWorld()
      const builder = world.builder()
      builder.provider(answering(world, world.descriptor.chainId + 1))
      expect(await refusalCode(builder, 'buildSetupClient')).toBe('construction.chain-id')
      expect(await refusalCode(world.builder(), 'buildSetupClient')).toBeUndefined()
    })

    it('is refused as domain when it and the descriptor agree on a chain the manager is not on', async () => {
      const world = createWorld()
      const foreign = world.descriptor.chainId + 1
      const builder = world.builder()
      builder.provider(answering(world, foreign))
      builder.descriptor({ ...world.descriptor, chainId: foreign })
      expect(await refusalCode(builder, 'buildRecoveryClient')).toBe('construction.domain')
    })
  })

  it('builds on every path for the chain’s own deployment, account and action', async () => {
    const world = createWorld()
    const codes = await Promise.all(
      PATHS.map((path) =>
        refusalCode(
          world
            .builder()
            .account(world.account)
            .action(world.descriptor.action, world.actionPart) as RecoveryKitBuilderDouble,
          path
        )
      )
    )
    expect(codes).toEqual(PATHS.map(() => undefined))
  })

  it('refuses a setter after the first build, recoveryAction and methodModuleReads counting as builds', async () => {
    const world = createWorld()
    const afterAction = world.builder()
    await afterAction.recoveryAction()
    expect(() => afterAction.account(world.keys.fresh)).toThrow()
    const afterReads = world.builder()
    await afterReads.methodModuleReads()
    expect(() => afterReads.method(world.methods.wallet)).toThrow()
    const afterSetup = world.builder()
    await afterSetup.buildSetupClient()
    expect(() =>
      afterSetup.config({
        tokens: [],
        candidateKeys: [],
        blockTags: { read: 'latest', watch: 'finalized' }
      })
    ).toThrow()
  })
})
