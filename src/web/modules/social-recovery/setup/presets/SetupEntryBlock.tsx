/**
 * What step 1 shows in place of the presets while the account's setup state
 * is not answered with no setup: the client connecting, the read running, a
 * read that failed with its retry, a wallet too old for the deployment, or
 * that the account already has a setup to edit instead.
 */
import React from 'react'
import { View } from 'react-native'

import Alert from '@common/components/Alert'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import { CHAIN_NAMES } from '@web/modules/social-recovery/recovery/entry/constants'
import { PageTitle } from '@web/modules/social-recovery/shared/chrome'
import LoadingBlock from '@web/modules/social-recovery/shared/chrome/LoadingBlock'
import ReadFailedBlock from '@web/modules/social-recovery/shared/chrome/ReadFailedBlock'
import { WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client'
import AlreadySetUpCard from '@web/modules/social-recovery/setup/review/AlreadySetUpCard'

import type { SetupEntryBlockProps } from './types'

const READS = 'socialRecovery.management.overview.reads'

const SetupEntryBlock = ({ entry, onOpen }: SetupEntryBlockProps) => {
  const { t } = useTranslation()

  return (
    <View testID="presets-entry">
      <PageTitle title={t('socialRecovery.routes.setup')} />
      {entry.status === 'connecting' && (
        <View testID="presets-entry-connecting">
          <LoadingBlock
            variant="block"
            message={t('socialRecovery.loading.client', {
              network: CHAIN_NAMES[WALLET_RECOVERY_CHAIN]
            })}
          />
        </View>
      )}
      {entry.status === 'reading' && (
        <View testID="presets-entry-reading">
          <LoadingBlock variant="block" message={t('socialRecovery.loading.lookup')} />
        </View>
      )}
      {entry.status === 'failed' && (
        <ReadFailedBlock
          testID="presets-entry-read-failed"
          title={t(`${READS}.failedTitle`)}
          body={t(`${READS}.failedBody`)}
          onRetry={entry.retry}
        />
      )}
      {entry.status === 'update-the-wallet' && (
        <Alert
          testID="presets-entry-update-the-wallet"
          type="error"
          size="sm"
          style={spacings.mbSm}
          title={t('socialRecovery.client.updateTheWalletTitle')}
          text={t('socialRecovery.client.updateTheWalletHow')}
        />
      )}
      {entry.status === 'answered' && (
        <View testID="presets-already-set-up">
          <AlreadySetUpCard onOpen={onOpen} />
        </View>
      )}
    </View>
  )
}

export default React.memo(SetupEntryBlock)
