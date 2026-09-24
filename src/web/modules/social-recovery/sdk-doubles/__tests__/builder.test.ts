/**
 * The builder double (RecoveryKitBuilder, sdk.md D-201 "The builder", D-208).
 * It hands an integrator IMethodModuleReads, never IPolicyManagerInteractor,
 * and IRecoveryActionInteractor, never IRecoveryActionArming (brief delta 1).
 */
import type { RecoveryKitBuilderDouble } from '@web/modules/social-recovery/sdk-doubles'
import type {
  IMethodModuleReads,
  IPolicyManagerInteractor,
  IRecoveryActionArming,
  IRecoveryActionInteractor
} from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, membersOf } from './harness'

const BUILDER_MEMBERS = [
  'provider',
  'descriptor',
  'account',
  'action',
  'config',
  'policyManager',
  'eventManager',
  'method',
  'codec',
  'buildSetupClient',
  'buildRecoveryClient',
  'buildMethodsOrchestrator',
  'recoveryAction',
  'methodModuleReads'
]

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
  it('exposes every member of RecoveryKitBuilder', () => {
    const members = membersOf(createWorld().builder())
    BUILDER_MEMBERS.forEach((name) => expect(members).toContain(name))
  })

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

// The type of what the builder double hands out (brief "Test expectations"):
// exactly the narrow seam, and nothing the manager part or the arming seam adds.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Reads = Awaited<ReturnType<RecoveryKitBuilderDouble['methodModuleReads']>>
type Action = Awaited<ReturnType<RecoveryKitBuilderDouble['recoveryAction']>>
const readsExact: Exact<Reads, IMethodModuleReads> = true
const actionExact: Exact<Action, IRecoveryActionInteractor> = true
const readsNotManager: Reads extends IPolicyManagerInteractor ? false : true = true
const actionNotArming: Action extends IRecoveryActionArming ? false : true = true

describe('builder double types', () => {
  it('returns IMethodModuleReads and IRecoveryActionInteractor, no wider', () => {
    expect([readsExact, actionExact, readsNotManager, actionNotArming]).toEqual([
      true,
      true,
      true,
      true
    ])
  })
})
