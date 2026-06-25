import React, { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import ScrollableWrapper from '@common/components/ScrollableWrapper'
import flexbox from '@common/styles/utils/flexbox'
import SettingsPageHeader from '@web/modules/settings/components/SettingsPageHeader'
import { SettingsRoutesContext } from '@web/modules/settings/contexts/SettingsRoutesContext'

import RecoveryForm from './components/RecoveryForm'

const RecoverySettingsScreen = () => {
  const { t } = useTranslation()
  const { setCurrentSettingsPage } = useContext(SettingsRoutesContext)

  useEffect(() => {
    // Must match the Sidebar SETTINGS_LINKS `key` for the active highlight.
    setCurrentSettingsPage('recovery')
  }, [setCurrentSettingsPage])

  return (
    <View style={[flexbox.flex1]}>
      <SettingsPageHeader title={t('Recovery (v0)')} />
      <ScrollableWrapper>
        <RecoveryForm />
      </ScrollableWrapper>
    </View>
  )
}

export default React.memo(RecoverySettingsScreen)
