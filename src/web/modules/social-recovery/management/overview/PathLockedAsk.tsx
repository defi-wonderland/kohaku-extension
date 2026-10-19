/**
 * The recovery password ask of a path this device cannot read: the locked
 * notice with its action, then the field and the unlock, the check running,
 * the wrong password's line over the field, and the failed read of the setup
 * event with its retry, which never says the password worked. The field's
 * value lives in this component alone and is emptied once a check starts.
 */
import React, { useCallback, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import InputPassword from '@common/components/InputPassword'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import { ActionsRow } from '@web/modules/social-recovery/shared/chrome'
import ReadFailedBlock from '@web/modules/social-recovery/shared/chrome/ReadFailedBlock'

import { OVERVIEW } from './constants'
import type { PathLockedAskProps } from './types'

const LOCKED = `${OVERVIEW}.locked`

const PathLockedAsk = ({
  ask,
  onUnlock,
  onAskAgain,
  onRetry,
  bare,
  testID
}: PathLockedAskProps) => {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')
  const [asking, setAsking] = useState(!!bare)

  const change = useCallback(
    (text: string) => {
      setTyped(text)
      if (ask.status === 'wrong') {
        onAskAgain()
      }
    },
    [ask.status, onAskAgain]
  )

  const submit = useCallback(() => {
    if (!typed || ask.status !== 'idle') {
      return
    }
    onUnlock(typed)
    setTyped('')
  }, [typed, ask.status, onUnlock])

  const renderBody = () => {
    if (ask.status === 'checking') {
      return <ActivityIndicator testID={`${testID}-checking`} style={spacings.mbSm} />
    }
    if (ask.status === 'event-failed') {
      return (
        <ReadFailedBlock
          testID={`${testID}-event-failed`}
          title={t(`${OVERVIEW}.reads.failedTitle`)}
          body={t(`${OVERVIEW}.reads.failedBody`)}
          onRetry={onRetry}
        />
      )
    }
    if (!asking) {
      return (
        <ActionsRow
          primary={
            <Button
              testID={`${testID}-action`}
              type="primary"
              text={t(`${LOCKED}.action`)}
              onPress={() => setAsking(true)}
              hasBottomSpacing={false}
            />
          }
        />
      )
    }
    return (
      <View>
        {ask.status === 'wrong' && (
          <Alert
            testID={`${testID}-wrong`}
            type="error"
            size="sm"
            style={spacings.mbSm}
            text={t(`${LOCKED}.wrong`)}
          />
        )}
        <InputPassword
          testID={`${testID}-field`}
          label={t(`${LOCKED}.field`)}
          accessibilityLabel={t(`${LOCKED}.field`)}
          value={typed}
          onChangeText={change}
          onSubmitEditing={submit}
          containerStyle={spacings.mb0}
        />
        <ActionsRow
          primary={
            <Button
              testID={`${testID}-unlock`}
              type="primary"
              text={t(`${LOCKED}.unlock`)}
              disabled={!typed || ask.status !== 'idle'}
              onPress={submit}
              hasBottomSpacing={false}
            />
          }
        />
      </View>
    )
  }

  return (
    <View testID={testID}>
      {!bare && (
        <>
          <Text fontSize={16} weight="medium" style={spacings.mbTy} testID={`${testID}-title`}>
            {t(`${LOCKED}.title`)}
          </Text>
          <Text fontSize={14} style={spacings.mbSm} testID={`${testID}-body`}>
            {t(`${LOCKED}.body`)}
          </Text>
        </>
      )}
      {renderBody()}
    </View>
  )
}

export default React.memo(PathLockedAsk)
