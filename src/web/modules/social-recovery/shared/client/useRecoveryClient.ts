/**
 * The hook that hands a screen the recovery kit client for one account, built
 * over the extension's own provider for the one chain this build reads, with
 * the balance and gas reads on the same provider beside it.
 *
 * A refused digest version comes back as the `update-the-wallet` state the
 * account step draws; any other failure as `failed`, with `retry`, never as an
 * empty answer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import useNetworksControllerState from '@web/hooks/useNetworksControllerState'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { addressBookOf } from './addresses'
import {
  buildRecoveryClient,
  DigestVersionRefusal,
  isDigestVersionRefusal,
  RecoveryKitClient
} from './build-client'
import { ChainReads, createChainReads } from './chain-reads'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from './chains'
import type { AccountFacts } from './configuration'
import { extensionProviderFor, networkOf, providerKeyOf } from './extension-provider'
import { createProviderAdapter } from './provider-adapter'

export type RecoveryClientState =
  | { status: 'loading' }
  | { status: 'ready'; client: RecoveryKitClient; reads: ChainReads }
  | { status: 'update-the-wallet'; refusal: DigestVersionRefusal }
  | { status: 'failed'; error: unknown }

export const useRecoveryClient = (
  account: Address | undefined,
  facts: AccountFacts = {}
): RecoveryClientState & { retry: () => void } => {
  const { networks } = useNetworksControllerState()
  const network = networkOf(networks, WALLET_RECOVERY_CHAIN)
  const networkRef = useRef(network)
  networkRef.current = network
  // A change to any field the provider is built from rebuilds the provider
  // and the client; the effect's cleanup destroys the previous provider first.
  const networkKey = network ? providerKeyOf(network) : networks ? 'missing' : 'loading'
  const factsKey = JSON.stringify(facts)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RecoveryClientState>({ status: 'loading' })

  useEffect(() => {
    const current = networkRef.current
    if (!account || networkKey === 'loading') {
      setState({ status: 'loading' })
      return undefined
    }
    if (!current) {
      setState({
        status: 'failed',
        error: new Error(
          `The extension holds no network for chain ${CHAIN_IDS[WALLET_RECOVERY_CHAIN]}.`
        )
      })
      return undefined
    }
    let live = true
    setState({ status: 'loading' })
    const provider = extensionProviderFor(current)
    buildRecoveryClient({
      ...(JSON.parse(factsKey) as AccountFacts),
      chain: WALLET_RECOVERY_CHAIN,
      account,
      addressBook: addressBookOf(WALLET_RECOVERY_CHAIN),
      provider: createProviderAdapter(provider)
    })
      .then((client) => {
        if (live) setState({ status: 'ready', client, reads: createChainReads(provider) })
      })
      .catch((error: unknown) => {
        if (!live) return
        setState(
          isDigestVersionRefusal(error)
            ? { status: 'update-the-wallet', refusal: error }
            : { status: 'failed', error }
        )
      })
    return () => {
      live = false
      provider.destroy()
    }
  }, [account, networkKey, factsKey, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { ...state, retry }
}
