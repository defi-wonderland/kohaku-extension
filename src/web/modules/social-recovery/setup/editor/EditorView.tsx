/**
 * The setup editor over the draft record. Every edit runs one of the pure
 * operations, writes the draft and the path together, and keeps the path equal
 * to the draft's clauses. A credential the path already holds is refused
 * before the record changes. Continue runs the SDK's path check on the draft
 * and opens the waiting period only when the check finds no error.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import type { Clause, Credential, Finding } from '@web/modules/social-recovery/sdk-interfaces'
import {
  getRuleLines,
  renderRuleLines,
  RULE_LINE_KEYS
} from '@web/modules/social-recovery/shared/rule-lines'

import { renderFinding } from './copy'
import CredentialRow from './CredentialRow'
import MemberPicker from './MemberPicker'
import {
  addGroup,
  blocksContinue,
  EMPTY_DRAFT,
  emptySlotOf,
  enrollSearchOf,
  kindOf,
  makeItAGroup,
  makeRequired,
  methodCountOf,
  METHOD_KINDS,
  moveToGroup,
  pickerEntriesOf,
  placeAt,
  removeClause,
  removeMember,
  roleOf,
  setThreshold,
  withClauses
} from './operations'
import ThresholdField from './ThresholdField'
import type { EditorLoad, EditorViewProps, EditResult, MethodKind, PickerTarget } from './types'

const EditorView = ({ records, client, addressBook, navigate }: EditorViewProps) => {
  const { t } = useTranslation()
  const [load, setLoad] = useState<EditorLoad | null>(null)
  const [refused, setRefused] = useState(false)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [movingRow, setMovingRow] = useState<number | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [checking, setChecking] = useState(false)
  const mounted = useRef(true)
  const loadRef = useRef<EditorLoad | null>(null)
  const writes = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    mounted.current = true
    Promise.all([records.setupDraft.read(), records.enrollments.read()])
      .then(([draft, enrollments]) => {
        const next: EditorLoad = {
          draft: draft.status === 'present' ? draft.value : EMPTY_DRAFT,
          enrollments: enrollments.status === 'present' ? enrollments.value : [],
          mode: draft.status === 'present' && draft.value.clauses.length > 0 ? 'adjust' : 'build'
        }
        loadRef.current = next
        if (mounted.current) setLoad(next)
      })
      .catch(() => undefined)
    return () => {
      mounted.current = false
    }
  }, [records])

  const clauses = useMemo(() => load?.draft.clauses ?? [], [load])

  const commit = useCallback(
    (next: Clause[]) => {
      const current = loadRef.current
      if (!current) return
      const draft = withClauses(current.draft, next)
      const updated = { ...current, draft }
      loadRef.current = updated
      setLoad(updated)
      setRefused(false)
      setFindings([])
      setMovingRow(null)
      writes.current = writes.current
        .then(() => Promise.all([records.setupDraft.write(draft), records.path.write(next)]))
        .then(
          () => undefined,
          () => undefined
        )
    },
    [records]
  )

  const apply = useCallback(
    (result: EditResult) => {
      if (result.status === 'refused') {
        setRefused(true)
        return null
      }
      commit(result.clauses)
      return result.at
    },
    [commit]
  )

  const current = () => loadRef.current?.draft.clauses ?? []

  const onPick = (credential: Credential) => {
    if (!picker) return
    if (apply(placeAt(current(), picker, credential))) setPicker(null)
  }

  const onEnrollNew = (kind: MethodKind) => {
    if (!picker) return
    const at =
      picker.place === 'slot'
        ? { clause: picker.clause, member: picker.member }
        : apply(placeAt(current(), picker, emptySlotOf(kind)))
    if (!at) return
    setPicker(null)
    // The enroll screen reads the slot from the stored draft, so it opens once the write lands.
    writes.current
      .then(() => {
        if (mounted.current) {
          navigate(`${WEB_ROUTES.socialRecoverySetupEnroll}${enrollSearchOf(kind, at)}`)
        }
      })
      .catch(() => undefined)
  }

  const onMove = (row: number, group: number) => apply(moveToGroup(current(), row, group))

  const onContinue = async () => {
    if (client.status !== 'ready' || !loadRef.current) return
    setChecking(true)
    setFindings([])
    try {
      await writes.current
      const draft = loadRef.current.draft
      const result = await client.setup.validateSetup(draft)
      if (!mounted.current) return
      if (blocksContinue(result)) {
        setFindings(result.errors)
        setChecking(false)
        return
      }
      navigate(WEB_ROUTES.socialRecoverySetupWaitingPeriod)
    } catch {
      if (mounted.current) setChecking(false)
    }
  }

  const ruleLines = useMemo(() => getRuleLines(clauses), [clauses])
  const entries = useMemo(
    () => pickerEntriesOf(load?.enrollments ?? [], clauses, addressBook),
    [load, clauses, addressBook]
  )

  if (!load) return <ActivityIndicator testID="editor-spinner" />

  const indexed = clauses.map((clause, index) => ({ clause, index }))
  const rows = indexed.filter(({ clause }) => roleOf(clause) === 'required')
  const groups = indexed.filter(({ clause }) => roleOf(clause) === 'group')
  const methodCount = methodCountOf(clauses)
  const heading = load.mode === 'adjust' ? 'adjust' : 'build'

  const pickerKinds = (target: PickerTarget): readonly MethodKind[] =>
    target.place === 'slot' && target.kind ? [target.kind] : METHOD_KINDS

  const openSlot = (clause: number, member: number) => {
    const credential = clauses[clause].credentials[member]
    setPicker({ place: 'slot', clause, member, kind: kindOf(credential, addressBook) })
  }

  return (
    <View testID="editor">
      <Text fontSize={20} weight="semiBold" style={spacings.mbTy} testID="editor-title">
        {t(`socialRecovery.editor.${heading}.title`)}
      </Text>
      <Text fontSize={14} appearance="secondaryText" style={spacings.mbLg}>
        {t(`socialRecovery.editor.${heading}.lead`)}
      </Text>

      {refused && (
        <Text fontSize={14} appearance="errorText" style={spacings.mbMd} testID="editor-refusal">
          {t('socialRecovery.editor.duplicate')}
        </Text>
      )}

      <View style={spacings.mbLg} testID="editor-required">
        <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
          {t('socialRecovery.editor.requiredHeader')}
        </Text>
        {rows.length === 0 && (
          <Text fontSize={14} appearance="secondaryText" style={spacings.mbSm}>
            {t('socialRecovery.editor.nothingRequired')}
          </Text>
        )}
        {rows.map(({ clause, index }) => (
          <View key={index} style={spacings.mbSm} testID={`editor-row-${index}`}>
            <View style={[flexbox.directionRow, flexbox.alignCenter]}>
              <CredentialRow
                credential={clause.credentials[0]}
                addressBook={addressBook}
                enrollments={load.enrollments}
                onPress={() => openSlot(index, 0)}
                testID={`editor-slot-${index}-0`}
              />
              {groups.length > 0 && (
                <Button
                  testID={`editor-row-${index}-move`}
                  type="outline"
                  size="small"
                  text={t('socialRecovery.editor.moveToGroup')}
                  onPress={() =>
                    groups.length === 1 ? onMove(index, groups[0].index) : setMovingRow(index)
                  }
                  hasBottomSpacing={false}
                />
              )}
              <Button
                testID={`editor-row-${index}-remove`}
                type="outline"
                size="small"
                text={t('socialRecovery.actions.remove')}
                onPress={() => commit(removeClause(current(), index))}
                hasBottomSpacing={false}
              />
            </View>
            {movingRow === index && (
              <View style={[flexbox.directionRow, flexbox.wrap]}>
                {groups.map((group, ordinal) => (
                  <Button
                    key={group.index}
                    testID={`editor-row-${index}-move-${group.index}`}
                    type="outline"
                    size="small"
                    text={t('socialRecovery.shape.group', { n: ordinal + 1 })}
                    onPress={() => onMove(index, group.index)}
                    hasBottomSpacing={false}
                    style={spacings.mrTy}
                  />
                ))}
              </View>
            )}
          </View>
        ))}
        <Button
          testID="editor-add-required"
          type="outline"
          size="small"
          text={t('socialRecovery.editor.addRequired')}
          onPress={() => setPicker({ place: 'required' })}
          hasBottomSpacing={false}
        />
      </View>

      <View style={spacings.mbLg} testID="editor-groups">
        <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
          {groups.length > 1
            ? t('socialRecovery.editor.groupsHeader')
            : t('socialRecovery.editor.groupHeader')}
        </Text>
        {groups.length === 0 && (
          <Text fontSize={14} appearance="secondaryText" style={spacings.mbSm}>
            {t('socialRecovery.editor.noGroup')}
          </Text>
        )}
        {groups.map(({ clause, index }, ordinal) => (
          <View key={index} style={spacings.mbMd} testID={`editor-group-${index}`}>
            <Text fontSize={14} weight="semiBold" style={spacings.mbTy}>
              {t('socialRecovery.shape.group', { n: ordinal + 1 })}
            </Text>
            <ThresholdField
              testID={`editor-group-${index}-threshold`}
              threshold={clause.threshold}
              members={clause.credentials.length}
              onChange={(threshold) => commit(setThreshold(current(), index, threshold))}
            />
            {clause.credentials.map((credential, member) => (
              <View
                // A member's place in its group is its identity in the path.
                // eslint-disable-next-line react/no-array-index-key
                key={member}
                style={[flexbox.directionRow, flexbox.alignCenter, spacings.mtTy]}
              >
                <CredentialRow
                  credential={credential}
                  addressBook={addressBook}
                  enrollments={load.enrollments}
                  onPress={() => openSlot(index, member)}
                  testID={`editor-slot-${index}-${member}`}
                />
                <Button
                  testID={`editor-member-${index}-${member}-required`}
                  type="outline"
                  size="small"
                  text={t('socialRecovery.editor.makeRequired')}
                  onPress={() => apply(makeRequired(current(), index, member))}
                  hasBottomSpacing={false}
                />
                <Button
                  testID={`editor-member-${index}-${member}-remove`}
                  type="outline"
                  size="small"
                  text={t('socialRecovery.actions.remove')}
                  onPress={() => commit(removeMember(current(), index, member))}
                  hasBottomSpacing={false}
                />
              </View>
            ))}
            <View style={[flexbox.directionRow, spacings.mtSm]}>
              <Button
                testID={`editor-group-${index}-add`}
                type="outline"
                size="small"
                text={t('socialRecovery.editor.addMember')}
                onPress={() => setPicker({ place: 'member', clause: index })}
                hasBottomSpacing={false}
                style={spacings.mrTy}
              />
              <Button
                testID={`editor-group-${index}-remove`}
                type="outline"
                size="small"
                text={t('socialRecovery.editor.removeGroup')}
                onPress={() => commit(removeClause(current(), index))}
                hasBottomSpacing={false}
              />
            </View>
          </View>
        ))}
        <Button
          testID="editor-add-group"
          type="outline"
          size="small"
          text={t('socialRecovery.editor.addGroup')}
          onPress={() => commit(addGroup(current()))}
          hasBottomSpacing={false}
        />
      </View>

      {!!picker && (
        <MemberPicker
          entries={entries}
          kinds={pickerKinds(picker)}
          addressBook={addressBook}
          onPick={onPick}
          onEnrollNew={onEnrollNew}
          onClose={() => setPicker(null)}
        />
      )}

      {ruleLines.length > 0 && (
        <View style={spacings.mbLg} testID="editor-rule-lines">
          <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
            {t('socialRecovery.ruleLines.header')}
          </Text>
          {ruleLines.map((line) => {
            const [text] = renderRuleLines([line], t)
            return (
              <View key={line.key} style={spacings.mbSm}>
                <Text fontSize={14} testID="editor-rule-line">
                  {text}
                </Text>
                {line.key === RULE_LINE_KEYS.sizingRule && (
                  <Button
                    testID="editor-make-it-a-group"
                    type="outline"
                    size="small"
                    text={t('socialRecovery.ruleLines.makeItAGroup')}
                    onPress={() => commit(makeItAGroup(current()))}
                    hasBottomSpacing={false}
                  />
                )}
                {line.key === RULE_LINE_KEYS.secondMethodOffer && (
                  <Button
                    testID="editor-add-second-method"
                    type="outline"
                    size="small"
                    text={t('socialRecovery.ruleLines.addSecondMethod')}
                    onPress={() => setPicker({ place: 'required' })}
                    hasBottomSpacing={false}
                  />
                )}
              </View>
            )
          })}
        </View>
      )}

      {findings.length > 0 && (
        <View style={spacings.mbMd} testID="editor-findings">
          {findings.map((finding, index) => (
            <Text
              // Two findings can share a code and differ only in their values.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              fontSize={14}
              appearance="errorText"
              style={spacings.mbTy}
              testID="editor-finding"
            >
              {renderFinding(finding, t)}
            </Text>
          ))}
        </View>
      )}

      {methodCount === 0 && (
        <Text fontSize={12} appearance="secondaryText" style={spacings.mbSm}>
          {t('socialRecovery.editor.continueUnlock')}
        </Text>
      )}
      <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.justifySpaceBetween]}>
        <Button
          testID="editor-back"
          type="outline"
          text={t('socialRecovery.ceremony.backAction')}
          onPress={() => navigate(WEB_ROUTES.socialRecoverySetup)}
          hasBottomSpacing={false}
        />
        {client.status === 'loading' && <ActivityIndicator testID="editor-spinner" />}
        {client.status === 'refused' && (
          <Button
            testID="editor-client-retry"
            type="outline"
            text={t('socialRecovery.writes.tryAgain')}
            onPress={client.retry}
            hasBottomSpacing={false}
          />
        )}
        {client.status === 'ready' &&
          (checking ? (
            <ActivityIndicator testID="editor-spinner" />
          ) : (
            <Button
              testID="editor-continue"
              type="primary"
              text={t('socialRecovery.actions.continue')}
              disabled={methodCount === 0}
              onPress={onContinue}
              hasBottomSpacing={false}
            />
          ))}
      </View>
    </View>
  )
}

export default React.memo(EditorView)
