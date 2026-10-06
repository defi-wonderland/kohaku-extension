/**
 * The chrome a recovery screen draws by its route: the settings chrome with the
 * stage counter on the logged-in route, the plain header with no counter on
 * the fresh install's.
 */
import React from 'react'

import { useTranslation } from '@common/config/localization'
import { StepCounter } from '@web/modules/social-recovery/shared/chrome'
import PlainChrome from '@web/modules/social-recovery/shared/chrome/PlainChrome'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'

import { RECOVERY_STAGE_COUNTER_KEY, RECOVERY_STAGES } from './constants'
import type { EntryChromeProps } from './types'

const EntryChrome = ({ route, stage, children, testID }: EntryChromeProps) => {
  const { t } = useTranslation()

  if (route === 'fresh-install') {
    return (
      <PlainChrome title={t('socialRecovery.routes.recover')} testID={testID}>
        {children}
      </PlainChrome>
    )
  }

  return (
    <SetupChrome testID={testID}>
      <StepCounter
        labelKey={RECOVERY_STAGE_COUNTER_KEY}
        step={stage}
        total={RECOVERY_STAGES}
        testID="recovery-stage"
      />
      {children}
    </SetupChrome>
  )
}

export default React.memo(EntryChrome)
