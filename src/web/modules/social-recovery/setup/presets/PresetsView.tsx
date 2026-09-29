/**
 * The screen setup lands on: the three costs and the honesty note, then either
 * the grid of presets with the empty start, or, for a holder with an
 * unfinished draft, the draft's age with resume and start over. A pick writes
 * its draft and opens the editor; nothing is enrolled, refused or saved here.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import useTheme from '@common/hooks/useTheme'
import spacings from '@common/styles/spacings'
import common from '@common/styles/utils/common'
import flexbox from '@common/styles/utils/flexbox'
import { addressBookOf, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client'
import { renderChip } from '@web/modules/social-recovery/shared/display'

import { startDraft } from './draft'
import { cardRuleLines, shapeRowsOf } from './lines'
import { PRESETS } from './presets'
import { draftAgeLine, notStartedRowsOf, resumeRowsOf } from './resume'
import type { Preset, PresetChoice, PresetsViewProps, ResumeRow } from './types'

const COST_KEYS = [
  'socialRecovery.costLines.save',
  'socialRecovery.costLines.recovery',
  'socialRecovery.costLines.cancel'
] as const

const PresetsView = ({ records, chainId, account, onOpenEditor, onRecover }: PresetsViewProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  // `undefined` until the stored draft is read, `null` when there is none.
  const [savedAt, setSavedAt] = useState<number | null | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  const [writeFailed, setWriteFailed] = useState(false)
  const [resumeRows, setResumeRows] = useState<ResumeRow[]>([])
  const [picked, setPicked] = useState<PresetChoice | null>(null)
  const [busy, setBusy] = useState(false)

  const setup = useMemo(() => records.setup(chainId, account), [records, chainId, account])

  const load = useCallback(async () => {
    const [at, enrollments, draft] = await Promise.all([
      records.setupSavedAt(chainId, account),
      setup.enrollments.read(),
      setup.setupDraft.read()
    ])
    const book = addressBookOf(WALLET_RECOVERY_CHAIN)
    const enrolled = enrollments.status === 'present' ? enrollments.value : []
    const clauses = draft.status === 'present' ? draft.value.clauses : []
    setResumeRows([
      ...resumeRowsOf(enrolled, book, t),
      ...notStartedRowsOf(clauses, enrolled, book, t)
    ])
    setSavedAt(at)
  }, [records, setup, chainId, account, t])

  // A failed read shows its own state, never the cards: the holder may have a
  // draft this device could not read.
  const reload = useCallback(() => {
    setLoadFailed(false)
    return load().catch(() => {
      setSavedAt(undefined)
      setLoadFailed(true)
    })
  }, [load])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    reload()
  }, [reload])

  const open = useCallback(
    async (choice: PresetChoice) => {
      setBusy(true)
      try {
        await startDraft(setup, choice)
        setWriteFailed(false)
        onOpenEditor()
      } catch {
        setWriteFailed(true)
      } finally {
        setBusy(false)
      }
    },
    [setup, onOpenEditor]
  )

  const startOver = useCallback(async () => {
    setBusy(true)
    try {
      await records.startOverSetup(chainId, account)
      setWriteFailed(false)
      setPicked(null)
      await reload()
    } catch {
      setWriteFailed(true)
    } finally {
      setBusy(false)
    }
  }, [records, chainId, account, reload])

  const cardStyle = (choice: PresetChoice) => [
    spacings.ph,
    spacings.pv,
    spacings.mbSm,
    common.borderRadiusPrimary,
    {
      borderWidth: 1,
      borderColor: picked === choice ? theme.primary : theme.secondaryBorder
    }
  ]

  const renderPreset = (preset: Preset) => (
    <Pressable
      key={preset.id}
      testID={`preset-${preset.id}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: picked === preset.id }}
      onPress={() => setPicked(preset.id)}
      style={cardStyle(preset.id)}
    >
      <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
        {t(preset.nameKey)}
      </Text>
      {shapeRowsOf(preset, t).map((row, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <View key={index}>
          {index > 0 && (
            <Text fontSize={12} weight="medium" appearance="secondaryText" style={spacings.mbTy}>
              {t('socialRecovery.shape.and')}
            </Text>
          )}
          {row.kind === 'required' ? (
            <Text fontSize={14} style={spacings.mbTy}>
              {row.text}
            </Text>
          ) : (
            <View style={spacings.mbTy}>
              <Text fontSize={14} weight="medium">
                {row.count}
              </Text>
              {row.members.map((member, memberIndex) => (
                // eslint-disable-next-line react/no-array-index-key
                <Text key={memberIndex} fontSize={14}>
                  {member}
                </Text>
              ))}
            </View>
          )}
        </View>
      ))}
      {cardRuleLines(preset, t).map((line) => (
        <Text key={line} testID={`rule-line-${preset.id}`} fontSize={14} style={spacings.mtTy}>
          {line}
        </Text>
      ))}
      {!!preset.taglineKey && (
        <Text fontSize={14} appearance="secondaryText" style={spacings.mtTy}>
          {t(preset.taglineKey)}
        </Text>
      )}
    </Pressable>
  )

  const renderGrid = () => (
    <View testID="presets-grid">
      <Button
        testID="customize"
        type="secondary"
        text={t('socialRecovery.presets.customize')}
        disabled={busy}
        onPress={() => open('fromScratch')}
        style={spacings.mbLg}
      />
      <Text fontSize={12} weight="medium" appearance="secondaryText" style={spacings.mbSm}>
        {t('socialRecovery.presets.pickOne')}
      </Text>
      {PRESETS.map(renderPreset)}
      <Pressable
        testID="preset-fromScratch"
        accessibilityRole="radio"
        accessibilityState={{ checked: picked === 'fromScratch' }}
        onPress={() => setPicked('fromScratch')}
        style={cardStyle('fromScratch')}
      >
        <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
          {t('socialRecovery.presets.cards.fromScratch.name')}
        </Text>
        <Text fontSize={14} style={spacings.mbTy}>
          {t('socialRecovery.presets.cards.fromScratch.line')}
        </Text>
        <Text fontSize={14} appearance="secondaryText">
          {t('socialRecovery.presets.cards.fromScratch.oneDevice')}
        </Text>
      </Pressable>
      <Button
        testID="continue"
        text={t('socialRecovery.actions.continue')}
        disabled={!picked || busy}
        onPress={() => picked && open(picked)}
        style={spacings.mtSm}
      />
      {!picked && (
        <Text fontSize={12} appearance="secondaryText" style={spacings.mtTy}>
          {t('socialRecovery.presets.continueUnlock')}
        </Text>
      )}
    </View>
  )

  const renderResume = (at: number) => (
    <View testID="presets-resume">
      <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
        {t('socialRecovery.presets.resume.action')}
      </Text>
      <Text testID="draft-age" fontSize={14} style={spacings.mbSm}>
        {draftAgeLine(at, t)}
      </Text>
      {resumeRows.map((row) => (
        <View
          key={row.id}
          testID="resume-row"
          style={[flexbox.directionRow, flexbox.justifySpaceBetween, spacings.mbSm]}
        >
          <View style={flexbox.flex1}>
            <Text fontSize={14}>{row.name}</Text>
            {!!row.note && (
              <Text fontSize={12} appearance="secondaryText">
                {row.note}
              </Text>
            )}
          </View>
          <Text testID="resume-chip" fontSize={12} weight="medium" appearance="secondaryText">
            {row.chip}
          </Text>
        </View>
      ))}
      <View style={[flexbox.directionRow, spacings.mtSm]}>
        <Button
          testID="resume"
          text={t('socialRecovery.presets.resume.action')}
          disabled={busy}
          onPress={onOpenEditor}
          style={spacings.mrSm}
        />
        <Button
          testID="start-over"
          type="secondary"
          text={t('socialRecovery.presets.resume.startOver')}
          disabled={busy}
          onPress={startOver}
        />
      </View>
      <Text fontSize={12} appearance="secondaryText" style={spacings.mtTy}>
        {t('socialRecovery.records.startOverNote')}
      </Text>
    </View>
  )

  const renderLoadFailed = () => (
    <View testID="presets-load-failed">
      <Text fontSize={14} appearance="errorText" style={spacings.mbSm}>
        {t('socialRecovery.records.loadFailed')}
      </Text>
      <Button
        testID="load-retry"
        type="secondary"
        text={t('socialRecovery.writes.tryAgain')}
        onPress={reload}
      />
    </View>
  )

  return (
    <View testID="presets-screen">
      <Text fontSize={20} weight="medium" style={spacings.mbSm}>
        {t('socialRecovery.routes.setup')}
      </Text>
      <Text fontSize={14} style={spacings.mbLg}>
        {t('socialRecovery.presets.lead')}
      </Text>
      <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbLg]}>
        <Text fontSize={14} weight="medium" style={spacings.mrSm}>
          {t('socialRecovery.routes.root')}
        </Text>
        <Text testID="recovery-status" fontSize={12} weight="medium" appearance="secondaryText">
          {renderChip('recovery', 'notSetUp', t)}
        </Text>
      </View>
      <View testID="cost-lines" style={spacings.mbSm}>
        {COST_KEYS.map((key) => (
          <Text key={key} fontSize={14} style={spacings.mbTy}>
            {t(key)}
          </Text>
        ))}
      </View>
      <Text testID="honesty-note" fontSize={14} weight="medium" style={spacings.mbLg}>
        {t('socialRecovery.honestyNote')}
      </Text>
      {writeFailed && (
        <Text testID="write-failed" fontSize={14} appearance="errorText" style={spacings.mbSm}>
          {t('socialRecovery.records.writeFailed')}
        </Text>
      )}
      {loadFailed && renderLoadFailed()}
      {!loadFailed && savedAt === null && renderGrid()}
      {!loadFailed && typeof savedAt === 'number' && renderResume(savedAt)}
      <View style={spacings.mtLg}>
        <Button
          testID="recover"
          type="secondary"
          text={t('socialRecovery.routes.recover')}
          onPress={onRecover}
        />
        <Text fontSize={12} appearance="secondaryText">
          {t('socialRecovery.presets.recoverLine')}
        </Text>
      </View>
    </View>
  )
}

export default React.memo(PresetsView)
