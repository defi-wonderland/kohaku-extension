/**
 * @jest-environment jsdom
 *
 * The approval page's signing half: how the wallet holds the key the request
 * names and what the sign action does with each reading, the signature made
 * in the wallet's own sign window and the approval line it turns into, each
 * way a signing brings no approval, the offline block's payload and its
 * pasted signature, the copy actions, the reads stopping once an approval
 * exists, and the decline's message.
 */
import type { TypedDataToSign } from '@web/modules/social-recovery/shared/client'

import {
  ACCOUNT,
  advance,
  approvalOf,
  GUARDIAN,
  GUARDIAN_ACCOUNT,
  hashOf,
  kit,
  lineOf,
  mountLive,
  NEW_KEY,
  replyOf,
  requestOf,
  resetEdges,
  settle,
  signatureBy,
  signRefusal,
  STRANGER_ACCOUNT,
  t,
  typedDataFor,
  UNLOCK_ROUTE,
  wallet
} from './harness'
import type { Mounted } from './harness'

const PAGE = 'socialRecovery.guardianPage'
const SIGNING = `${PAGE}.signing`
const OFFLINE = `${PAGE}.offline`
const MINUTE = 60_000

beforeEach(resetEdges)
afterEach(() => jest.useRealTimers())

/** The page with the acknowledgment ticked. */
const mountTicked = async (): Promise<Mounted> => {
  const page = await mountLive()
  await page.press('guardian-acknowledge')
  return page
}

/** Lets a signing that waits on real crypto finish, then renders it. */
const finish = async () => {
  for (let round = 0; round < 5; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await settle()
  }
}

/** The typed data an offline device reads back from the carried payload. */
const typedDataFromPayload = (text: string): TypedDataToSign => {
  const carried = JSON.parse(text) as {
    domain: Record<string, unknown>
    types: Record<string, { name: string; type: string }[]>
    primaryType: string
    message: Record<string, unknown>
  }
  const revive = (
    fields: { name: string; type: string }[],
    value: Record<string, unknown>
  ): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(value).map(([name, member]) => {
        const type = fields.find((field) => field.name === name)?.type ?? ''
        if (/^u?int[0-9]*$/.test(type)) {
          return [name, BigInt(member as string)]
        }
        const nested = carried.types[type]
        return [name, nested ? revive(nested, member as Record<string, unknown>) : member]
      })
    )
  return {
    ...carried,
    domain: revive(carried.types.EIP712Domain ?? [], carried.domain),
    message: revive(carried.types[carried.primaryType] ?? [], carried.message)
  } as unknown as TypedDataToSign
}

describe('the key the request names', () => {
  it('reads as held, in full, and lets the ticked page sign', async () => {
    const page = await mountLive()
    expect(page.textOf('guardian-key-address')).toBe(GUARDIAN)
    expect(page.textOf('guardian-key-held')).toBe(t(`${SIGNING}.keyHeld`))
    expect(page.isDisabled('guardian-sign')).toBe(true)
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(false)
    page.unmount()
  })

  it('reads as missing where the keystore does not hold it, and keeps sign disabled', async () => {
    wallet.keystore.keys = [{ addr: STRANGER_ACCOUNT.address, type: 'internal' }]
    const page = await mountTicked()
    expect(page.textOf('guardian-key-missing')).toBe(
      t(`${SIGNING}.keyMissing`, { address: GUARDIAN })
    )
    expect(page.has('guardian-key-held')).toBe(false)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })

  it('reads as missing with the import repair where the wallet has no keystore', async () => {
    wallet.keystore = { keys: [], isUnlocked: false, hasPasswordSecret: false }
    const page = await mountTicked()
    expect(page.textOf('guardian-key-missing')).toBe(
      t(`${SIGNING}.keyMissing`, { address: GUARDIAN })
    )
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })

  it('reads as locked, and the sign action goes to the unlock without asking for a signature', async () => {
    wallet.keystore.isUnlocked = false
    const page = await mountLive()
    expect(page.textOf('guardian-key-locked')).toBe(t(`${SIGNING}.unlock`))
    expect(page.textOf('guardian-key-address')).toBe(GUARDIAN)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(false)
    await page.press('guardian-sign')
    expect(wallet.navigate).toHaveBeenCalledWith(UNLOCK_ROUTE)
    expect(wallet.signTypedData).not.toHaveBeenCalled()
    page.unmount()
  })

  it('reads as not readable where the request names another method, and keeps sign disabled', async () => {
    const page = await mountLive(requestOf({ method: STRANGER_ACCOUNT.address }))
    await page.press('guardian-acknowledge')
    expect(page.textOf('guardian-key-unreadable')).toBe(t(`${PAGE}.notReadable`))
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })
})

describe('the signing step', () => {
  it('renders the four values, the deadline, the submittable sentence and both notes', async () => {
    const page = await mountLive()
    expect(page.textOf('guardian-signing-title')).toBe(t(`${SIGNING}.title`))
    expect(page.textOf('guardian-signing-values-value-accountBeingRecovered')).toBe(ACCOUNT)
    expect(page.textOf('guardian-signing-values-value-newKey')).toBe(NEW_KEY)
    expect(page.has('guardian-signing-values-deadline')).toBe(true)
    expect(page.textOf('guardian-signing-values-submittable')).toBe(
      t('socialRecovery.checklist.submittable')
    )
    expect(page.textOf('guardian-prompt-note')).toBe(t(`${SIGNING}.promptNote`))
    expect(page.textOf('guardian-hardware-note')).toBe(t(`${SIGNING}.hardwareNote`))
    page.unmount()
  })

  it('signs the typed data with the held key and shows the approval line the reply makes', async () => {
    const request = requestOf()
    const typedData = typedDataFor(request)
    const signature = await signatureBy(GUARDIAN_ACCOUNT, typedData)
    const page = await mountTicked()
    await page.press('guardian-sign')
    await finish()
    expect(wallet.signTypedData).toHaveBeenCalledTimes(1)
    expect(wallet.signTypedData).toHaveBeenCalledWith(
      { addr: GUARDIAN, type: 'internal' },
      typedData
    )
    expect(kit.replyFrom).toHaveBeenCalledWith(request, typedData, { signature })
    expect(kit.verify).toHaveBeenCalledWith(request, request.place, signature)
    expect(page.textOf('guardian-signed-title')).toBe(t(`${PAGE}.signed.title`))
    expect(page.textOf('guardian-signed-line')).toBe(approvalOf(signature))
    expect(page.textOf('guardian-signed-regret')).toBe(t(`${PAGE}.signed.regret`))
    expect(page.has('guardian-lead')).toBe(false)

    const line = lineOf(replyOf(request, signature))
    await page.press('guardian-signed-copy')
    expect(wallet.copied).toHaveBeenLastCalledWith(line)
    expect(page.textOf('guardian-signed-copy-approval-copied')).toBe(
      t('socialRecovery.checklist.guardian.copied')
    )
    await page.press('guardian-signed-copy-message')
    expect(wallet.copied).toHaveBeenLastCalledWith(
      t(`${PAGE}.signed.message`, { account: ACCOUNT, line })
    )
    page.unmount()
  })

  it('passes a signature the approving side could not judge', async () => {
    kit.verify.mockImplementation(async () => 'not-judged')
    const page = await mountTicked()
    await page.press('guardian-sign')
    await finish()
    expect(page.has('guardian-signed')).toBe(true)
    page.unmount()
  })

  it('keeps nothing for a signature by another key and reads that the key is wrong', async () => {
    wallet.signTypedData.mockImplementation((_key, typedData) =>
      signatureBy(STRANGER_ACCOUNT, typedData)
    )
    const page = await mountTicked()
    await page.press('guardian-sign')
    await finish()
    expect(page.has('guardian-signed')).toBe(false)
    expect(page.text()).toContain(t(`${SIGNING}.wrongKey`))
    expect(page.has('guardian-sign-retry')).toBe(true)
    page.unmount()
  })

  it('reads a signature the sign window returned for another key as the wrong key', async () => {
    wallet.signTypedData.mockRejectedValue(signRefusal('signer-mismatch'))
    const page = await mountTicked()
    await page.press('guardian-sign')
    await finish()
    expect(page.text()).toContain(t(`${SIGNING}.wrongKey`))
    expect(kit.replyFrom).not.toHaveBeenCalled()
    page.unmount()
  })

  it('reads a refusal in the sign window as refused, and Try again signs again', async () => {
    wallet.signTypedData.mockRejectedValueOnce(signRefusal('refused'))
    const page = await mountTicked()
    await page.press('guardian-sign')
    await finish()
    expect(page.text()).toContain(t(`${SIGNING}.refused`))
    expect(page.has('guardian-signed')).toBe(false)
    await page.press('guardian-sign-retry')
    await finish()
    expect(wallet.signTypedData).toHaveBeenCalledTimes(2)
    expect(page.has('guardian-signed')).toBe(true)
    page.unmount()
  })

  it('reads any other throw, and a reply the approving side cannot package, as failed', async () => {
    wallet.signTypedData.mockRejectedValueOnce(new Error('the background went away'))
    const page = await mountTicked()
    await page.press('guardian-sign')
    await finish()
    expect(page.text()).toContain(t(`${SIGNING}.failed`))

    kit.replyFrom.mockImplementation(async () => ({
      kind: 'reply-failure',
      cause: 'material-rejected'
    }))
    await page.press('guardian-sign-retry')
    await finish()
    expect(page.text()).toContain(t(`${SIGNING}.failed`))
    expect(page.has('guardian-signed')).toBe(false)
    page.unmount()
  })

  it('is busy while the sign window is open, and a second press asks for nothing more', async () => {
    let answer: (signature: `0x${string}`) => void = () => {}
    wallet.signTypedData.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const page = await mountTicked()
    await page.press('guardian-sign')
    expect(page.has('guardian-sign-busy')).toBe(true)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    await page.press('guardian-sign')
    expect(wallet.signTypedData).toHaveBeenCalledTimes(1)
    answer(await signatureBy(GUARDIAN_ACCOUNT, typedDataFor(requestOf())))
    await finish()
    expect(page.has('guardian-signed')).toBe(true)
    page.unmount()
  })

  it('stops reading the chain once the approval exists', async () => {
    const page = await mountTicked()
    expect(kit.recoveryState).toHaveBeenCalledTimes(1)
    await page.press('guardian-sign')
    await finish()
    expect(page.has('guardian-signed')).toBe(true)
    await advance(3 * MINUTE)
    expect(kit.recoveryState).toHaveBeenCalledTimes(1)
    expect(page.has('guardian-signed')).toBe(true)
    page.unmount()
  })
})

describe('the offline block', () => {
  const openOffline = async (): Promise<Mounted> => {
    const page = await mountLive()
    await page.press('guardian-offline-open')
    return page
  }

  it('carries the typed data out by QR, copy and file, with the values, deadline and numbers', async () => {
    const request = requestOf()
    const page = await openOffline()
    expect(page.textOf('guardian-offline-title')).toBe(t(`${OFFLINE}.title`))
    expect(page.textOf('guardian-offline-values-value-newKey')).toBe(NEW_KEY)
    expect(page.has('guardian-offline-values-deadline')).toBe(true)
    expect(page.textOf('guardian-offline-values-submittable')).toBe(
      t('socialRecovery.checklist.submittable')
    )
    expect(page.textOf('guardian-offline-setup-number')).toBe(request.setupNonce)
    expect(page.textOf('guardian-offline-attempt-number')).toBe(request.attemptId)
    expect(page.textOf('guardian-offline-check-device')).toBe(t(`${OFFLINE}.checkDevice`))

    const payload = wallet.qr[wallet.qr.length - 1]
    expect(hashOf(typedDataFromPayload(payload))).toBe(hashOf(typedDataFor(request)))
    await page.press('guardian-offline-copy-payload')
    expect(wallet.copied).toHaveBeenLastCalledWith(payload)
    await page.press('guardian-offline-save')
    expect(wallet.saved).toHaveBeenCalledWith({
      name: expect.stringMatching(/\.json$/),
      text: payload,
      type: 'application/json'
    })
    page.unmount()
  })

  it('keeps the add action under the acknowledgment', async () => {
    const page = await openOffline()
    await page.type('guardian-offline-signature', '0x1234')
    expect(page.isDisabled('guardian-offline-add')).toBe(true)
    expect(page.has('guardian-offline-tick-first')).toBe(true)
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-offline-add')).toBe(false)
    page.unmount()
  })

  it('turns a signature by the named key, made from the carried payload, into the same line', async () => {
    const request = requestOf()
    const page = await openOffline()
    const carried = typedDataFromPayload(wallet.qr[wallet.qr.length - 1])
    const signature = await signatureBy(GUARDIAN_ACCOUNT, carried)
    await page.press('guardian-acknowledge')
    await page.type('guardian-offline-signature', `  ${signature}\n`)
    await page.press('guardian-offline-add')
    await finish()
    expect(wallet.signTypedData).not.toHaveBeenCalled()
    expect(page.has('guardian-signed')).toBe(true)
    await page.press('guardian-signed-copy')
    expect(wallet.copied).toHaveBeenLastCalledWith(lineOf(replyOf(request, signature)))
    page.unmount()
  })

  it('reads a signature by another key the approving side rejects as not a signature', async () => {
    const page = await openOffline()
    const signature = await signatureBy(STRANGER_ACCOUNT, typedDataFor(requestOf()))
    await page.press('guardian-acknowledge')
    await page.type('guardian-offline-signature', signature)
    await page.press('guardian-offline-add')
    await finish()
    expect(page.textOf('guardian-offline-notASignature')).toBe(t(`${OFFLINE}.notASignature`))
    expect(page.has('guardian-signed')).toBe(false)
    page.unmount()
  })

  it('reads a signature the approving side could not judge as the wrong signer', async () => {
    kit.verify.mockImplementation(async () => 'not-judged')
    const page = await openOffline()
    const signature = await signatureBy(STRANGER_ACCOUNT, typedDataFor(requestOf()))
    await page.press('guardian-acknowledge')
    await page.type('guardian-offline-signature', signature)
    await page.press('guardian-offline-add')
    await finish()
    expect(page.textOf('guardian-offline-wrongSigner')).toBe(t(`${OFFLINE}.wrongSigner`))
    expect(page.has('guardian-signed')).toBe(false)
    page.unmount()
  })

  it('reads garbage as not a signature and asks the approving side nothing', async () => {
    const page = await openOffline()
    await page.press('guardian-acknowledge')
    await page.type('guardian-offline-signature', 'not a signature')
    await page.press('guardian-offline-add')
    await finish()
    expect(page.textOf('guardian-offline-notASignature')).toBe(t(`${OFFLINE}.notASignature`))
    expect(kit.replyFrom).not.toHaveBeenCalled()
    page.unmount()
  })

  it('reads a text the approving side cannot package as not a signature', async () => {
    kit.replyFrom.mockImplementation(async () => ({
      kind: 'reply-failure',
      cause: 'material-rejected'
    }))
    const page = await openOffline()
    await page.press('guardian-acknowledge')
    await page.type('guardian-offline-signature', '0xabcd')
    await page.press('guardian-offline-add')
    await finish()
    expect(page.textOf('guardian-offline-notASignature')).toBe(t(`${OFFLINE}.notASignature`))
    page.unmount()
  })

  it('goes back to the lead with the acknowledgment kept', async () => {
    const page = await openOffline()
    await page.press('guardian-acknowledge')
    await page.press('guardian-offline-back')
    expect(page.has('guardian-offline')).toBe(false)
    expect(page.has('guardian-lead')).toBe(true)
    expect(page.isDisabled('guardian-sign')).toBe(false)
    page.unmount()
  })
})

describe('the decline message', () => {
  it('copies the message naming the account and the new key', async () => {
    const page = await mountLive()
    await page.press('guardian-decline')
    await page.press('guardian-declined-copy-message')
    expect(wallet.copied).toHaveBeenLastCalledWith(
      t(`${PAGE}.declined.message`, { account: ACCOUNT, newKey: NEW_KEY })
    )
    expect(page.textOf('guardian-declined-copy-message-copied')).toBe(
      t('socialRecovery.checklist.guardian.copied')
    )
    page.unmount()
  })

  it('says so where the clipboard refuses the copy', async () => {
    wallet.copied.mockImplementation(async () => false)
    const page = await mountLive()
    await page.press('guardian-decline')
    await page.press('guardian-declined-copy-message')
    expect(page.has('guardian-declined-copy-message-failed')).toBe(true)
    page.unmount()
  })
})
