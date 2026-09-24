/**
 * Type-level check of the twelve interfaces docs/social-recovery/design/sdk.md
 * D-201 "What this chapter freezes" names. `tsc --noEmit` fails if the barrel
 * does not export any one of them; the runtime body only passes.
 */
import type {
  IActionCodec,
  IEventManager,
  IMethodCodec,
  IMethodModuleReads,
  IMethodsOrchestrator,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionArming,
  IRecoveryActionInteractor,
  IRecoveryClient,
  IRecoveryMethod,
  ISetupClient
} from '@web/modules/social-recovery/sdk-interfaces'

const setupClient = null as unknown as ISetupClient
const recoveryClient = null as unknown as IRecoveryClient
const methodsOrchestrator = null as unknown as IMethodsOrchestrator
const policyManagerInteractor = null as unknown as IPolicyManagerInteractor
const eventManager = null as unknown as IEventManager
const methodModuleReads = null as unknown as IMethodModuleReads
const provider = null as unknown as IProvider
const recoveryMethod = null as unknown as IRecoveryMethod
const actionCodec = null as unknown as IActionCodec
const methodCodec = null as unknown as IMethodCodec
const recoveryActionInteractor = null as unknown as IRecoveryActionInteractor
const recoveryActionArming = null as unknown as IRecoveryActionArming

describe('sdk-interfaces type surface', () => {
  it('declares the twelve D-201 interfaces (checked by tsc)', () => {
    const declared = [
      setupClient,
      recoveryClient,
      methodsOrchestrator,
      policyManagerInteractor,
      eventManager,
      methodModuleReads,
      provider,
      recoveryMethod,
      actionCodec,
      methodCodec,
      recoveryActionInteractor,
      recoveryActionArming
    ]
    expect(declared).toHaveLength(12)
  })
})
