/**
 * The checklist's chrome by route: on the logged-in route the settings chrome
 * with the five-stage counter at its fourth stage; on the fresh install the
 * plain header, with no counter from the account step on.
 */
import React from 'react'

import { useTranslation } from '@common/config/localization'
import { StepCounter } from '@web/modules/social-recovery/shared/chrome'
import PlainChrome from '@web/modules/social-recovery/shared/chrome/PlainChrome'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'

import { CHECKLIST_STAGE, RECOVERY_STAGES, STAGE_COUNTER_KEY } from './constants'
import type { ChecklistChromeProps } from './types'

const ChecklistChrome = ({ route, children, testID }: ChecklistChromeProps) => {
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
        step={CHECKLIST_STAGE}
        total={RECOVERY_STAGES}
        testID="checklist-stage"
      />
      {children}
    </SetupChrome>
  )
}

export default React.memo(ChecklistChrome)
