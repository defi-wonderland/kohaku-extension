/**
 * The extension's own provider for the one recovery chain.
 *
 * It is built through `getRpcProvider` of ambire-common from the network record
 * the UI reads through `useNetworksControllerState`, so it honours the
 * network's selected RPC URL and its provider kind: a plain JSON-RPC provider,
 * the Helios light client or Colibri with its prover (ux-interfaces.md D-370).
 * The provider adapter and the chain reads both run on it.
 */
import type { Network } from '@ambire-common/interfaces/network'
import { getRpcProvider } from '@ambire-common/services/provider/getRpcProvider'

import { CHAIN_IDS, RecoveryChain } from './chains'
import type { ExtensionRpc } from './provider-adapter'

/** The extension's provider as this lane holds it: the JSON-RPC request and its teardown. */
export interface ExtensionProvider extends ExtensionRpc {
  destroy(): void
}

/** The network record of a recovery chain among the networks the extension holds. */
export const networkOf = (
  networks: readonly Network[] | undefined,
  chain: RecoveryChain
): Network | undefined =>
  (networks ?? []).find((network) => Number(network.chainId) === CHAIN_IDS[chain])

/** Builds the extension's provider for one network record. The caller destroys it. */
export const extensionProviderFor = (network: Network): ExtensionProvider => getRpcProvider(network)
