/**
 * The wallet reads who holds a privilege on an account with its own account
 * code over the extension's provider: the privileges the account's creation
 * writes where the account has no code, and the account's `privileges` view
 * where it has code. The entry point is never answered as a key, and a read
 * the provider could not make answers `unreadable` with its cause.
 */
import { Interface, toBeHex } from 'ethers'

import { ERC_4337_ENTRYPOINT } from '@ambire-common/consts/deploy'
import { addressOf } from '@web/modules/social-recovery/sdk-doubles'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import {
  createPrivilegeReads,
  createWorld,
  MAINNET,
  PrivilegeAccount,
  PrivilegeReadsProvider,
  World
} from './harness'

const accountView = new Interface(['function privileges(address) view returns (bytes32)'])

const PRIVILEGED = toBeHex(1, 32)
const UNPRIVILEGED = toBeHex(0, 32)
const ENTRY_POINT = ERC_4337_ENTRYPOINT as Address

const providerOf = (world: World): PrivilegeReadsProvider =>
  world.ethers as unknown as PrivilegeReadsProvider

/** The world's account, deployed, whose `privileges` view marks `holders` non-zero. */
const deployedWith = (world: World, holders: Address[]): void => {
  world.ethers.getCode.mockResolvedValue('0x6080')
  world.ethers.call.mockImplementation(async (tx: { to?: string; data?: string }) => {
    if (tx.to?.toLowerCase() !== world.account.toLowerCase()) {
      return '0x'
    }
    const [key] = accountView.decodeFunctionData('privileges', tx.data ?? '0x')
    const holds = holders.some((holder) => holder.toLowerCase() === String(key).toLowerCase())
    return accountView.encodeFunctionResult('privileges', [holds ? PRIVILEGED : UNPRIVILEGED])
  })
}

const queriedKeys = (world: World): string[] =>
  world.ethers.call.mock.calls.map(([tx]: [{ data: string }]) =>
    String(accountView.decodeFunctionData('privileges', tx.data)[0])
  )

const lower = (keys: readonly string[]): string[] => keys.map((key) => key.toLowerCase()).sort()

describe('the privilege holders read', () => {
  const keyA = addressOf('key-a')
  const keyB = addressOf('key-b')
  const keyC = addressOf('key-c')
  const known = addressOf('known-key')

  it('answers the non-zero initial privileges of an account with no code, without the entry point', async () => {
    const world = createWorld()
    const account: PrivilegeAccount = {
      addr: world.account,
      associatedKeys: [keyC],
      initialPrivileges: [
        [keyA, PRIVILEGED],
        [keyB, UNPRIVILEGED],
        [ENTRY_POINT, PRIVILEGED]
      ]
    }
    const reading = await createPrivilegeReads(providerOf(world), [known]).privilegeHoldersOf(
      account,
      world.descriptor.chainId
    )
    expect(reading).toEqual({ kind: 'holders', keys: [keyA] })
    expect(world.ethers.getCode).toHaveBeenCalledWith(world.account)
    expect(world.ethers.call).not.toHaveBeenCalled()
  })

  it('answers the keys the deployed account marks privileged among the known and associated keys, once each', async () => {
    const world = createWorld()
    deployedWith(world, [known, keyA, ENTRY_POINT])
    const account: PrivilegeAccount = {
      addr: world.account,
      associatedKeys: [keyA, keyB, `0x${known.slice(2).toUpperCase()}` as Address],
      initialPrivileges: [[keyC, PRIVILEGED]]
    }
    const reading = await createPrivilegeReads(providerOf(world), [
      known,
      ENTRY_POINT
    ]).privilegeHoldersOf(account, BigInt(world.descriptor.chainId))
    expect(reading.kind).toBe('holders')
    if (reading.kind !== 'holders') {
      return
    }
    expect(lower(reading.keys)).toEqual(lower([known, keyA]))
    expect(lower(queriedKeys(world))).toEqual(lower([known, keyA, keyB]))
  })

  it('answers no holders for a deployed account whose view marks none of the keys', async () => {
    const world = createWorld()
    deployedWith(world, [keyC])
    const account: PrivilegeAccount = {
      addr: world.account,
      associatedKeys: [keyA],
      initialPrivileges: [[keyA, PRIVILEGED]]
    }
    const reading = await createPrivilegeReads(providerOf(world)).privilegeHoldersOf(
      account,
      world.descriptor.chainId
    )
    expect(reading).toEqual({ kind: 'holders', keys: [] })
  })

  it('answers unreadable when the provider is on another chain, before it reads the account', async () => {
    const world = createWorld()
    world.ethers.answeredChainId = MAINNET
    const account: PrivilegeAccount = {
      addr: world.account,
      associatedKeys: [keyA],
      initialPrivileges: [[keyA, PRIVILEGED]]
    }
    const reading = await createPrivilegeReads(providerOf(world)).privilegeHoldersOf(
      account,
      world.descriptor.chainId
    )
    expect(reading.kind).toBe('unreadable')
    expect(world.ethers.getCode).not.toHaveBeenCalled()
    expect(world.ethers.call).not.toHaveBeenCalled()
  })

  it('answers unreadable with the message when the provider throws on the code read', async () => {
    const world = createWorld()
    world.ethers.getCode.mockRejectedValue(new Error('the node is down'))
    const account: PrivilegeAccount = {
      addr: world.account,
      associatedKeys: [keyA],
      initialPrivileges: [[keyA, PRIVILEGED]]
    }
    const reading = await createPrivilegeReads(providerOf(world)).privilegeHoldersOf(
      account,
      world.descriptor.chainId
    )
    expect(reading).toEqual({ kind: 'unreadable', cause: 'the node is down' })
  })

  it('answers unreadable with the message when a privileges view call throws', async () => {
    const world = createWorld()
    world.ethers.getCode.mockResolvedValue('0x6080')
    world.ethers.call.mockRejectedValue(new Error('the call timed out'))
    const account: PrivilegeAccount = {
      addr: world.account,
      associatedKeys: [keyA],
      initialPrivileges: []
    }
    const reading = await createPrivilegeReads(providerOf(world)).privilegeHoldersOf(
      account,
      world.descriptor.chainId
    )
    expect(reading).toEqual({ kind: 'unreadable', cause: 'the call timed out' })
  })
})
