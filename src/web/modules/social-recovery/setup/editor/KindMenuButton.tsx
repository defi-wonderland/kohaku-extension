import React from 'react'

import DownArrowIcon from '@common/assets/svg/DownArrowIcon'
import UpArrowIcon from '@common/assets/svg/UpArrowIcon'
import Button from '@common/components/Button'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'

import KindMenuAnchor from './KindMenuAnchor'
import type { KindMenuButtonProps } from './types'

/** A button that opens the kinds it can add, each one a single press away. */
const KindMenuButton = ({
  text,
  open,
  kinds,
  onToggle,
  onPick,
  onClose,
  disabled,
  testID,
  style
}: KindMenuButtonProps) => (
  <KindMenuAnchor
    open={open}
    kinds={kinds}
    onPick={onPick}
    onClose={onClose}
    disabled={disabled}
    menuTestID={`${testID}-menu`}
    style={[flexbox.alignSelfStart, style]}
  >
    <Button
      testID={testID}
      type="secondary"
      size="small"
      text={text}
      onPress={onToggle}
      disabled={disabled}
      hasBottomSpacing={false}
      accessibilityState={{ expanded: open }}
      aria-haspopup="menu"
      childrenPosition="right"
    >
      {open ? <UpArrowIcon style={spacings.mlTy} /> : <DownArrowIcon style={spacings.mlTy} />}
    </Button>
  </KindMenuAnchor>
)

export default React.memo(KindMenuButton)
