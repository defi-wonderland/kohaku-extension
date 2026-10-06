/**
 * A guardian's name resolves on Ethereum mainnet, where names live, whatever
 * chain the recovery runs on. The wallet configures no mainnet RPC, so the
 * reads go to public endpoints, tried in order, for name reads only. A name
 * that does not normalise, or that no endpoint could read, resolves to nothing.
 */
import { normalize } from 'viem/ens'

import { getRpcProvider } from '@ambire-common/services/provider/getRpcProvider'

import type { NameReaderFactory } from './types'

const MAINNET_CHAIN_ID = 1n

const MAINNET_NAME_RPC_URLS = [
  'https://ethereum-rpc.publicnode.com',
  'https://cloudflare-eth.com'
] as const

/** A plain JSON-RPC provider on mainnet; ethers knows mainnet's name registry from the chain id. */
export const mainnetNameReader: NameReaderFactory = (rpcUrl) =>
  getRpcProvider({ chainId: MAINNET_CHAIN_ID, rpcUrls: [rpcUrl] }, true)

/** One endpoint's answer for a normalised name; its provider is destroyed after the read. */
const readNameOn = async (
  normalized: string,
  rpcUrl: string,
  readerOf: NameReaderFactory
): Promise<string | null> => {
  const reader = readerOf(rpcUrl)
  try {
    return await reader.resolveName(normalized)
  } finally {
    reader.destroy()
  }
}

/**
 * Resolves a name to an address on mainnet, the empty string where nothing
 * resolves. An endpoint that throws hands the read to the next one; an answer
 * of no address is final.
 */
export const resolveMainnetName = async (
  name: string,
  readerOf: NameReaderFactory = mainnetNameReader
): Promise<string> => {
  let normalized: string
  try {
    normalized = normalize(name)
  } catch {
    return ''
  }
  return MAINNET_NAME_RPC_URLS.reduce<Promise<string | null>>(
    (previous, rpcUrl) => previous.catch(() => readNameOn(normalized, rpcUrl, readerOf)),
    Promise.reject(new Error('No endpoint read the name yet'))
  ).then(
    (address) => address ?? '',
    () => ''
  )
}
