/**
 * The driver of a write's send: it feeds the machine (machine.ts) the answers
 * of the client's send port and receipt wait, and nothing else. The machine
 * and the classification (classify.ts) decide every reading.
 *
 * 1. The send port puts the transaction through the request queue into the
 *    action window. Its hash arrives as `sent`; a refusal arrives as `error`
 *    as it was thrown, which reads that nothing was sent.
 * 2. The receipt wait follows that hash. Its receipt arrives as `receipt`; an
 *    error arrives as `error` as ethers threw it, with the hash: a reverted
 *    receipt it carries reads as a revert, a replacement as replaced, and any
 *    other error keeps the write submitting under its hash.
 *
 * Every answer carries the run it was started for, so the machine drops the
 * answers of a run the holder left behind.
 */
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'

import { receiptOf } from './classify'
import type { SendDrive } from './types'

export const driveSend = async ({
  dispatch,
  run,
  port,
  wait,
  key,
  transaction
}: SendDrive): Promise<void> => {
  let transactionHash: Hex
  try {
    transactionHash = await port.send(key, transaction)
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error })
    return
  }
  dispatch({ type: 'sent', run, transactionHash })
  try {
    const receipt = receiptOf(await wait(transactionHash))
    // A receipt with no status reads neither way, so the write keeps its hash.
    if (receipt) dispatch({ type: 'receipt', run, receipt })
  } catch (error: unknown) {
    dispatch({ type: 'error', run, error, transactionHash })
  }
}
