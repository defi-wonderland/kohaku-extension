/**
 * A guardian's name resolves on Ethereum mainnet through public endpoints
 * tried in order: the name is normalised first, an endpoint that throws hands
 * the read to the next, an answer of no address is final, and every reader is
 * destroyed after its read. No test reaches the network.
 */
import { JsonRpcProvider } from 'ethers'

import type { NameReaderFactory } from '@web/modules/social-recovery/setup/enroll/types'
import type { FakeNameReaders } from '@web/modules/social-recovery/setup/enroll/__tests__/harness'
import {
  mainnetNameReader,
  resolveMainnetName
} from '@web/modules/social-recovery/setup/enroll/names'

const ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const FIRST_URL = 'https://ethereum-rpc.publicnode.com'
const SECOND_URL = 'https://cloudflare-eth.com'

/** One answer per endpoint, in the order the endpoints are read: an address, null, or a throw. */
const fakeReaders = (...answers: (string | null | Error)[]): FakeNameReaders => {
  const urls: string[] = []
  const names: string[] = []
  const destroyed: string[] = []
  const readerOf: NameReaderFactory = (rpcUrl) => {
    const answer = answers[urls.length]
    urls.push(rpcUrl)
    return {
      resolveName: async (name) => {
        names.push(name)
        if (answer instanceof Error) {
          throw answer
        }
        return answer ?? null
      },
      destroy: () => {
        destroyed.push(rpcUrl)
      }
    }
  }
  return { readerOf, urls, names, destroyed }
}

describe('the mainnet name resolver', () => {
  it('reads a mixed-case name as its lower-case form on the first endpoint', async () => {
    const readers = fakeReaders(ADDRESS)
    expect(await resolveMainnetName('BlueJay.ETH', readers.readerOf)).toBe(ADDRESS)
    expect(readers.names).toEqual(['bluejay.eth'])
    expect(readers.urls).toEqual([FIRST_URL])
    expect(readers.destroyed).toEqual([FIRST_URL])
  })

  it('reads the second endpoint when the first throws, and destroys both readers', async () => {
    const readers = fakeReaders(new Error('rate limited'), ADDRESS)
    expect(await resolveMainnetName('bluejay.eth', readers.readerOf)).toBe(ADDRESS)
    expect(readers.urls).toEqual([FIRST_URL, SECOND_URL])
    expect(readers.names).toEqual(['bluejay.eth', 'bluejay.eth'])
    expect(readers.destroyed).toEqual([FIRST_URL, SECOND_URL])
  })

  it('reads a name with no address as unresolved and asks no other endpoint', async () => {
    const readers = fakeReaders(null, ADDRESS)
    expect(await resolveMainnetName('nobody.eth', readers.readerOf)).toBe('')
    expect(readers.urls).toEqual([FIRST_URL])
    expect(readers.destroyed).toEqual([FIRST_URL])
  })

  it('reads a name as unresolved when every endpoint throws, and destroys every reader', async () => {
    const readers = fakeReaders(new Error('down'), new Error('down too'))
    expect(await resolveMainnetName('bluejay.eth', readers.readerOf)).toBe('')
    expect(readers.urls).toEqual([FIRST_URL, SECOND_URL])
    expect(readers.destroyed).toEqual([FIRST_URL, SECOND_URL])
  })

  it('reads a name that does not normalise as unresolved without asking any endpoint', async () => {
    const readers = fakeReaders(ADDRESS)
    expect(await resolveMainnetName('blue_jay.eth', readers.readerOf)).toBe('')
    expect(readers.urls).toEqual([])
  })

  it('builds its default reader on mainnet, with the name registry and the given endpoint', async () => {
    const reader = mainnetNameReader(FIRST_URL)
    try {
      // The provider comes from the commons' own copy of ethers, so it is read by shape.
      const provider = reader as unknown as JsonRpcProvider
      const network = await provider.getNetwork()
      expect(network.chainId).toBe(1n)
      expect(network.getPlugin('org.ethers.plugins.network.Ens')).not.toBeNull()
      expect(provider._getConnection().url).toBe(FIRST_URL)
    } finally {
      reader.destroy()
    }
  })
})
