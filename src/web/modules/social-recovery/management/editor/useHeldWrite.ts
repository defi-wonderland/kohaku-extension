/**
 * Which write the account's stored write in flight belongs to, read once per
 * mount and again on retry: none, one of the editor's two, or another
 * screen's. A screen builds its run only over no stored write or its own, so
 * a run never follows another screen's write as its own.
 */
import { useCallback, useEffect, useState } from 'react'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import type { ChainId, WalletRecords } from '@web/modules/social-recovery/shared/records'

import { writeOfRequest } from './steps'
import type { HeldWrite, HeldWriteRead } from './types'

export const useHeldWrite = (
  records: Pick<WalletRecords, 'saveInFlight'>,
  chainId: ChainId,
  account: Address
): HeldWriteRead => {
  const [held, setHeld] = useState<HeldWrite>({ status: 'pending' })
  const [round, setRound] = useState(0)

  useEffect(() => {
    let live = true
    setHeld({ status: 'pending' })
    records
      .saveInFlight(chainId, account)
      .read()
      .then(
        (read) => {
          if (!live) {
            return
          }
          if (read.status !== 'present') {
            setHeld({ status: 'none' })
            return
          }
          const write = writeOfRequest(read.value.requestId)
          setHeld(write ? { status: 'held', write } : { status: 'other' })
        },
        () => {
          if (live) {
            setHeld({ status: 'failed' })
          }
        }
      )
    return () => {
      live = false
    }
  }, [records, chainId, account, round])

  const retry = useCallback(() => setRound((at) => at + 1), [])
  return { held, retry }
}
