/**
 * The recovery in progress's route: the settings chrome around the list of
 * the recovery chain's live sessions, with this device's hold on each
 * account's unlocked path, the decrypted setup cache or the recovery password
 * held in memory.
 */
import React, { useCallback, useMemo } from 'react'

import useNavigation from '@common/hooks/useNavigation'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import {
  createWalletRecords,
  extensionRecordStorage,
  readRecoveryPassword
} from '@web/modules/social-recovery/shared/records'

import InProgressView from './InProgressView'
import useSessionHeadline from './useSessionHeadline'

const CHAIN_ID = CHAIN_IDS[WALLET_RECOVERY_CHAIN]

const InProgressScreen = () => {
  const { navigate } = useNavigation()
  const records = useMemo(() => createWalletRecords({ storage: extensionRecordStorage }), [])
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const holdsPath = useCallback(
    async (account: Address) => {
      if (readRecoveryPassword(CHAIN_ID, account) !== undefined) {
        return true
      }
      const cached = await records.decryptedSetupCache(CHAIN_ID, account).read()
      return cached.status === 'present'
    },
    [records]
  )

  return (
    <SetupChrome testID="in-progress-screen">
      <InProgressView
        records={records}
        chainId={CHAIN_ID}
        navigate={navigate}
        timeZone={timeZone}
        holdsPath={holdsPath}
        useHeadline={useSessionHeadline}
      />
    </SetupChrome>
  )
}

export default React.memo(InProgressScreen)
