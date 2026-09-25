import type {
  IMethodModuleReads,
  IRecoveryActionInteractor
} from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, membersOf } from './harness'

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
