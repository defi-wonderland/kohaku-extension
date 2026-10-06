/**
 * The done screen's chrome by route, with no counter on either: on the fresh
 * install the plain header; on the logged-in route, and where the entry
 * record is gone, the settings chrome with its breadcrumb.
 */
import React from 'react'

import { useTranslation } from '@common/config/localization'
import PlainChrome from '@web/modules/social-recovery/shared/chrome/PlainChrome'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'

import type { DoneChromeProps } from './types'

const DoneChrome = ({ route, children, testID }: DoneChromeProps) => {
  const { t } = useTranslation()

  if (route === 'fresh-install') {
    return (
      <PlainChrome title={t('socialRecovery.routes.recovery')} testID={testID}>
        {children}
      </PlainChrome>
    )
  }
  return <SetupChrome testID={testID}>{children}</SetupChrome>
}

export default React.memo(DoneChrome)
