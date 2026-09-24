/**
 * The SDK doubles (PT-035): in-memory implementations of the SDK interfaces of
 * `@web/modules/social-recovery/sdk-interfaces`, driven by one scripted chain
 * record. Only `shared/client` (PT-038) and this folder's tests import them;
 * screens import the client layer (docs/social-recovery/README.md).
 *
 * Frozen against sdk.md at design commit bd8780f7ad59a451035b15920c00015a2eee6e9b,
 * the commit `sdk-interfaces/` records. The one interface declared here is the
 * cut-q-22 seam, `IWalletReadsDouble` (wallet-reads.ts).
 */
export * from './chain'
export * from './scripts'
export {
  addressOf,
  defaultSalt,
  digestOfRequest,
  digestOfSubmission,
  doubleProof,
  readBackup,
  setupBodyOf,
  setupCommitmentOf,
  ZERO_ADDRESS,
  ZERO_HASH
} from './encoding'
export { ProviderDouble, revertedCall, type RevertedCall } from './provider'
export { EventManagerDouble, DEFAULT_LOG_CHUNK_WIDTH } from './event-manager'
export { PolicyManagerDouble, narrowModuleReads, MODULE_READ_MEMBERS } from './policy-manager'
export {
  RecoveryActionDouble,
  narrowActionInteractor,
  ACTION_INTERACTOR_MEMBERS
} from './recovery-action'
export { ActionCodecDouble } from './action-codec'
export * from './methods'
export { MethodsOrchestratorDouble, RECORD_VERSION } from './orchestrator'
export { defaultClientConfiguration, restoreConfiguration, type ClientContext } from './context'
export { SetupClientDouble, configurationOfDraft, levelOfDraft } from './setup-client'
export { RecoveryClientDouble, MOMENT_SKEW_SPAN } from './recovery-client'
export {
  RecoveryKitBuilderDouble,
  constructionRefusal,
  type ConstructionRefusal,
  kitFor
} from './builder'
export * from './wallet-reads'
