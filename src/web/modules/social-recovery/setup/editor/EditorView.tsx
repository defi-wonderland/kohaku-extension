/**
 * The setup editor over the draft record. Every edit runs one of the pure
 * operations, writes the draft and the path together, and keeps the path equal
 * to the draft's clauses. A credential the path already holds is refused
 * before the record changes. Continue first judges the draft against this
 * wallet's own rules and, with a refusal, stays and names it without running
 * the SDK's path check; otherwise it runs the check and opens the waiting
 * period only when the check finds no error. The rules panel lists every rule
 * the editor applies, always.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import type {
  Clause,
  Credential,
  Finding,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  getRuleLines,
  renderRuleLines,
  RULE_LINE_KEYS
} from '@web/modules/social-recovery/shared/rule-lines'

import { renderClientRefusal, renderFinding, renderRefusal, renderRulesPanel } from './copy'
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
  makeItAGroupRoles,
  makeRequired,
  methodCountOf,
  moveToGroup,
  pickerEntriesOf,
  placeAt,
  placedRoles,
  removeClause,
  removeMember,
  rolesOf,
  SECOND_METHOD_KINDS,
  setThreshold,
  withClauses,
  withoutRole
} from './operations'
import { refusalsOf } from './refusals'
import ThresholdField from './ThresholdField'
import { METHOD_KINDS } from './types'
import type {
  ClauseRole,
  ClientRefusal,
  EditorLoad,
  EditorViewProps,
  EditResult,
  MethodKind,
  PickerTarget,
  Refusal,
  SlotPosition
} from './types'

const EditorView = ({ records, client, addressBook, navigate }: EditorViewProps) => {
  const { t } = useTranslation()
  const [load, setLoad] = useState<EditorLoad | null>(null)
  const [refused, setRefused] = useState(false)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [movingRow, setMovingRow] = useState<number | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [walletRefusals, setWalletRefusals] = useState<Refusal[]>([])
  const [checking, setChecking] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)
  const checkingRef = useRef(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [writeFailed, setWriteFailed] = useState(false)
  const writeFailedRef = useRef(false)
  const mounted = useRef(true)
  const loadRef = useRef<EditorLoad | null>(null)
  const writes = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    mounted.current = true
    Promise.all([records.setupDraft.read(), records.enrollments.read()])
      .then(([draft, enrollments]) => {
        const stored = draft.status === 'present' ? draft.value : EMPTY_DRAFT
        const next: EditorLoad = {
          draft: stored,
          enrollments: enrollments.status === 'present' ? enrollments.value : [],
          mode: stored.clauses.length > 0 ? 'adjust' : 'build',
          roles: rolesOf(stored.clauses)
        }
        loadRef.current = next
        if (mounted.current) setLoad(next)
      })
      .catch(() => {
        if (mounted.current) setLoadFailed(true)
      })
    return () => {
      mounted.current = false
    }
  }, [records, loadAttempt])

  const retryLoad = () => {
    setLoadFailed(false)
    setLoadAttempt((attempt) => attempt + 1)
  }

  const clauses = useMemo(() => load?.draft.clauses ?? [], [load])

  // The draft goes first and the path after it, each write after the one
  // before; a failed write holds continue until a later write lands.
  const persist = useCallback(
    (draft: SetupDraft) => {
      writes.current = writes.current.then(async () => {
        try {
          await records.setupDraft.write(draft)
          await records.path.write(draft.clauses)
          writeFailedRef.current = false
        } catch {
          writeFailedRef.current = true
        }
        if (mounted.current) setWriteFailed(writeFailedRef.current)
      })
    },
    [records]
  )

  const retryWrite = () => {
    const current = loadRef.current
    if (!current || checkingRef.current) return
    persist(current.draft)
  }

  // A clause keeps the role the edit that made it gave it, so a group that
  // loses members down to one stays a group while the holder edits.
  const commit = useCallback(
    (next: Clause[], roles: ClauseRole[]) => {
      const current = loadRef.current
      if (!current || checkingRef.current) return
      const draft = withClauses(current.draft, next)
      const updated = { ...current, draft, roles }
      loadRef.current = updated
      setLoad(updated)
      setRefused(false)
      setFindings([])
      setWalletRefusals([])
      setCheckFailed(false)
      setMovingRow(null)
      persist(draft)
    },
    [persist]
  )

  const apply = useCallback(
    (result: EditResult, rolesAt: (at: SlotPosition) => ClauseRole[]) => {
      if (checkingRef.current) return null
      if (result.status === 'refused') {
        setRefused(true)
        return null
      }
      commit(result.clauses, rolesAt(result.at))
      return result.at
    },
    [commit]
  )

  const current = () => loadRef.current?.draft.clauses ?? []
  const currentRoles = () => loadRef.current?.roles ?? []

  const closePicker = () => {
    setPicker(null)
    setRefused(false)
  }

  const onPick = (credential: Credential) => {
    if (!picker) return
    const target = picker
    const placed = apply(placeAt(current(), target, credential), (at) =>
      placedRoles(currentRoles(), target, at)
    )
    if (placed) closePicker()
  }

  const onEnrollNew = (kind: MethodKind) => {
    if (!picker || checkingRef.current) return
    const at =
      picker.place === 'slot'
        ? { clause: picker.clause, member: picker.member }
        : apply(placeAt(current(), picker, emptySlotOf(kind)), (placed) =>
            placedRoles(currentRoles(), picker, placed)
          )
    if (!at) return
    closePicker()
    // The enroll screen reads the slot from the stored draft, so it opens once the write lands.
    writes.current
      .then(() => {
        if (mounted.current && !writeFailedRef.current) {
          navigate(`${WEB_ROUTES.socialRecoverySetupEnroll}${enrollSearchOf(kind, at)}`)
        }
      })
      .catch(() => undefined)
  }

  const onMove = (row: number, group: number) =>
    apply(moveToGroup(current(), row, group), () => withoutRole(currentRoles(), row))

  // Every edit holds while the check runs, so the check runs on the draft
  // the holder goes on with.
  const endCheck = () => {
    checkingRef.current = false
    if (mounted.current) setChecking(false)
  }

  const onContinue = async () => {
    if (client.status !== 'ready' || !loadRef.current || checkingRef.current) return
    const refusals = refusalsOf(loadRef.current.draft)
    setWalletRefusals(refusals)
    if (refusals.length > 0) {
      setFindings([])
      setCheckFailed(false)
      return
    }
    checkingRef.current = true
    setChecking(true)
    setCheckFailed(false)
    setFindings([])
    try {
      await writes.current
      if (writeFailedRef.current) {
        endCheck()
        return
      }
      const draft = loadRef.current.draft
      const result = await client.setup.validateSetup(draft)
      if (!mounted.current) return
      if (blocksContinue(result)) {
        setFindings(result.errors)
        endCheck()
        return
      }
      navigate(WEB_ROUTES.socialRecoverySetupWaitingPeriod)
    } catch {
      if (mounted.current) setCheckFailed(true)
      endCheck()
    }
  }

  const ruleLines = useMemo(() => getRuleLines(clauses), [clauses])
  const rulesPanel = useMemo(() => renderRulesPanel(t), [t])
  const entries = useMemo(
    () => pickerEntriesOf(load?.enrollments ?? [], clauses, addressBook),
    [load, clauses, addressBook]
  )

  if (!load) {
    if (!loadFailed) return <ActivityIndicator testID="editor-spinner" />
    return (
      <View testID="editor">
        <Text
          fontSize={14}
          appearance="errorText"
          style={spacings.mbMd}
          testID="editor-load-failed"
        >
          {t('socialRecovery.records.loadFailed')}
        </Text>
        <Button
          testID="editor-load-retry"
          type="outline"
          text={t('socialRecovery.writes.tryAgain')}
          onPress={retryLoad}
          hasBottomSpacing={false}
        />
      </View>
    )
  }

  const indexed = clauses.map((clause, index) => ({ clause, index }))
  const rows = indexed.filter(({ index }) => load.roles[index] === 'required')
  const groups = indexed.filter(({ index }) => load.roles[index] === 'group')
  const methodCount = methodCountOf(clauses)
  const heading = load.mode === 'adjust' ? 'adjust' : 'build'
  let clientRefusal: ClientRefusal | null = null
  if (client.status === 'update-the-wallet') clientRefusal = 'update-the-wallet'
  else if (client.status === 'failed' || (client.status === 'ready' && checkFailed)) {
    clientRefusal = 'unavailable'
  }
  const refusalLines = clientRefusal ? renderClientRefusal(clientRefusal, t) : null

  const pickerKinds = (target: PickerTarget): readonly MethodKind[] => {
    if (target.place === 'second') return SECOND_METHOD_KINDS
    return target.place === 'slot' && target.kind ? [target.kind] : METHOD_KINDS
  }

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
                disabled={checking}
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
                  disabled={checking}
                  hasBottomSpacing={false}
                />
              )}
              <Button
                testID={`editor-row-${index}-remove`}
                type="outline"
                size="small"
                text={t('socialRecovery.actions.remove')}
                onPress={() =>
                  commit(removeClause(current(), index), withoutRole(currentRoles(), index))
                }
                disabled={checking}
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
                    disabled={checking}
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
          disabled={checking}
          hasBottomSpacing={false}
        />
      </View>

      <View style={spacings.mbLg} testID="editor-groups">
        <Text fontSize={16} weight="semiBold" style={spacings.mbSm} testID="editor-groups-header">
          {t(
            groups.length === 1
              ? 'socialRecovery.editor.groupHeader'
              : 'socialRecovery.editor.groupsHeader'
          )}
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
              disabled={checking}
              onChange={(threshold) =>
                commit(setThreshold(current(), index, threshold), currentRoles())
              }
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
                  disabled={checking}
                  testID={`editor-slot-${index}-${member}`}
                />
                <Button
                  testID={`editor-member-${index}-${member}-required`}
                  type="outline"
                  size="small"
                  text={t('socialRecovery.editor.makeRequired')}
                  onPress={() =>
                    apply(makeRequired(current(), index, member), () => [
                      ...currentRoles(),
                      'required'
                    ])
                  }
                  disabled={checking}
                  hasBottomSpacing={false}
                />
                <Button
                  testID={`editor-member-${index}-${member}-remove`}
                  type="outline"
                  size="small"
                  text={t('socialRecovery.actions.remove')}
                  onPress={() => commit(removeMember(current(), index, member), currentRoles())}
                  disabled={checking}
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
                disabled={checking}
                hasBottomSpacing={false}
                style={spacings.mrTy}
              />
              <Button
                testID={`editor-group-${index}-remove`}
                type="outline"
                size="small"
                text={t('socialRecovery.editor.removeGroup')}
                onPress={() =>
                  commit(removeClause(current(), index), withoutRole(currentRoles(), index))
                }
                disabled={checking}
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
          onPress={() => commit(addGroup(current()), [...currentRoles(), 'group'])}
          disabled={checking}
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
          onClose={closePicker}
          disabled={checking}
        />
      )}

      {ruleLines.length > 0 && (
        <View style={spacings.mbLg} testID="editor-rule-lines">
          <Text fontSize={16} weight="semiBold" style={spacings.mbSm}>
            {t('socialRecovery.shape.header')}
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
                    text={t('socialRecovery.editor.makeItAGroup')}
                    // The sizing line counts required rows by their stored shape, so
                    // the press gathers every clause that shape reads as a row.
                    onPress={() =>
                      commit(makeItAGroup(current()), makeItAGroupRoles(rolesOf(current())))
                    }
                    disabled={checking}
                    hasBottomSpacing={false}
                  />
                )}
                {line.key === RULE_LINE_KEYS.secondMethodOffer && (
                  <Button
                    testID="editor-add-second-method"
                    type="outline"
                    size="small"
                    text={t('socialRecovery.editor.addSecondMethod')}
                    onPress={() => setPicker({ place: 'second' })}
                    disabled={checking}
                    hasBottomSpacing={false}
                  />
                )}
              </View>
            )
          })}
        </View>
      )}

      <View style={spacings.mbLg} testID="editor-rules">
        <Text fontSize={16} weight="semiBold" style={spacings.mbSm} testID="editor-rules-header">
          {rulesPanel.header}
        </Text>
        {rulesPanel.lines.map((line) => (
          <Text
            key={line}
            fontSize={14}
            appearance="secondaryText"
            style={spacings.mbTy}
            testID="editor-rules-line"
          >
            {line}
          </Text>
        ))}
      </View>

      {writeFailed && (
        <View style={spacings.mbMd}>
          <Text
            fontSize={14}
            appearance="errorText"
            style={spacings.mbTy}
            testID="editor-write-failed"
          >
            {t('socialRecovery.records.writeFailed')}
          </Text>
          <Button
            testID="editor-write-retry"
            type="outline"
            size="small"
            text={t('socialRecovery.writes.tryAgain')}
            onPress={retryWrite}
            disabled={checking}
            hasBottomSpacing={false}
          />
        </View>
      )}

      {walletRefusals.length > 0 && (
        <View style={spacings.mbMd} testID="editor-wallet-refusals">
          {walletRefusals.map((refusal, index) => (
            <Text
              // Two clauses can be refused with one sentence.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              fontSize={14}
              appearance="errorText"
              style={spacings.mbTy}
              testID="editor-wallet-refusal"
            >
              {renderRefusal(refusal, t)}
            </Text>
          ))}
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

      {!!refusalLines && (
        <View style={spacings.mbMd} testID="editor-client-refusal">
          <Text fontSize={14} weight="semiBold" appearance="errorText" style={spacings.mbTy}>
            {refusalLines.title}
          </Text>
          <Text fontSize={14} appearance="secondaryText">
            {refusalLines.body}
          </Text>
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
        {(client.status === 'update-the-wallet' || client.status === 'failed') && (
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
          ) : checkFailed ? (
            <Button
              testID="editor-check-retry"
              type="outline"
              text={t('socialRecovery.writes.tryAgain')}
              onPress={onContinue}
              hasBottomSpacing={false}
            />
          ) : (
            <Button
              testID="editor-continue"
              type="primary"
              text={t('socialRecovery.actions.continue')}
              disabled={methodCount === 0 || writeFailed}
              onPress={onContinue}
              hasBottomSpacing={false}
            />
          ))}
      </View>
    </View>
  )
}

export default React.memo(EditorView)
