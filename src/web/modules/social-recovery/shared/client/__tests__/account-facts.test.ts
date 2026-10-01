/**
 * The facts the wallet holds for one listed account on the recovery chain,
 * read from its own state: the accounts it lists with their state on each
 * chain, the keys the keystore holds and the networks. Each source is the
 * shape the background pushes; the accounts are the account library's own.
 */
import { Wallet } from 'ethers'

import type { Account, AccountStates } from '@ambire-common/interfaces/account'
import { dedicatedToOneSAPriv } from '@ambire-common/interfaces/keystore'
import { getBasicAccount, getSmartAccount } from '@ambire-common/libs/account/account'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import {
  accountFactsOf,
  AccountFactsSources,
  CHAIN_IDS,
  clientFactsOf,
  CONTROLLING_KEY,
  CREATION_BLOCK_STAND_IN,
  creationRecordOf,
  MAINNET,
  networkRecord,
  onchainState,
  WALLET_RECOVERY_CHAIN
} from './harness'

const SECOND_KEY = new Wallet(`0x${'66'.repeat(32)}`).address as Address
const BASIC = new Wallet(`0x${'77'.repeat(32)}`).address as Address
const STRANGER = new Wallet(`0x${'88'.repeat(32)}`).address as Address

const CHAIN = String(CHAIN_IDS[WALLET_RECOVERY_CHAIN])
const NETWORK = networkRecord(WALLET_RECOVERY_CHAIN)

let smart: Account
let twoKeys: Account
let basic: Account

beforeAll(async () => {
  smart = await getSmartAccount([{ addr: CONTROLLING_KEY, hash: dedicatedToOneSAPriv }], [])
  twoKeys = await getSmartAccount(
    [
      { addr: CONTROLLING_KEY, hash: dedicatedToOneSAPriv },
      { addr: SECOND_KEY, hash: dedicatedToOneSAPriv }
    ],
    []
  )
  basic = getBasicAccount(BASIC, [])
})

/** Each listed account's state on the recovery chain, deployed unless named in `undeployed`. */
const statesOf = (accounts: Account[], undeployed: string[] = []): AccountStates =>
  Object.fromEntries(
    accounts.map((account) => [
      account.addr,
      {
        [CHAIN]: onchainState(account.addr, {
          isDeployed: !undeployed.includes(account.addr),
          isEOA: !account.creation
        })
      }
    ])
  )

/** The wallet's state listing every account, with the controlling key in the keystore. */
const sourcesOf = (overrides: Partial<AccountFactsSources> = {}): AccountFactsSources => {
  const accounts = [basic, smart, twoKeys]
  return {
    accounts,
    accountStates: statesOf(accounts),
    keys: [{ addr: CONTROLLING_KEY, type: 'internal' }],
    networks: [NETWORK],
    ...overrides
  }
}

const readyFacts = (address: Address, sources: AccountFactsSources) => {
  const reading = accountFactsOf(address, sources)
  if (reading.status !== 'ready') throw new Error(`The facts are ${reading.status}, not ready.`)
  return reading.facts
}

describe("a listed account's creation record", () => {
  it("is a smart account's factory, bytecode and salt, at the stand-in block", () => {
    expect(creationRecordOf(smart)).toEqual({
      factory: smart.creation?.factoryAddr,
      bytecode: smart.creation?.bytecode,
      salt: smart.creation?.salt,
      block: CREATION_BLOCK_STAND_IN
    })
  })

  it('is absent for a basic account', () => {
    expect(creationRecordOf(basic)).toBeUndefined()
  })
})

describe("a listed account's client facts", () => {
  it("are a smart account's creation record and every associated key, in order", () => {
    expect(clientFactsOf(twoKeys)).toEqual({
      creation: creationRecordOf(twoKeys),
      candidateKeys: [CONTROLLING_KEY, SECOND_KEY]
    })
  })

  it('are none for a basic account, so its client reads as one built with no facts', () => {
    expect(clientFactsOf(basic)).toEqual({})
  })
})

describe("the account's facts on the recovery chain", () => {
  it("read a deployed smart account: its record, state and network, its code, the keystore's key and its creation record", () => {
    const sources = sourcesOf()
    expect(accountFactsOf(smart.addr as Address, sources)).toEqual({
      status: 'ready',
      facts: {
        account: smart,
        state: sources.accountStates?.[smart.addr][CHAIN],
        network: NETWORK,
        deployed: true,
        key: { addr: CONTROLLING_KEY, type: 'internal' },
        creation: creationRecordOf(smart)
      }
    })
  })

  it('read a smart account with no code yet as not deployed, with the same key and creation record', () => {
    const accounts = [smart]
    const facts = readyFacts(
      smart.addr as Address,
      sourcesOf({ accounts, accountStates: statesOf(accounts, [smart.addr]) })
    )
    expect(facts.deployed).toBe(false)
    expect(facts.state.isDeployed).toBe(false)
    expect(facts.key).toEqual({ addr: CONTROLLING_KEY, type: 'internal' })
    expect(facts.creation).toEqual(creationRecordOf(smart))
  })

  it("hand the key with the keystore's own type", () => {
    const facts = readyFacts(
      smart.addr as Address,
      sourcesOf({ keys: [{ addr: CONTROLLING_KEY, type: 'trezor' }] })
    )
    expect(facts.key).toEqual({ addr: CONTROLLING_KEY, type: 'trezor' })
  })

  it('find the key and the account whatever the case of the addresses', () => {
    const facts = readyFacts(
      smart.addr.toLowerCase() as Address,
      sourcesOf({ keys: [{ addr: CONTROLLING_KEY.toLowerCase(), type: 'internal' }] })
    )
    expect(facts.account).toBe(smart)
    expect(facts.key?.addr).toBe(CONTROLLING_KEY.toLowerCase())
  })

  it('read a view-only account, whose keys the keystore holds none of, with no key', () => {
    const facts = readyFacts(
      smart.addr as Address,
      sourcesOf({ keys: [{ addr: STRANGER, type: 'internal' }] })
    )
    expect(facts).not.toHaveProperty('key')
    expect(facts.deployed).toBe(true)
    expect(facts.creation).toEqual(creationRecordOf(smart))
  })

  it("read a basic account with no creation record, its own address as the keystore's key", () => {
    const facts = readyFacts(
      basic.addr as Address,
      sourcesOf({ keys: [{ addr: BASIC, type: 'internal' }] })
    )
    expect(facts).not.toHaveProperty('creation')
    expect(facts.key).toEqual({ addr: BASIC, type: 'internal' })
  })

  describe('of an account with several associated keys', () => {
    it('hand the one the keystore holds, where it holds a later one only', () => {
      const facts = readyFacts(
        twoKeys.addr as Address,
        sourcesOf({ keys: [{ addr: SECOND_KEY, type: 'ledger' }] })
      )
      expect(facts.key).toEqual({ addr: SECOND_KEY, type: 'ledger' })
    })

    it("hand the first in the account's own order where the keystore holds several, whatever the keystore's order", () => {
      const facts = readyFacts(
        twoKeys.addr as Address,
        sourcesOf({
          keys: [
            { addr: SECOND_KEY, type: 'ledger' },
            { addr: CONTROLLING_KEY, type: 'internal' }
          ]
        })
      )
      expect(facts.key).toEqual({ addr: CONTROLLING_KEY, type: 'internal' })
    })
  })

  it('read an account the wallet does not list as unavailable, not listed', () => {
    expect(accountFactsOf(STRANGER, sourcesOf())).toEqual({
      status: 'unavailable',
      cause: 'not-listed'
    })
  })

  it('read the facts as unavailable where the wallet holds no network for the recovery chain', () => {
    const elsewhere = networkRecord('mainnet')
    expect(Number(elsewhere.chainId)).toBe(MAINNET)
    expect(accountFactsOf(smart.addr as Address, sourcesOf({ networks: [elsewhere] }))).toEqual({
      status: 'unavailable',
      cause: 'no-network'
    })
  })

  it("read as loading while the wallet has not read the account's state on the recovery chain", () => {
    const accounts = [smart]
    const onAnotherChain: AccountStates = {
      [smart.addr]: { [String(MAINNET)]: onchainState(smart.addr) }
    }
    expect(
      accountFactsOf(smart.addr as Address, sourcesOf({ accounts, accountStates: {} }))
    ).toEqual({ status: 'loading' })
    expect(
      accountFactsOf(smart.addr as Address, sourcesOf({ accounts, accountStates: onAnotherChain }))
    ).toEqual({ status: 'loading' })
  })

  it('read as loading with no account given', () => {
    expect(accountFactsOf(undefined, sourcesOf())).toEqual({ status: 'loading' })
  })

  const SOURCES: (keyof AccountFactsSources)[] = ['accounts', 'accountStates', 'keys', 'networks']
  SOURCES.forEach((source) =>
    it(`read as loading until the background pushed ${source}, even for an account it does not list`, () => {
      expect(accountFactsOf(smart.addr as Address, sourcesOf({ [source]: undefined }))).toEqual({
        status: 'loading'
      })
      expect(accountFactsOf(STRANGER, sourcesOf({ [source]: undefined }))).toEqual({
        status: 'loading'
      })
    })
  )
})
