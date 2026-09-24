/**
 * The SDK interfaces the account recovery module builds against, mirroring
 * docs/social-recovery/design/sdk.md D-201 "What this chapter freezes".
 *
 * Design commit: bd8780f7ad59a451035b15920c00015a2eee6e9b of
 * defi-wonderland/mast-social-recovery-2 (docs/social-recovery/README.md).
 *
 * Every declaration is hand-written from sdk.md D-201 to D-208 and imported from
 * no SDK package, so the doubles of PT-035 and the real SDK meet on one shape.
 * Types only, beside `as const` vocabularies for the closed sets. Member names
 * are sdk.md's own. The three members cut-q-22 records (the verify per pasted
 * reply, the removed-key read, the fit check on code-to-be) are not SDK members
 * and are not declared here.
 *
 * The twelve interfaces D-201 freezes, by file:
 * - interactor.ts (D-202): ISetupClient, IRecoveryClient, IPolicyManagerInteractor,
 *   IMethodModuleReads, IRecoveryActionInteractor, IRecoveryActionArming
 * - events.ts (D-203): IEventManager
 * - formats.ts (D-204): IActionCodec, IMethodCodec
 * - methods.ts (D-206): IMethodsOrchestrator, IRecoveryMethod
 * - builder.ts (D-208): IProvider
 *
 * This folder is frozen after the setup task; a change is a design change first.
 */
export * from './common'
export * from './interactor'
export * from './events'
export * from './formats'
export * from './utilities'
export * from './methods'
export * from './gathering'
export * from './builder'
export * from './privacy'
