/**
 * One save at a time, over its real steps and a store, as the screen runs it:
 * what the prepare is given, what the gas check estimates, what is sent and
 * with which mark, each way the send and the receipt end, and what the check
 * after a landed receipt decides, down to the wipe of the six setup records on
 * the extension's records over an in-memory storage.
 */
import type { Account } from '@ambire-common/interfaces/account'
import type { SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import {
  accountBatchTransactionOf,
  privacyLevelOf,
  recoveryKitMarkOf,
  sameAddress,
  shapeNoteOf
} from '@web/modules/social-recovery/shared/client'
import {
  createWalletRecords,
  readRecoveryPassword,
  setRecoveryPassword,
  SETUP_RECORD_NAMES
} from '@web/modules/social-recovery/shared/records'
import { canRetry } from '@web/modules/social-recovery/shared/writes'

import {
  armScreenOf,
  callsOf,
  committedDraftOf,
  createArmStore,
  isSaved,
  recheckGas,
  rereadConfirmation,
  startSave
} from '@web/modules/social-recovery/setup/arm'

import {
  armingCallOf,
  CHAIN_ID,
  COMMIT,
  confirmation,
  DESCRIPTOR,
  draftOf,
  HAPPY,
  KEY,
  memoryStorage,
  PASSWORD,
  runSave,
  SHORT_TIMEOUT_MS,
  smartAccount,
  TX_HASH,
  wireSave
} from './harness'
import type { SaveScript } from './harness'

let account: Account

beforeAll(async () => {
  account = await smartAccount()
})

const script = (overrides: Partial<SaveScript> = {}): SaveScript => ({
  ...HAPPY,
  authorized: false,
  deployed: true,
  ...overrides
})

describe('the batch the save sends', () => {
  const CASES: [string, boolean, boolean][] = [
    ['not yet authorized, with code', false, true],
    ['not yet authorized, with no code', false, false],
    ['already authorized, with code', true, true],
    ['already authorized, with no code', true, false]
  ]

  CASES.forEach(([title, authorized, deployed]) =>
    it(`sends exactly the prepared calls in order, as one request, for an account ${title}`, async () => {
      const wired = wireSave(account, script({ authorized, deployed }))
      await runSave(wired.steps)

      expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
      const [sentFor, calls] = wired.port.sendAccountBatch.mock.calls[0]
      expect(sentFor).toBe(wired.account)
      expect(calls).toEqual(authorized ? [COMMIT] : [armingCallOf(wired.account), COMMIT])
      // No call the wallet composed: nothing to the factory, nothing beyond what the client prepared.
      expect(
        calls.filter((call: { target: string }) =>
          sameAddress(call.target, account.creation!.factoryAddr)
        )
      ).toEqual([])
      expect(wired.port.send).not.toHaveBeenCalled()
    })
  )

  it("sends the batch with the recovery kit's mark from the client's descriptor", async () => {
    const wired = wireSave(account, script())
    await runSave(wired.steps)

    const mark = wired.port.sendAccountBatch.mock.calls[0][3]
    expect(mark).toEqual(recoveryKitMarkOf(DESCRIPTOR))
    expect(mark.manager).toBe(DESCRIPTOR.manager)
    expect(mark.auditedActions).toEqual([...DESCRIPTOR.auditedActions])
  })
})

describe('the gas check before the send', () => {
  ;[true, false].forEach((deployed) =>
    it(`estimates the account library's transaction of the batch from the controlling key (code: ${deployed})`, async () => {
      const wired = wireSave(account, script({ deployed }))
      await runSave(wired.steps)

      const expected = accountBatchTransactionOf(wired.facts, KEY, callsOf(wired.prepared))
      expect(expected.to.toLowerCase()).toBe(
        (deployed ? account.addr : account.creation!.factoryAddr).toLowerCase()
      )
      expect(wired.reads.estimateGas).toHaveBeenCalledWith(
        expect.objectContaining({ to: expected.to, data: expected.data })
      )
      expect(wired.reads.nativeBalance).toHaveBeenCalledWith(KEY.addr)
      expect(wired.reads.nativeBalance.mock.invocationCallOrder[0]).toBeLessThan(
        wired.port.sendAccountBatch.mock.invocationCallOrder[0]
      )
    })
  )

  it("sends nothing on a key short of gas, and shows the deposit step naming the key's address and the shortfall", async () => {
    const wired = wireSave(account, script({ gas: 'deposit' }))
    const store = await runSave(wired.steps)
    const { write } = store.state()

    expect(write.status).toBe('needsDeposit')
    if (write.status !== 'needsDeposit') return
    expect(write.step.key.toLowerCase()).toBe(KEY.addr.toLowerCase())
    expect(write.step.payer).toBe('accountKey')
    expect(write.step.shortfall).toBeGreaterThan(0n)
    expect(write.step.routes.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['outside']))
    expect(write.step.routes.every(({ kind }) => kind === 'transfer' || kind === 'outside')).toBe(
      true
    )
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(wired.saveSetup).not.toHaveBeenCalled()
  })

  it('checks the gas again from the deposit step on the same prepared save, and sends once the key holds enough', async () => {
    const wired = wireSave(account, script({ gas: 'deposit' }))
    const store = await runSave(wired.steps)
    wired.reads.nativeBalance.mockResolvedValue(10n ** 18n)

    await recheckGas(store, wired.steps, { timeoutMs: SHORT_TIMEOUT_MS })

    expect(wired.prepareCommitSetup).toHaveBeenCalledTimes(1)
    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(isSaved(store.state())).toBe(true)
  })

  it('reads a gas check that could not read as its own state, with nothing sent', async () => {
    const wired = wireSave(account, script({ gas: 'read-fails' }))
    const store = await runSave(wired.steps)

    expect(store.state().write.status).toBe('gasReadError')
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })
})

describe('the prepare', () => {
  it('reads a refusal of the prepare as never sent, with no gas check and nothing sent, and a retry prepares again', async () => {
    const wired = wireSave(account, script({ prepare: 'refuses' }))
    const store = await runSave(wired.steps)

    expect(store.state().write.status).toBe('failedNotSent')
    expect(canRetry(store.state().write)).toBe(true)
    expect(wired.reads.estimateGas).not.toHaveBeenCalled()
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()

    wired.prepareCommitSetup.mockResolvedValue(wired.prepared)
    await startSave(store, wired.steps, { timeoutMs: SHORT_TIMEOUT_MS })
    expect(wired.prepareCommitSetup).toHaveBeenCalledTimes(2)
    expect(isSaved(store.state())).toBe(true)
  })

  it('gives the prepare the recovery password at an encrypted backup, and none at a clear one', async () => {
    const encrypted = wireSave(account, script({ backup: 'encrypted' }))
    await runSave(encrypted.steps)
    expect(encrypted.prepareCommitSetup).toHaveBeenCalledWith(encrypted.draft, PASSWORD)

    const clear = wireSave(account, script({ backup: 'clear' }))
    await runSave(clear.steps)
    expect(clear.prepareCommitSetup).toHaveBeenCalledWith(clear.draft, undefined)
  })

  it('rebuilds a stale shape note from the final path, writes the draft back, and prepares that draft', async () => {
    const stale = shapeNoteOf({ clauses: [], wait: 1n, ignoresPause: true })
    const wired = wireSave(account, script({ publicMetadata: stale }))
    expect(privacyLevelOf(wired.draft.privacy)).toBe('shape-visible')
    await runSave(wired.steps)

    const fresh = shapeNoteOf({
      clauses: wired.draft.clauses,
      wait: wired.draft.wait,
      ignoresPause: wired.draft.ignoresPause
    })
    expect(fresh).not.toBe(stale)
    const rebuilt: SetupDraft = {
      ...wired.draft,
      privacy: { ...wired.draft.privacy, publicMetadata: fresh }
    }
    expect(wired.writeDraftAndPath).toHaveBeenCalledWith(rebuilt)
    expect(wired.prepareCommitSetup).toHaveBeenCalledWith(rebuilt, PASSWORD)
    expect(wired.writeDraftAndPath.mock.invocationCallOrder[0]).toBeLessThan(
      wired.prepareCommitSetup.mock.invocationCallOrder[0]
    )
    expect(wired.confirmSetup).toHaveBeenCalledWith(rebuilt, wired.prepared)
  })

  it('commits a draft whose note is current, or that shows no shape, as it stands, writing nothing back', async () => {
    const current = draftOf('encrypted')
    const note = shapeNoteOf({
      clauses: current.clauses,
      wait: current.wait,
      ignoresPause: current.ignoresPause
    })
    expect(committedDraftOf(draftOf('encrypted', note))).toEqual(draftOf('encrypted', note))
    expect(committedDraftOf(draftOf('encrypted', '0x'))).toEqual(draftOf('encrypted', '0x'))

    const wired = wireSave(account, script({ publicMetadata: note }))
    await runSave(wired.steps)
    expect(wired.writeDraftAndPath).not.toHaveBeenCalled()
  })

  it('refuses a prepared write the account does not send, and sends nothing', async () => {
    const wired = wireSave(account, script())
    wired.prepareCommitSetup.mockResolvedValue({ ...COMMIT, sender: 'anyone' })
    const store = await runSave(wired.steps)

    expect(store.state().write.status).toBe('failedNotSent')
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })
})

describe('the send and the receipt', () => {
  const REASONS = [
    'not-wired',
    'not-listed',
    'not-smart-account',
    'refused',
    'window-closed',
    'not-broadcast',
    'not-a-transaction',
    'timeout'
  ] as const

  REASONS.forEach((send) =>
    it(`reads a refusal of the port (${send}) as never sent, with the retry, and wipes nothing`, async () => {
      const wired = wireSave(account, script({ send }))
      const store = await runSave(wired.steps)
      const { write } = store.state()

      expect(write.status).toBe('failedNotSent')
      expect(write.status === 'failedNotSent' && write.replaced).toBeFalsy()
      expect(canRetry(write)).toBe(true)
      expect(wired.confirmSetup).not.toHaveBeenCalled()
      expect(wired.saveSetup).not.toHaveBeenCalled()
      expect(armScreenOf(store.state())).toBe('run')
    })
  )

  it('sends a second batch on a retry after the port answered that the operation was not a transaction', async () => {
    const wired = wireSave(account, script({ send: 'not-a-transaction' }))
    const store = await runSave(wired.steps)
    wired.port.sendAccountBatch.mockResolvedValue(TX_HASH)

    await startSave(store, wired.steps, { timeoutMs: SHORT_TIMEOUT_MS })

    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(2)
    expect(wired.prepareCommitSetup).toHaveBeenCalledTimes(2)
  })

  it('reads a reverted receipt as reverted, with the cause it carries and the gas gone, and wipes nothing', async () => {
    const wired = wireSave(account, script({ receipt: 'reverted' }))
    const store = await runSave(wired.steps)
    const { write } = store.state()

    expect(write.status).toBe('failedReverted')
    if (write.status !== 'failedReverted') return
    expect(write.transactionHash).toBe(TX_HASH)
    // The drive decodes no kit error for the receipt, so the cause is the one the wallet cannot name.
    expect(write.cause).toEqual({ kind: 'unnamed' })
    expect(wired.confirmSetup).not.toHaveBeenCalled()
    expect(wired.saveSetup).not.toHaveBeenCalled()
  })

  it('reads a transaction another one replaced as not run, and wipes nothing', async () => {
    const wired = wireSave(account, script({ receipt: 'replaced' }))
    const store = await runSave(wired.steps)
    const { write } = store.state()

    expect(write.status).toBe('failedNotSent')
    expect(write.status === 'failedNotSent' && write.replaced).toBe('replaced')
    expect(wired.confirmSetup).not.toHaveBeenCalled()
    expect(wired.saveSetup).not.toHaveBeenCalled()
  })
})

describe('after the batch landed', () => {
  it('runs the check once after the receipt, with the committed draft and the prepared write', async () => {
    const wired = wireSave(account, script())
    await runSave(wired.steps)

    expect(wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(wired.confirmSetup).toHaveBeenCalledWith(wired.draft, wired.prepared)
    expect(wired.confirmSetup.mock.invocationCallOrder[0]).toBeGreaterThan(
      wired.receipts.wait.mock.invocationCallOrder[0]
    )
  })

  it('wipes the six setup records once the check agrees, keeps the recovery password, and reads saved', async () => {
    const wired = wireSave(account, script())
    const storage = memoryStorage()
    const records = createWalletRecords({ storage })
    const setup = records.setup(CHAIN_ID, wired.account)
    await setup.setupDraft.write(wired.draft)
    await setup.enrollments.write([])
    await setup.passwordSet.write('password-set')
    await setup.waitingPeriod.write(wired.draft.wait)
    expect(storage.raw.size).toBe(4)
    setRecoveryPassword(CHAIN_ID, wired.account, PASSWORD)
    wired.saveSetup.mockImplementation(records.saveSetup)

    const store = await runSave(wired.steps)

    expect(isSaved(store.state())).toBe(true)
    expect(armScreenOf(store.state())).toBe('saved')
    expect(wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(wired.saveSetup).toHaveBeenCalledWith(CHAIN_ID, wired.account)
    expect(storage.raw.size).toBe(0)
    const reads = await Promise.all(SETUP_RECORD_NAMES.map((name) => setup[name].read()))
    expect(reads.map(({ status }) => status)).toEqual(SETUP_RECORD_NAMES.map(() => 'absent'))
    expect(readRecoveryPassword(CHAIN_ID, wired.account)).toBe(PASSWORD)
  })

  it('does not read saved while the check runs, nor before the wipe ends', async () => {
    const wired = wireSave(account, script())
    let answer: (value: ReturnType<typeof confirmation>) => void = () => {}
    wired.confirmSetup.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    let wiped: () => void = () => {}
    wired.saveSetup.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          wiped = resolve
        })
    )
    const store = createArmStore()
    const run = startSave(store, wired.steps, { timeoutMs: 10_000 })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(store.state().write.status).toBe('landed')
    expect(armScreenOf(store.state())).toBe('confirming')
    expect(wired.saveSetup).not.toHaveBeenCalled()

    answer(confirmation(true, true))
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(isSaved(store.state())).toBe(false)
    expect(armScreenOf(store.state())).toBe('confirming')

    wiped()
    await run
    expect(isSaved(store.state())).toBe(true)
  })

  const DISAGREED: [string, SaveScript['confirm'], 'mismatch' | 'authorization', number][] = [
    ['an authorization the module does not recognize', 'unauthorized', 'authorization', 1],
    ["the commitment's coded mismatch", 'mismatch', 'mismatch', 1],
    ['a setup the check found on neither read', 'not-landed-twice', 'mismatch', 2]
  ]

  DISAGREED.forEach(([named, confirm, check, reads]) =>
    it(`reads ${named} as disagreed, never saved, and wipes nothing`, async () => {
      const wired = wireSave(account, script({ confirm }))
      const store = await runSave(wired.steps)

      expect(store.state().after).toEqual({ stage: 'disagreed', check })
      expect(armScreenOf(store.state())).toBe('disagreed')
      expect(isSaved(store.state())).toBe(false)
      expect(wired.confirmSetup).toHaveBeenCalledTimes(reads)
      expect(wired.saveSetup).not.toHaveBeenCalled()

      // Nothing the screen offers after a disagreement reads the check again or wipes.
      await rereadConfirmation(store, wired.steps)
      await recheckGas(store, wired.steps)
      expect(wired.confirmSetup).toHaveBeenCalledTimes(reads)
      expect(wired.saveSetup).not.toHaveBeenCalled()
    })
  )

  it('reads saved where the check found the setup only on its second read', async () => {
    const wired = wireSave(account, script({ confirm: 'not-landed-then-agreed' }))
    const store = await runSave(wired.steps)

    expect(wired.confirmSetup).toHaveBeenCalledTimes(2)
    expect(isSaved(store.state())).toBe(true)
    expect(wired.saveSetup).toHaveBeenCalledTimes(1)
  })
  ;(
    [
      ['throws', 'throws'],
      ['never answers', 'no-answer']
    ] as const
  ).forEach(([named, confirm]) =>
    it(`reads a check that ${named} as unanswered, wipes nothing, and reads it again on the retry`, async () => {
      const wired = wireSave(account, script({ confirm }))
      const store = await runSave(wired.steps)

      expect(store.state().after).toEqual({ stage: 'unread' })
      expect(armScreenOf(store.state())).toBe('unread')
      expect(wired.saveSetup).not.toHaveBeenCalled()
      expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)

      wired.confirmSetup.mockResolvedValue(confirmation(true, true))
      await rereadConfirmation(store, wired.steps, { timeoutMs: SHORT_TIMEOUT_MS })

      expect(wired.confirmSetup).toHaveBeenCalledTimes(2)
      expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
      expect(wired.prepareCommitSetup).toHaveBeenCalledTimes(1)
      expect(isSaved(store.state())).toBe(true)
      expect(wired.saveSetup).toHaveBeenCalledTimes(1)
    })
  )

  it('reads a retried check that now disagrees as disagreed, with nothing wiped', async () => {
    const wired = wireSave(account, script({ confirm: 'throws' }))
    const store = await runSave(wired.steps)
    wired.confirmSetup.mockResolvedValue(confirmation(true, false))

    await rereadConfirmation(store, wired.steps)

    expect(store.state().after).toEqual({ stage: 'disagreed', check: 'authorization' })
    expect(wired.saveSetup).not.toHaveBeenCalled()
  })

  it('still reads saved where the wipe of the records failed, since the setup is live on chain', async () => {
    const wired = wireSave(account, script())
    wired.saveSetup.mockRejectedValue(new Error('storage unavailable'))
    const store = await runSave(wired.steps)

    expect(wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(isSaved(store.state())).toBe(true)
  })

  it('offers no new save once saved: a start does nothing', async () => {
    const wired = wireSave(account, script())
    const store = await runSave(wired.steps)
    const saved = store.state()

    await startSave(store, wired.steps)

    expect(store.state()).toBe(saved)
    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
  })
})
