/**
 * The shared submitting and failed states (ux.md D-319), rendered from a
 * write's state. Every write of the chapter renders this view and none draws
 * its own: the copy comes from `renderWriteState` and the rules from the
 * machine, so this component only lays them out.
 *
 * A write's screen may set its own title over the state (the setup could not
 * be saved, the recovery could not be started) and its own sentence after the
 * reading, from its own keys. The reverted reading already speaks in the
 * write's own words (`REVERTED_KEYS`), so a note belongs after the not-sent
 * reading, where the frame adds what stays on this device. Its own actions,
 * such as back or the cancel's move-funds action where `offersMoveFunds`
 * answers true, go in as children.
 */
import React, { ReactNode } from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Spinner from '@common/components/Spinner'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import type { Translate } from '@web/modules/social-recovery/shared/display'

import { renderWriteState } from '../copy'
import type { WriteState } from '../states'

export interface WriteStateViewProps {
  state: WriteState
  /** The write's own title over the state, from its own keys. */
  title?: string
  /** The write's own sentence after the reading, from its own keys. */
  note?: string
  /** Runs the write again; the view shows the retry only where the state offers it. */
  onRetry?: () => void
  /** The write's own actions, under the state. */
  children?: ReactNode
  testID?: string
}

const WriteStateView = ({ state, title, note, onRetry, children, testID }: WriteStateViewProps) => {
  const { t: i18nT } = useTranslation()
  const t: Translate = (key, options) => String(i18nT(key, options))

  if (state.status === 'checkingGas') {
    return (
      <View testID={testID}>
        <Spinner />
      </View>
    )
  }
  if (
    state.status !== 'submitting' &&
    state.status !== 'failedNotSent' &&
    state.status !== 'failedReverted'
  ) {
    return null
  }

  const rendered = renderWriteState(state, t)
  const heading = title ?? rendered.title

  return (
    <View testID={testID}>
      {!!rendered.chip && (
        <Text fontSize={12} weight="medium" appearance="secondaryText" style={spacings.mbTy}>
          {rendered.chip}
        </Text>
      )}
      {!!heading && (
        <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
          {heading}
        </Text>
      )}
      {rendered.lines.map((line) => (
        <Text key={line} fontSize={14} style={spacings.mbSm}>
          {line}
        </Text>
      ))}
      {!!rendered.controller && (
        <View style={spacings.mbSm}>
          <Text fontSize={12} appearance="secondaryText" style={spacings.mbMi}>
            {rendered.controller.label}
          </Text>
          <Text fontSize={14} weight="number_medium" selectable>
            {rendered.controller.address}
          </Text>
        </View>
      )}
      {!!note && (
        <Text fontSize={14} appearance="secondaryText" style={spacings.mbSm}>
          {note}
        </Text>
      )}
      {!!rendered.retry && !!onRetry && (
        <Button type="primary" text={rendered.retry} onPress={onRetry} hasBottomSpacing={false} />
      )}
      {children}
    </View>
  )
}

export default React.memo(WriteStateView)
