/**
 * The card's recovery password for the selected account: the one the holder
 * keeps in memory, else one a check opened here. At the hidden level with none,
 * the account's setup is read: a saved setup lets the holder type the password
 * again, checked by opening the saved backup with it; no saved setup leads back
 * to the privacy step. A setup read that fails, or a client that cannot be
 * built, still shows the ask, since the check itself says whether a setup
 * answers. The typed password goes to the check and, once it opens the backup,
 * to the in-memory holder; nothing else keeps it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAddressEqual } from 'viem'

import type { Address, RestoreRefusal } from '@web/modules/social-recovery/sdk-interfaces'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import {
  readRecoveryPassword,
  setRecoveryPassword
} from '@web/modules/social-recovery/shared/records'

import type {
  CardLevel,
  CardPassword,
  MissingPasswordRow,
  OpenedPassword,
  RecoveryPasswordCheck,
  SetupReading
} from './types'

const chainId = CHAIN_IDS[WALLET_RECOVERY_CHAIN]

const READING: MissingPasswordRow = { kind: 'reading' }
const GONE: MissingPasswordRow = { kind: 'gone' }

const sameAccount = (a: Address | null, b: Address): boolean => !!a && isAddressEqual(a, b)

/** The refusal of a setup read whose password does not open the saved backup. */
const isBackupUnopened = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return false
  }
  const { cause } = error as Partial<RestoreRefusal>
  return typeof cause === 'object' && cause !== null && cause.code === 'restore.backup-unopened'
}

export const useCardPassword = (address: Address | null, level: CardLevel | null): CardPassword => {
  const held = useMemo(
    () => (address ? readRecoveryPassword(chainId, address) : undefined),
    [address]
  )
  const [opened, setOpened] = useState<OpenedPassword | null>(null)
  const password =
    held ?? (opened && sameAccount(address, opened.address) ? opened.password : undefined)

  // The client is built only while the card has no password to show.
  const needed = !!address && level === 'hidden' && !password
  const clientState = useRecoveryClient(needed && address ? address : undefined)
  const { retry } = clientState
  const kit = clientState.status === 'ready' ? clientState.client : null
  const clientFailed = clientState.status === 'failed' || clientState.status === 'update-the-wallet'

  const [reading, setReading] = useState<SetupReading | null>(null)
  const readRow = reading && sameAccount(address, reading.address) ? reading.row : null

  useEffect(() => {
    if (!needed || !address || readRow) {
      return
    }
    if (clientFailed) {
      setReading({ address, row: 'ask' })
      return
    }
    if (!kit) {
      return
    }
    let live = true
    Promise.resolve()
      .then(() => kit.setup.setupState())
      .then((state) => {
        if (live) {
          setReading({ address, row: state.hasSetup ? 'ask' : 'gone' })
        }
      })
      .catch(() => {
        if (live) {
          setReading({ address, row: 'ask' })
        }
      })
    return () => {
      live = false
    }
  }, [needed, address, readRow, clientFailed, kit])

  // An answer counts only for the account still selected on a mounted screen.
  const current = useRef(address)
  current.current = address
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const check = useCallback(
    async (typed: string): Promise<RecoveryPasswordCheck> => {
      if (!address) {
        return 'stale'
      }
      if (!kit) {
        if (clientFailed) {
          retry()
        }
        return 'unchecked'
      }
      const stillHere = () => mounted.current && sameAccount(current.current, address)
      try {
        await kit.setup.getSetup({ password: typed })
      } catch (error: unknown) {
        if (!stillHere()) {
          return 'stale'
        }
        return isBackupUnopened(error) ? 'wrong' : 'unchecked'
      }
      if (!stillHere()) {
        return 'stale'
      }
      setRecoveryPassword(chainId, address, typed)
      setOpened({ address, password: typed })
      return 'opened'
    },
    [address, kit, clientFailed, retry]
  )

  const missingPassword = useMemo<MissingPasswordRow>(() => {
    if (readRow === 'gone') {
      return GONE
    }
    if (readRow === 'ask') {
      return { kind: 'ask', check }
    }
    return READING
  }, [readRow, check])

  return { password, missingPassword }
}
