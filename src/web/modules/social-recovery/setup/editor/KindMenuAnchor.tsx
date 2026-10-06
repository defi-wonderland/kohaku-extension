import React, { useRef } from 'react'
import { View } from 'react-native'

import KindMenu from './KindMenu'
import type { KindMenuAnchorNode, KindMenuAnchorProps } from './types'
import useCloseOnOutsidePress from './useCloseOnOutsidePress'

/**
 * A control and the kind menu it opens, right under it in the page's flow. A
 * press anywhere else closes the menu.
 */
const KindMenuAnchor = ({
  children,
  open,
  kinds,
  onPick,
  onClose,
  disabled,
  menuTestID,
  style
}: KindMenuAnchorProps) => {
  const anchor = useRef<KindMenuAnchorNode>(null)
  useCloseOnOutsidePress(anchor, open, onClose)

  return (
    <View ref={anchor} style={style}>
      {children}
      {open && <KindMenu kinds={kinds} onPick={onPick} disabled={disabled} testID={menuTestID} />}
    </View>
  )
}

export default React.memo(KindMenuAnchor)
