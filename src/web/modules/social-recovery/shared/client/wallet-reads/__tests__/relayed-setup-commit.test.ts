/**
 * The key a recovery would remove from an account the wallet does not list,
 * where a relayer sent the transaction that carried the account's latest
 * setup commit: the key whose signature the account ran names the key, the
 * relayer stays a candidate, and every candidate still has to hold a
 * privilege on the account and count as an authority at the action. The
 * creation privileges are the only privilege the key holds, so no privilege
 * write names it; the account's writes name the action's slot alone.
 */
import { getAddress, slice } from 'viem'

import { creationPrivileges, kitBinding, kitSlot } from '@kohaku-eth/social-recovery'
import type { Address, BlockTag, Hex } from '@kohaku-eth/social-recovery'
import {
  deployAndExecuteInput,
  executeInput,
  NONCE_SELECTOR,
  nonceAnswer,
  relayedAccount,
  SIGNING_KEY,
  signedBatch
} from '@web/modules/social-recovery/shared/client/__fixtures__/relayed-save'
import {
  ACCOUNT,
  ACTION,
  DEPLOYED_AT,
  HEAD,
  KEY_A
} from '@web/modules/social-recovery/shared/client/__fixtures__/scripted-provider'
import type { RelayedAccount } from '@web/modules/social-recovery/shared/client/__fixtures__/types'
import { providerReadFailure } from '@web/modules/social-recovery/shared/client/provider-adapter'
import {
  commitAt,
  HOLDS,
  named,
  privilegeLog,
  RELAYER,
  same,
  worldOf
} from '@web/modules/social-recovery/shared/client/wallet-reads/__fixtures__/world'

jest.mock('@kohaku-eth/social-recovery', () => {
  const actual = jest.requireActual('@kohaku-eth/social-recovery')
  return { ...actual, creationPrivileges: jest.fn(actual.creationPrivileges) }
})

const { creationPrivileges: actualCreationPrivileges } = jest.requireActual(
  '@kohaku-eth/social-recovery'
)

const SIGNER = getAddress(SIGNING_KEY.address)

let relayed: RelayedAccount

beforeAll(async () => {
  relayed = await relayedAccount()
})

beforeEach(() => {
  // The world's account stands for the account this creation code produces at the factory.
  ;(creationPrivileges as jest.Mock).mockImplementation(
    (factory: Address, code: Hex, salt: Hex) => {
      const real = actualCreationPrivileges(factory, code, salt)
      return same(factory, relayed.factory) && code === relayed.code
        ? { ...real, account: ACCOUNT }
        : real
    }
  )
})

const slotOnly = () => privilegeLog(kitSlot(ACTION), kitBinding(ACTION), DEPLOYED_AT + 5)

/** A world whose latest commit a relayer sent with `input` to `to`. */
const relayedWorld = (to: Address, input: Hex, holders: Address[], authorities = holders) => {
  const commit = commitAt(DEPLOYED_AT + 10)
  return worldOf({
    logs: [commit, slotOnly()],
    senders: [[commit.transactionHash, RELAYER, { to, input }]],
    holders,
    authorities
  })
}

/**
 * Answers the account's `nonce()` by the block asked: `before` at the block
 * before the head the scripted transaction lands in, one more at the head.
 */
const answerNonce = (
  world: ReturnType<typeof worldOf>,
  before: bigint,
  failure?: Error
): BlockTag[] => {
  const askedAt: BlockTag[] = []
  const scripted = world.node.provider.call.getMockImplementation()
  world.node.provider.call.mockImplementation(
    async (to: Address, data: Hex, from: Address, block: BlockTag) => {
      if (same(to, ACCOUNT) && same(slice(data, 0, 4), NONCE_SELECTOR)) {
        askedAt.push(block)
        if (failure) {
          throw failure
        }
        return nonceAnswer(block === HEAD - 1 ? before : before + 1n)
      }
      return scripted?.(to, data, from, block)
    }
  )
  return askedAt
}

describe('a setup commit a relayer sent in the deployment of the account', () => {
  it('names the key that signed the deployed batch', async () => {
    const batch = await signedBatch(SIGNING_KEY, ACCOUNT, 0n)
    const { reads, askedPrivileges } = relayedWorld(
      relayed.factory,
      deployAndExecuteInput(relayed, batch),
      [SIGNER]
    )
    await expect(reads.removedKey()).resolves.toEqual(named(SIGNER))
    expect(askedPrivileges()).toEqual(expect.arrayContaining([SIGNER.toLowerCase()]))
    expect(askedPrivileges()).toEqual(expect.arrayContaining([RELAYER.toLowerCase()]))
  })

  it('leaves the key unnamed where the transaction carries no signature to read', async () => {
    const { reads } = relayedWorld(relayed.factory, '0x', [SIGNER])
    const reading = await reads.removedKey()
    expect(reading.kind).toBe('unavailable')
  })

  it('drops a signer that holds no privilege, and the read answers as without it', async () => {
    const batch = await signedBatch(SIGNING_KEY, ACCOUNT, 0n)
    const without = await relayedWorld(relayed.factory, '0x', []).reads.removedKey()
    const { reads, askedPrivileges } = relayedWorld(
      relayed.factory,
      deployAndExecuteInput(relayed, batch),
      []
    )
    await expect(reads.removedKey()).resolves.toEqual(without)
    expect(askedPrivileges()).toContain(SIGNER.toLowerCase())
  })

  it('drops a signer the action does not count as an authority, and a privilege write still names the key', async () => {
    const batch = await signedBatch(SIGNING_KEY, ACCOUNT, 0n)
    const commit = commitAt(DEPLOYED_AT + 10)
    const { reads } = worldOf({
      logs: [commit, slotOnly(), privilegeLog(KEY_A, HOLDS, DEPLOYED_AT + 3)],
      senders: [
        [
          commit.transactionHash,
          RELAYER,
          { to: relayed.factory, input: deployAndExecuteInput(relayed, batch) }
        ]
      ],
      holders: [SIGNER, KEY_A],
      authorities: [KEY_A]
    })
    await expect(reads.removedKey()).resolves.toEqual(named(KEY_A))
  })
})

describe('a setup commit a relayer sent as a call to the deployed account', () => {
  it('names the key that signed the batch at the nonce the account held the block before', async () => {
    const batch = await signedBatch(SIGNING_KEY, ACCOUNT, 3n)
    const world = relayedWorld(ACCOUNT, executeInput(batch), [SIGNER])
    const askedAt = answerNonce(world, 3n)
    await expect(world.reads.removedKey()).resolves.toEqual(named(SIGNER))
    expect(askedAt).toEqual([HEAD - 1])
  })

  it('rejects where the nonce read fails on the network, never answering a refusal', async () => {
    const batch = await signedBatch(SIGNING_KEY, ACCOUNT, 3n)
    const world = relayedWorld(ACCOUNT, executeInput(batch), [SIGNER])
    const failure = providerReadFailure('call', new Error('timeout'))
    answerNonce(world, 3n, failure)
    await expect(world.reads.removedKey()).rejects.toBe(failure)
  })
})

describe('a setup commit the key sent itself', () => {
  it('names the sender, once, where its own call names it too', async () => {
    const batch = await signedBatch(SIGNING_KEY, ACCOUNT, 3n)
    const commit = commitAt(DEPLOYED_AT + 10)
    const world = worldOf({
      logs: [commit, slotOnly()],
      senders: [[commit.transactionHash, SIGNER, { to: ACCOUNT, input: executeInput(batch) }]],
      holders: [SIGNER],
      authorities: [SIGNER]
    })
    answerNonce(world, 3n)
    await expect(world.reads.removedKey()).resolves.toEqual(named(SIGNER))
  })

  it('names the sender where the transaction carries no signature to read', async () => {
    const commit = commitAt(DEPLOYED_AT + 10)
    const { reads } = worldOf({
      logs: [commit, slotOnly()],
      senders: [[commit.transactionHash, SIGNER]],
      holders: [SIGNER],
      authorities: [SIGNER]
    })
    await expect(reads.removedKey()).resolves.toEqual(named(SIGNER))
  })
})
