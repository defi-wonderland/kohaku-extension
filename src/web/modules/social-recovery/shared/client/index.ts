/**
 * The client layer (PT-038): the one place the extension reaches the SDK,
 * today the doubles of PT-035. Screens import this module and never
 * `sdk-doubles/`, so the swap to the real SDK touches this folder alone.
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
  createSignerFacade,
  typedMessageOf,
  isListedBasicAccountKey,
  signerNotWired,
  isSignerNotWired,
  signFlowFailure,
  isSignFlowFailure,
  type KeyHandle,
  type TypedDataToSign,
  type SignerFacade,
  type SignerMember,
  type SignerFacadeOptions,
  type SignMessageFlowAction,
  type SignMessageFlowState,
  type SignMessageFlowPort,
  type ListedAccount,
  type SignerNotWired,
  type SignFlowFailure,
  type SignFlowFailureReason
} from './signer'
export { signMessageFlowPort } from './signer-port'
export { SPONSOR_RAIL, sendingKeyOf, type SendingKeys } from './sending'
export { sdkStandIn } from './stand-in'
