/**
 * What the extension builds one client from (ux-interfaces.md D-370), and the
 * SDK client configuration of sdk.md D-208 it derives.
 *
 * The configuration names one chain, the address book of the manager, the
 * methods and the action, the provider adapter, and the account the client
 * binds. It has no field for a signer, a storage or a sponsor rail: the SDK
 * stores nothing and holds no signer, so the extension keeps both outside the
 * client, and the first release configures no rail (ux.md D-312).
 */
import { defaultClientConfiguration } from '@web/modules/social-recovery/sdk-doubles'
import type {
  Address,
  ClientConfiguration,
  CreationRecord,
  IProvider
} from '@web/modules/social-recovery/sdk-interfaces'

import type { AddressBook } from './addresses'
import type { RecoveryChain } from './chains'

/** The account facts the client configuration carries where the wallet has them (sdk.md D-208). */
export interface AccountFacts {
  /** The account's creation triple and block, read by the handover builder alone. */
  creation?: CreationRecord
  /** The account implementation the wallet is about to deploy, read by the fit check alone. */
  accountImplementation?: Address
  /** The wallet's own keys it asks `isAuthority` about; never the account's signer set. */
  candidateKeys?: Address[]
}

export interface RecoveryClientConfiguration extends AccountFacts {
  /** The one chain the wallet reads, a fixed label with no switch (ux.md D-312). */
  chain: RecoveryChain
  /** The account the client binds. */
  account: Address
  /** The deployed manager, methods and action (cut-q-7 placeholders until deployment). */
  addressBook: AddressBook
  /** The provider adapter over the extension's own provider (`createProviderAdapter`). */
  provider: IProvider
}

/**
 * The width of a request's validity window: the wallet's own 24 hours, counted
 * from the moment the request is created. The client configuration's width
 * entry is set to the same value so the SDK's window check never fires under
 * it (ux-interfaces.md D-373).
 */
export const REQUEST_WINDOW_SECONDS = 24 * 3600

/**
 * The SDK client configuration of one extension configuration: D-208's
 * shipped numbers, the request window of D-373, no token allowlist (the first
 * release names no payment order, ux.md D-312) and the account facts where
 * the wallet has them.
 */
export const clientConfigurationOf = (config: RecoveryClientConfiguration): ClientConfiguration => {
  const shipped = defaultClientConfiguration()
  return defaultClientConfiguration({
    tokens: [],
    candidateKeys: [...(config.candidateKeys ?? [])],
    requestWindow: {
      default: REQUEST_WINDOW_SECONDS,
      floor: shipped.requestWindow?.floor ?? 3600,
      ceiling: shipped.requestWindow?.ceiling ?? 72 * 3600
    },
    ...(config.creation ? { creation: { ...config.creation } } : {}),
    ...(config.accountImplementation ? { accountImplementation: config.accountImplementation } : {})
  })
}
