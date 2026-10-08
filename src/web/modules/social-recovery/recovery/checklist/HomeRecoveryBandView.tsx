/**
 * The home surface's pointer to the recoveries this device started and did
 * not submit, one line for each live session of the chain. It renders nothing
 * while the records load, where they cannot be read, and where no live
 * session exists.
 */
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'

import spacings from '@common/styles/spacings'

import HomeRecoveryLine from './HomeRecoveryLine'
import { inProgressItemsOf } from './inProgress'
import { inProgressPath } from './search'
import type { HomeRecoveryBandViewProps, InProgressItem } from './types'

const HomeRecoveryBandView = ({
  records,
  chainId,
  navigate,
  timeZone,
  useHeadline
}: HomeRecoveryBandViewProps) => {
  const [items, setItems] = useState<InProgressItem[]>([])

  useEffect(() => {
    let live = true
    Promise.all([records.listRecoverySessions(chainId), records.listRecoveryEntries(chainId)])
      .then(([sessions, entries]) => {
        if (live) {
          setItems(inProgressItemsOf(sessions, entries))
        }
      })
      .catch(() => {
        if (live) {
          setItems([])
        }
      })
    return () => {
      live = false
    }
  }, [records, chainId])

  if (items.length === 0) {
    return null
  }
  return (
    <View style={[spacings.phSm, spacings.mbSm]} testID="home-recovery-band">
      {items.map((item) => (
        <HomeRecoveryLine
          key={item.account}
          item={item}
          timeZone={timeZone}
          useHeadline={useHeadline}
          onOpen={() => navigate(inProgressPath())}
        />
      ))}
    </View>
  )
}

export default React.memo(HomeRecoveryBandView)
