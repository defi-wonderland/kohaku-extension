/**
 * The deposit step (ux.md D-303, D-319, D-307, D-393), rendered from the gas
 * check's data. The copy comes from `renderDepositStep` and the rules from
 * the gas check, so this component only lays them out: the key's address in
 * full with a copy action, the routes that fill it, the notes and, for a
 * recovery call, the lines of a step that waits for the funds.
 *
 * `variant="blocker"` renders the short panel a write's own screen shows when
 * the check at sending comes up short (frame D-11's no-gas state), which leads
 * to the step. The write's own actions (continue, back, fund the key) go in as
 * children. The step links to nothing.
 */
import React, { ReactNode, useCallback } from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { setStringAsync } from '@common/utils/clipboard'
import type { Translate } from '@web/modules/social-recovery/shared/display'

import { renderDepositStep } from '../copy'
import type { DepositStep } from '../gas'

export interface DepositStepViewProps {
  step: DepositStep
  /** The key's latest balance while the step waits for the funds; the step's own by default. */
  balance?: bigint
  /** `step` renders the whole step; `blocker` the short panel that leads to it. */
  variant?: 'step' | 'blocker'
  /** Copies the key's address; the clipboard by default. */
  onCopy?: (address: string) => void
  /** The write's own actions. */
  children?: ReactNode
  testID?: string
}

const Lines = ({ lines, secondary }: { lines: string[]; secondary?: boolean }) => (
  <>
    {lines.map((line) => (
      <Text
        key={line}
        fontSize={14}
        appearance={secondary ? 'secondaryText' : 'primaryText'}
        style={spacings.mbSm}
      >
        {line}
      </Text>
    ))}
  </>
)

const DepositStepView = ({
  step,
  balance,
  variant = 'step',
  onCopy,
  children,
  testID
}: DepositStepViewProps) => {
  const { t: i18nT } = useTranslation()
  const t: Translate = (key, options) => String(i18nT(key, options))
  const rendered = renderDepositStep(step, balance === undefined ? {} : { balance }, t)

  const copy = useCallback(() => {
    if (onCopy) onCopy(rendered.keyAddress)
    else setStringAsync(rendered.keyAddress).catch(() => {})
  }, [onCopy, rendered.keyAddress])

  const keyBlock = (
    <View style={spacings.mbSm}>
      {!!rendered.keyLabel && (
        <Text fontSize={12} appearance="secondaryText" style={spacings.mbMi}>
          {rendered.keyLabel}
        </Text>
      )}
      <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.wrap]}>
        <Text fontSize={14} weight="number_medium" selectable style={spacings.mrTy}>
          {rendered.keyAddress}
        </Text>
        <Button
          type="secondary"
          size="small"
          text={rendered.copyLabel}
          onPress={copy}
          hasBottomSpacing={false}
        />
      </View>
    </View>
  )

  if (variant === 'blocker') {
    return (
      <View testID={testID}>
        <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
          {rendered.blocker.title}
        </Text>
        <Lines lines={[rendered.blocker.line]} />
        {keyBlock}
        {children}
      </View>
    )
  }

  return (
    <View testID={testID}>
      {!!rendered.eyebrow && (
        <Text fontSize={12} weight="medium" appearance="warningText" style={spacings.mbTy}>
          {rendered.eyebrow}
        </Text>
      )}
      <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
        {rendered.title}
      </Text>
      <Lines lines={rendered.lead} />
      {keyBlock}
      {rendered.routes.map((route) => (
        <View key={route.kind} style={spacings.mbSm}>
          <Text fontSize={14} weight="medium">
            {route.line}
          </Text>
          {!!route.note && (
            <Text fontSize={12} appearance="secondaryText">
              {route.note}
            </Text>
          )}
        </View>
      ))}
      <Lines lines={rendered.notes} secondary />
      <Lines lines={rendered.waiting} secondary />
      {children}
      {!!rendered.actionHint && (
        <Text fontSize={12} appearance="secondaryText" style={spacings.mtTy}>
          {rendered.actionHint}
        </Text>
      )}
    </View>
  )
}

export default React.memo(DepositStepView)
