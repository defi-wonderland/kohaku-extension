/**
 * The wait's chrome by route: on the logged-in route the settings chrome with
 * the five-stage counter at its fifth stage; on the fresh install the plain
 * header, with no counter.
 */
import React from 'react'

import { useTranslation } from '@common/config/localization'
import { StepCounter } from '@web/modules/social-recovery/shared/chrome'
import PlainChrome from '@web/modules/social-recovery/shared/chrome/PlainChrome'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'
import { RECOVERY_STAGES, STAGE_COUNTER_KEY } from '@web/modules/social-recovery/recovery/checklist'

import { WAIT_STAGE } from './constants'
import type { WaitChromeProps } from './types'

const WaitChrome = ({ route, children, testID }: WaitChromeProps) => {
  const { t } = useTranslation()

  if (route === 'fresh-install') {
    return (
      <PlainChrome title={t('socialRecovery.routes.recovery')} testID={testID}>
        {children}
      </PlainChrome>
    )
  }
  return (
    <SetupChrome testID={testID}>
      <StepCounter
        labelKey={STAGE_COUNTER_KEY}
        step={WAIT_STAGE}
        total={RECOVERY_STAGES}
        testID="wait-stage"
      />
      {children}
    </SetupChrome>
  )
}

export default React.memo(WaitChrome)
