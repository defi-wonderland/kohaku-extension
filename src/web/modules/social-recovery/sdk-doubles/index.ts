/**
 * The SDK doubles: in-memory implementations of the SDK interfaces of
 * `@web/modules/social-recovery/sdk-interfaces`, driven by one scripted chain
 * record (`ScriptedChain`). They stand in for the real SDK until it ships. Only
 * `shared/client` and this folder's tests import them; a screen imports
 * `shared/client`, which ESLint enforces.
 *
 * The doubles implement the interface types and add nothing to them. The one
 * interface declared here is `IWalletReadsDouble` (wallet-reads.ts), three reads
 * the wallet needs that no SDK member makes.
 */
export * from './chain'
export * from './scripts'
export {
  addressOf,
  APPROVAL_TYPES,
  BACKUP_PADDING_SIZE,
  CANCELLATION_TYPES,
  defaultSalt,
  digestOf,
  digestOfRequest,
  digestOfSubmission,
  doubleProof,
  levelOfFields,
  levelOfMetadata,
  readBackup,
  readPublicNote,
  setupBodyOf,
  setupCommitmentOf,
  typedDataOf,
  ZERO_ADDRESS,
  ZERO_HASH,
  type BackupReading,
  type PlaceTypedData,
  type PublicNoteReading,
  type PublicShape
} from './encoding'
export {
  ACCOUNT_NOT_ARMED,
  ACCOUNT_UNFIT,
  acceptanceRevert,
  evaluateRule,
  executeRevert,
  type RuleEvaluation
} from './verification'
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
export {
  MethodsOrchestratorDouble,
  RECORD_VERSION,
  replyReadable,
  requestReadable
} from './orchestrator'
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
