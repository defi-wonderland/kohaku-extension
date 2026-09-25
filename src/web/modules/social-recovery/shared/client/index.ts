/**
 * The client layer: the one place the extension reaches the SDK, today its
 * doubles. Screens import this module and never `sdk-doubles/`, so the swap to
 * the real SDK touches this folder alone.
 *
 * The React hook lives in its own file, `useRecoveryClient`, imported by path,
 * so this module loads in a Node test without the UI's contexts.
 */
export {
  RECOVERY_CHAINS,
  CHAIN_IDS,
  WALLET_RECOVERY_CHAIN,
  recoveryChainOf,
  type RecoveryChain
} from './chains'
export { PLACEHOLDER_ADDRESSES, addressBookOf, sameAddress, type AddressBook } from './addresses'
export {
  PUBLISHERS,
  AUDITED_ACTIONS,
  UNKNOWN_ACTION,
  auditedActionsOn,
  auditedActionOf,
  isAuditedAction,
  publisherKeyOf,
  type Publisher,
  type PublisherKey,
  type AuditedAction,
  type UnknownAction
} from './audited-actions'
export { DEPLOYMENT_FACTS, deploymentDescriptor, descriptorOf } from './descriptors'
export {
  REQUEST_WINDOW_SECONDS,
  clientConfigurationOf,
  type AccountFacts,
  type RecoveryClientConfiguration
} from './configuration'
export {
  PROVIDER_READS,
  createProviderAdapter,
  revertedCall,
  providerReadFailure,
  isRevertedCall,
  isProviderReadFailure,
  revertDataOf,
  toQuantity,
  blockParam,
  type ExtensionRpc,
  type ProviderRead,
  type RevertedCall,
  type ProviderReadFailure
} from './provider-adapter'
export { createChainReads, gasCallOf, type ChainReads, type GasEstimateCall } from './chain-reads'
export { networkOf, extensionProviderFor, type ExtensionProvider } from './extension-provider'
export {
  MANAGER_DOMAIN_NAME,
  MANAGER_DOMAIN_FIELDS,
  buildRecoveryClient,
  checkDigestVersion,
  carriedDomainVersion,
  digestVersionRefusal,
  isDigestVersionRefusal,
  type RecoveryKitClient,
  type DomainVersion,
  type DigestVersionRefusal
} from './build-client'
export {
  REMOVED_KEY_UNAVAILABLE_CAUSES,
  type WalletReads,
  type FitCheckReading,
  type RemovedKeyReading,
  type RemovedKeyUnavailableCause
} from './wallet-reads'
export {
  SIGNER_MEMBERS,
  MISSING_BACKGROUND_ACTION,
  SIGN_FLOW_FAILURE_REASONS,
  DEFAULT_SIGN_TIMEOUT_MS,
  ABSENCE_GRACE_MS,
  createSignerFacade,
  signRequestOf,
  typedMessageOf,
  listedBasicAccountOf,
  isListedBasicAccountKey,
  recoveredSignerOf,
  signerNotWired,
  isSignerNotWired,
  signFlowFailure,
  isSignFlowFailure,
  type KeyHandle,
  type TypedDataToSign,
  type SignerFacade,
  type SignerMember,
  type SignerFacadeOptions,
  type SignRequestAction,
  type SignRequestPort,
  type SignRequestUpdate,
  type SignMessageState,
  type RequestsState,
  type ListedAccount,
  type SignerNotWired,
  type SignFlowFailure,
  type SignFlowFailureReason
} from './signer'
export { signRequestPort } from './signer-port'
export {
  SPONSOR_RAIL,
  RECOVERY_CALLS,
  sendingKeyOf,
  type RecoveryCall,
  type SendingKeys
} from './sending'
// `sdkStandIn` stays out of this module: tests and development code import
// `shared/client/stand-in` by path, so no screen reaches the scripted chain.
