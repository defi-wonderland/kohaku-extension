/**
 * The ceremony tab's resolver: it finds the ceremony a request id names in the
 * wallet's records and hands the tab the approving side and the method
 * implementation of the client built for the request's account and chain.
 */
import type { Network } from '@ambire-common/interfaces/network'
import type { CeremonyResolver } from '@web/modules/social-recovery/shared/ceremony'

import { addressBookOf } from './addresses'
import { buildRecoveryClient } from './build-client'
import { CHAIN_IDS, recoveryChainOf } from './chains'
import { extensionProviderFor, networkOf } from './extension-provider'
import { createProviderAdapter } from './provider-adapter'
import type { CeremonyClientFor, CeremonyResolverOptions } from './types'

/**
 * Resolves a ceremony from the request stored under its id. Null where no
 * request is stored, where the stored one is for another call or method than
 * the tab's route names, and where the client holds no implementation of its
 * method: nothing this tab can run waits under the id. A client that cannot be
 * built rejects, and the tab reads it as unavailable with retry.
 *
 * No device is resolved: the tab runs the page's own passkey device, and a
 * method whose material the caller already holds needs no ceremony tab.
 */
export const createCeremonyResolver =
  ({ records, clientFor }: CeremonyResolverOptions): CeremonyResolver =>
  async (params) => {
    const read = await records.ceremonyRequest(params.id).read()
    if (read.status === 'absent') return null
    const stored = read.value
    if (stored.call !== params.call || stored.method !== params.method) return null

    const client = await clientFor(stored.account, stored.chainId)
    const method = client.methodFor(stored.method)
    if (!method) return null
    const orchestrator = client.approving

    switch (stored.call) {
      case 'enroll':
        return { orchestrator, method, methodAddress: stored.methodAddress, params: stored.params }
      case 'testAccess':
      case 'createClaim':
        return { orchestrator, method, request: stored.request, params: stored.params }
      case 'healthCheck':
      default:
        return { orchestrator, method }
    }
  }

/**
 * Builds the client for an account on a recovery chain the way the hook does,
 * over the extension's own provider for that chain's network among
 * `networks()`. A ceremony uses only the approving side, which reads no chain,
 * so the provider is destroyed once the build settles. Rejects for a chain
 * this build reads no recovery on, or one the extension holds no network for.
 */
export const extensionClientFor =
  (networks: () => readonly Network[] | undefined): CeremonyClientFor =>
  async (account, chainId) => {
    const chain = recoveryChainOf(chainId)
    if (!chain) throw new Error(`Chain ${String(chainId)} carries no recovery deployment.`)
    const network = networkOf(networks(), chain)
    if (!network) throw new Error(`The extension holds no network for chain ${CHAIN_IDS[chain]}.`)
    const provider = extensionProviderFor(network)
    try {
      return await buildRecoveryClient({
        chain,
        account,
        addressBook: addressBookOf(chain),
        provider: createProviderAdapter(provider)
      })
    } finally {
      provider.destroy()
    }
  }
