/**
 * The send drive feeds the write machine the answers of the client's send
 * port and receipt wait: the hash as `sent`, the receipt as `receipt`, and a
 * refusal or a wait error as `error`, as it was thrown. The machine and the
 * classification decide every reading, so each test runs the real machine
 * from the submitting state and reads the state it ends in.
 *
 * The port and the wait are the fakes of harness.ts. The refusals are the
 * client's own, and the wait errors are ethers' shapes the harness builds.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'
import {
  SEND_REFUSAL_REASONS,
  sendRefusal,
  type ProviderTransactionReceipt
} from '@web/modules/social-recovery/shared/client'

import {
  deferred,
  driveSend,
  drivenMachine,
  enoughCheck,
  fakeReceiptWait,
  fakeSendPort,
  GWEI,
  KEY,
  minedAndReverted,
  ownerTransaction,
  providerReceipt,
  readingOf,
  REPLACEMENT_HASH,
  replacedBy,
  submittingFor,
  TX_HASH,
  userRejected,
  waitTimedOut,
  WriteKind,
  writeReducer
} from './harness'

const OTHER_HASH: Hex = `0x${'d'.repeat(64)}`

/** The error an event or a failed state carries, to compare by identity. */
const errorOf = (value: object): unknown => (value as { error?: unknown }).error

/** Drives one send of `write` from its submitting state, with the port and the wait given. */
const drive = async (
  write: WriteKind,
  port: ReturnType<typeof fakeSendPort>,
  wait: ReturnType<typeof fakeReceiptWait>
) => {
  const machine = drivenMachine(submittingFor(write))
  const run = machine.state().run
  const transaction = ownerTransaction(write)
  await driveSend({ dispatch: machine.dispatch, run, port, wait, key: KEY, transaction })
  return { machine, run, transaction }
}

describe('a send the wallet broadcast', () => {
  it('sends the transaction from the key given, announces its hash, then lands on its receipt', async () => {
    const port = fakeSendPort({ value: TX_HASH })
    const receipt = providerReceipt(TX_HASH, 1, { gasUsed: 51_234n, gasPrice: 2n * GWEI })
    const wait = fakeReceiptWait({ value: receipt })
    const { machine, run, transaction } = await drive('save', port, wait)

    expect(port.send).toHaveBeenCalledTimes(1)
    expect(port.send).toHaveBeenCalledWith(KEY, transaction)
    expect(wait).toHaveBeenCalledTimes(1)
    expect(wait).toHaveBeenCalledWith(TX_HASH)
    expect(machine.events).toEqual([
      { type: 'sent', run, transactionHash: TX_HASH },
      {
        type: 'receipt',
        run,
        receipt: {
          transactionHash: TX_HASH,
          status: 1,
          blockNumber: 7_000_001,
          gasUsed: 51_234n,
          effectiveGasPrice: 2n * GWEI
        }
      }
    ])
    expect(machine.state()).toMatchObject({ status: 'landed', transactionHash: TX_HASH, run })
  })

  it('waits in submitting under the hash until the receipt comes', async () => {
    const receiptLater = deferred<ProviderTransactionReceipt>()
    const machine = drivenMachine(submittingFor('cancel'))
    const { run } = machine.state()
    const driving = driveSend({
      dispatch: machine.dispatch,
      run,
      port: fakeSendPort({ value: TX_HASH }),
      wait: fakeReceiptWait({ pending: receiptLater.promise }),
      key: KEY,
      transaction: ownerTransaction('cancel')
    })
    await new Promise<void>((settle) => {
      setImmediate(settle)
    })
    expect(machine.state()).toEqual({
      status: 'submitting',
      write: 'cancel',
      transactionHash: TX_HASH,
      sentHashes: [TX_HASH],
      run
    })

    receiptLater.resolve(providerReceipt(TX_HASH, 1))
    await driving
    expect(readingOf(machine.state())).toBe('landed')
  })

  it('reads a receipt with status zero as reverted, under the hash', async () => {
    const { machine } = await drive(
      'edit',
      fakeSendPort({ value: TX_HASH }),
      fakeReceiptWait({ value: providerReceipt(TX_HASH, 0, { gasUsed: 10n, gasPrice: GWEI }) })
    )
    expect(machine.state()).toMatchObject({
      status: 'failedReverted',
      transactionHash: TX_HASH,
      gasSpent: 10n * GWEI
    })
  })
})

describe('a send the wallet refused', () => {
  SEND_REFUSAL_REASONS.forEach((reason) =>
    it(`reads the port's ${reason} refusal as failed, not sent, with the refusal as its error, and waits for no receipt`, async () => {
      const refusal = sendRefusal(reason, KEY)
      const wait = fakeReceiptWait({ value: providerReceipt(TX_HASH, 1) })
      const { machine, run } = await drive('save', fakeSendPort({ error: refusal }), wait)

      expect(wait).not.toHaveBeenCalled()
      expect(machine.events).toEqual([{ type: 'error', run, error: refusal }])
      expect(errorOf(machine.events[0])).toBe(refusal)
      expect(readingOf(machine.state())).toBe('notSent')
      expect(machine.state()).toMatchObject({ status: 'failedNotSent', run })
      expect(machine.state()).not.toHaveProperty('transactionHash')
      expect(errorOf(machine.state())).toBe(refusal)
    })
  )

  it('reads a rejection the wallet threw before any hash as failed, not sent', async () => {
    const rejection = userRejected()
    const { machine } = await drive(
      'cancel',
      fakeSendPort({ error: rejection }),
      fakeReceiptWait({ value: providerReceipt(TX_HASH, 1) })
    )
    expect(readingOf(machine.state())).toBe('notSent')
    expect(errorOf(machine.state())).toBe(rejection)
  })

  it('settles its own promise either way, so a consumer that does not await it sees no rejection', async () => {
    const machine = drivenMachine(submittingFor('save'))
    await expect(
      driveSend({
        dispatch: machine.dispatch,
        run: machine.state().run,
        port: fakeSendPort({ error: sendRefusal('refused', KEY) }),
        wait: fakeReceiptWait({ value: providerReceipt(TX_HASH, 1) }),
        key: KEY,
        transaction: ownerTransaction('save')
      })
    ).resolves.toBeUndefined()
    await expect(
      driveSend({
        dispatch: machine.dispatch,
        run: machine.state().run,
        port: fakeSendPort({ value: TX_HASH }),
        wait: fakeReceiptWait({ error: minedAndReverted(TX_HASH) }),
        key: KEY,
        transaction: ownerTransaction('save')
      })
    ).resolves.toBeUndefined()
  })
})

describe('an error of the receipt wait', () => {
  it("reads ethers' CALL_EXCEPTION as reverted under the hash, and hands the error on as ethers threw it", async () => {
    const reverted = minedAndReverted(TX_HASH)
    const { machine, run } = await drive(
      'save',
      fakeSendPort({ value: TX_HASH }),
      fakeReceiptWait({ error: reverted })
    )
    expect(machine.events).toEqual([
      { type: 'sent', run, transactionHash: TX_HASH },
      { type: 'error', run, error: reverted, transactionHash: TX_HASH }
    ])
    expect(errorOf(machine.events[1])).toBe(reverted)
    expect(readingOf(machine.state())).toBe('reverted')
    expect(machine.state()).toMatchObject({ status: 'failedReverted', transactionHash: TX_HASH })
  })

  const REPLACED: ('cancelled' | 'replaced')[] = ['cancelled', 'replaced']
  REPLACED.forEach((reason) =>
    it(`reads ethers' TRANSACTION_REPLACED, ${reason}, as the replaced reading: failed, not sent, with its reason`, async () => {
      const replaced = replacedBy(reason)
      const { machine } = await drive(
        'cancel',
        fakeSendPort({ value: TX_HASH }),
        fakeReceiptWait({ error: replaced })
      )
      expect(machine.state()).toMatchObject({ status: 'failedNotSent', replaced: reason })
      expect(errorOf(machine.state())).toBe(replaced)
    })
  )

  it("lands a repriced replacement under the replacement's hash, and reverts under it where it reverted", async () => {
    const landed = await drive(
      'save',
      fakeSendPort({ value: TX_HASH }),
      fakeReceiptWait({ error: replacedBy('repriced', 1) })
    )
    expect(landed.machine.state()).toMatchObject({
      status: 'landed',
      transactionHash: REPLACEMENT_HASH
    })
    const reverted = await drive(
      'save',
      fakeSendPort({ value: TX_HASH }),
      fakeReceiptWait({ error: replacedBy('repriced', 0) })
    )
    expect(reverted.machine.state()).toMatchObject({
      status: 'failedReverted',
      transactionHash: REPLACEMENT_HASH
    })
  })

  it('keeps the hash in the error of a wait that failed after the broadcast, so the write keeps waiting under it', async () => {
    const failures = [new Error('The node is not reachable.'), waitTimedOut(TX_HASH)]
    await Promise.all(
      failures.map(async (failure) => {
        const { machine, run } = await drive(
          'submission',
          fakeSendPort({ value: TX_HASH }),
          fakeReceiptWait({ error: failure })
        )
        expect(machine.events[1]).toEqual({
          type: 'error',
          run,
          error: failure,
          transactionHash: TX_HASH
        })
        expect(errorOf(machine.events[1])).toBe(failure)
        expect(machine.state()).toMatchObject({ status: 'submitting', transactionHash: TX_HASH })
        expect(readingOf(machine.state())).not.toBe('notSent')
      })
    )
  })
})

describe('a receipt the write does not settle by', () => {
  it('ignores a receipt for a hash the run never announced, and keeps waiting under its own', async () => {
    const machine = drivenMachine(submittingFor('save'))
    const { run } = machine.state()
    await driveSend({
      dispatch: machine.dispatch,
      run,
      port: fakeSendPort({ value: TX_HASH }),
      wait: fakeReceiptWait({ value: providerReceipt(OTHER_HASH, 1) }),
      key: KEY,
      transaction: ownerTransaction('save')
    })
    const announced = writeReducer(submittingFor('save'), {
      type: 'sent',
      run,
      transactionHash: TX_HASH
    })
    expect(machine.events.map((event) => event.type)).toEqual(['sent', 'receipt'])
    expect(machine.state()).toEqual(announced)
  })

  it('keeps waiting under the hash on a receipt with no status, as before Byzantium', async () => {
    const { machine } = await drive(
      'save',
      fakeSendPort({ value: TX_HASH }),
      fakeReceiptWait({ value: providerReceipt(TX_HASH, null) })
    )
    expect(machine.events.map((event) => event.type)).toEqual(['sent'])
    expect(machine.state()).toMatchObject({ status: 'submitting', transactionHash: TX_HASH })
  })

  it('changes nothing in a new run with the answers of a run the holder left behind', async () => {
    const hashLater = deferred<Hex>()
    const machine = drivenMachine(submittingFor('cancel'))
    const driving = driveSend({
      dispatch: machine.dispatch,
      run: machine.state().run,
      port: fakeSendPort({ pending: hashLater.promise }),
      wait: fakeReceiptWait({ value: providerReceipt(TX_HASH, 1) }),
      key: KEY,
      transaction: ownerTransaction('cancel')
    })
    machine.dispatch({ type: 'reset' })
    machine.dispatch({ type: 'start' })
    machine.dispatch({ type: 'gasChecked', run: machine.state().run, check: enoughCheck('cancel') })
    const current = machine.state()
    expect(current).toMatchObject({ status: 'submitting' })
    expect(current).not.toHaveProperty('transactionHash')

    hashLater.resolve(TX_HASH)
    await driving
    expect(machine.events.slice(-2).map((event) => event.type)).toEqual(['sent', 'receipt'])
    expect(machine.state()).toBe(current)
  })
})
