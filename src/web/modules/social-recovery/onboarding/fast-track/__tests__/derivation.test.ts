/**
 * The fast track's key, sending key and gas check on a fixed public phrase:
 * the key the recovery installs is the library's key at the slot's index
 * plus the smart-account offset, the wallet finds that key's smart account,
 * and the recovery is sent and paid by the slot's ordinary key.
 */
import {
  BIP44_STANDARD_DERIVATION_TEMPLATE,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '@ambire-common/consts/derivation'
import { dedicatedToOneSAPriv } from '@ambire-common/interfaces/keystore'
import { getBasicAccount, getSmartAccount } from '@ambire-common/libs/account/account'
import { KeyIterator } from '@ambire-common/libs/keyIterator/keyIterator'
import {
  accountStepPathOf,
  acknowledgedOf,
  fastTrackSendingKeyOf,
  listedSlotOf,
  SLOT_INDEX,
  slotKeysOf,
  submissionCheckOf,
  tempSeedOf
} from '@web/modules/social-recovery/onboarding/fast-track'
import type { Account } from '@ambire-common/interfaces/account'
import type { Key } from '@ambire-common/interfaces/keystore'
import type { TempSeed } from '@web/modules/social-recovery/onboarding/fast-track'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import slot from '@web/modules/social-recovery/onboarding/fast-track/__fixtures__/slot.json'

const TEST_PHRASE = slot.phrase
const ORDINARY_KEY = slot.ordinaryKey as Address
const CONTROLLING_KEY = slot.controllingKey as Address
const SMART_ACCOUNT = slot.smartAccount as Address
const SEED_ID = slot.seedId

const internalKey = (addr: Address, dedicatedToOneSA: boolean): Key => ({
  addr,
  type: 'internal',
  label: addr,
  dedicatedToOneSA,
  meta: { createdAt: 1, fromSeedId: SEED_ID },
  isExternallyStored: false
})

const slotKeys: Key[] = [internalKey(ORDINARY_KEY, false), internalKey(CONTROLLING_KEY, true)]
const basicAccount: Account = getBasicAccount(ORDINARY_KEY, [])
let smartAccount: Account
let slotAccounts: Account[]

beforeAll(async () => {
  smartAccount = await getSmartAccount([{ addr: CONTROLLING_KEY, hash: dedicatedToOneSAPriv }], [])
  slotAccounts = [basicAccount, smartAccount]
})

const SEED: TempSeed = {
  seed: TEST_PHRASE,
  seedPassphrase: null,
  hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
}

const libraryKeyAt = async (index: number): Promise<string> => {
  const [key] = await new KeyIterator(TEST_PHRASE, null).retrieve(
    [{ from: index, to: index }],
    BIP44_STANDARD_DERIVATION_TEMPLATE
  )
  return key
}

describe('the key that will control the recovered account', () => {
  it('is the library key at the slot index plus the smart-account offset', async () => {
    const expected = await libraryKeyAt(SLOT_INDEX + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET)

    const { controllingKey, ordinaryKey } = await slotKeysOf(SEED)

    expect(controllingKey).toBe(expected)
    expect(controllingKey).toBe(CONTROLLING_KEY)
    expect(ordinaryKey).toBe(await libraryKeyAt(SLOT_INDEX))
    expect(ordinaryKey).toBe(ORDINARY_KEY)
    expect(controllingKey).not.toBe(ordinaryKey)
  })

  it('names the smart account the wallet builds for that key, beside the basic account', async () => {
    expect(smartAccount.addr).toBe(SMART_ACCOUNT)
    expect(listedSlotOf(await slotKeysOf(SEED), slotAccounts, slotKeys)).toEqual({
      basicAccount: ORDINARY_KEY,
      smartAccount: SMART_ACCOUNT
    })
  })

  it('finds no slot where the smart account answers to a key derived another way', async () => {
    const keys = await slotKeysOf(SEED)
    const otherSmart = { ...smartAccount, associatedKeys: [ORDINARY_KEY] }

    expect(listedSlotOf(keys, [basicAccount, otherSmart], slotKeys)).toBeNull()
  })

  it('finds no slot until the keystore holds both keys', async () => {
    const keys = await slotKeysOf(SEED)

    expect(listedSlotOf(keys, slotAccounts, [slotKeys[0]])).toBeNull()
    expect(listedSlotOf(keys, slotAccounts, [slotKeys[1]])).toBeNull()
    expect(listedSlotOf(keys, [smartAccount], slotKeys)).toBeNull()
  })
})

describe('the phrase the keystore sends to the page', () => {
  it('reads a temporary seed with a known path template and nothing else', () => {
    expect(
      tempSeedOf({
        tempSeed: { seed: TEST_PHRASE, hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE }
      })
    ).toEqual(SEED)
    expect(
      tempSeedOf({ tempSeed: { seed: TEST_PHRASE, hdPathTemplate: 'm/0/<account>' } })
    ).toBeNull()
    expect(
      tempSeedOf({ tempSeed: { seed: '', hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE } })
    ).toBeNull()
    expect(tempSeedOf({ privateKey: '0x01' })).toBeNull()
    expect(tempSeedOf(null)).toBeNull()
  })
})

describe('the key that sends the recovery', () => {
  it('is the slot ordinary key, listed as the basic account, never the key the recovery installs', () => {
    expect(fastTrackSendingKeyOf(SMART_ACCOUNT, slotAccounts, slotKeys)).toBe(ORDINARY_KEY)
  })

  it('is none where the receiving account is not a listed smart account', () => {
    expect(fastTrackSendingKeyOf(SMART_ACCOUNT, [basicAccount], slotKeys)).toBeNull()
    expect(fastTrackSendingKeyOf(ORDINARY_KEY, slotAccounts, slotKeys)).toBeNull()
  })

  it('is none where the keystore lacks the controlling key or the ordinary key', () => {
    expect(fastTrackSendingKeyOf(SMART_ACCOUNT, slotAccounts, [slotKeys[0]])).toBeNull()
    expect(fastTrackSendingKeyOf(SMART_ACCOUNT, slotAccounts, [slotKeys[1]])).toBeNull()
  })

  it('is none where the phrase gives more than one listed basic account', () => {
    const second = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    const keys: Key[] = [...slotKeys, internalKey(second, false)]

    expect(
      fastTrackSendingKeyOf(SMART_ACCOUNT, [...slotAccounts, getBasicAccount(second, [])], keys)
    ).toBeNull()
  })
})

describe("the fast track's gas check for the submission", () => {
  const network = { name: 'Sepolia', nativeAssetSymbol: 'ETH' }

  it('reads the sending key and answers enough where its balance covers the estimate', async () => {
    const nativeBalance = jest.fn(async () => 10n ** 18n)

    const check = await submissionCheckOf({
      reads: { gasPrice: async () => 1_000_000_000n, nativeBalance },
      key: ORDINARY_KEY,
      network,
      gas: 100_000n
    })

    expect(check.kind).toBe('enough')
    expect(nativeBalance).toHaveBeenCalledWith(ORDINARY_KEY)
  })

  it('offers only the deposit from outside into the sending key where it holds too little', async () => {
    const check = await submissionCheckOf({
      reads: { gasPrice: async () => 1_000_000_000n, nativeBalance: async () => 0n },
      key: ORDINARY_KEY,
      network,
      gas: 100_000n
    })

    if (check.kind !== 'deposit') {
      throw new Error(`expected a deposit step, got ${check.kind}`)
    }
    expect(check.step.fastTrack).toBe(true)
    expect(check.step.key).toBe(ORDINARY_KEY)
    expect(check.step.operates).toBeUndefined()
    expect(check.step.routes.map((route) => route.kind)).toEqual(['outside'])
    expect(check.step.routes[0]).toMatchObject({ to: ORDINARY_KEY })
    expect(check.step.shortfall).toBe(check.step.estimate.required)
  })

  it('rejects where a read fails, so the step never shows a stale answer', async () => {
    await expect(
      submissionCheckOf({
        reads: {
          gasPrice: async () => 1n,
          nativeBalance: async () => {
            throw new Error('node down')
          }
        },
        key: ORDINARY_KEY,
        network
      })
    ).rejects.toThrow('node down')
  })
})

describe("the fast track's hand-over", () => {
  it('opens the account step on the fresh install route with the account that receives control', () => {
    const [path, search] = accountStepPathOf(SMART_ACCOUNT).split('?')
    const params = new URLSearchParams(search)

    expect(path).toBe('social-recovery/recovery/account')
    expect(params.get('route')).toBe('fresh-install')
    expect(params.get('to')).toBe(SMART_ACCOUNT)
  })

  it('counts the warning as acknowledged only on the exact flag the warning hands over', () => {
    expect(acknowledgedOf({ acknowledged: true, prevRoute: { pathname: '/' } })).toBe(true)
    expect(acknowledgedOf({ acknowledged: 'true' })).toBe(false)
    expect(acknowledgedOf({ prevRoute: { pathname: '/' } })).toBe(false)
    expect(acknowledgedOf(null)).toBe(false)
    expect(acknowledgedOf(undefined)).toBe(false)
  })
})
