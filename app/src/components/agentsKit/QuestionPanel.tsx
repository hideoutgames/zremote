// Ported from Agents Kit (permissive collections only):
//   components/beautiful-ui/... approval-card — MIT © Shane Levine
//   components/prompt-kit/question.tsx      — MIT (prompt-kit)
// The composer's answer surface when the host's agent asks: paged questions,
// option buttons (multiSelect toggles), Submit → the chosen labels per
// question. Optional free-text sits under the options. The draft underneath
// is preserved (this panel replaces the input area only while open).

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type {
  UserInputAnswer,
  UserInputQuestion,
} from '../../zeron/protocol/types';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';

export interface QuestionPanelProps {
  requestId: string;
  questions: UserInputQuestion[];
  onSubmit: (requestId: string, answers: UserInputAnswer[]) => void;
  /** Hide the panel without answering — the question id is suppressed until
   * a different one appears (the host request may stay unresolved). */
  onDismiss: () => void;
}

const labelsFor = (
  q: UserInputQuestion,
  selected: string[] | undefined,
  custom: string | undefined,
): string[] => {
  const options = selected ?? [];
  const extra = custom?.trim();
  return extra !== undefined && extra !== '' ? [...options, extra] : options;
};

export const QuestionPanel = React.memo(function ({
  requestId,
  questions,
  onSubmit,
  onDismiss,
}: QuestionPanelProps) {
  const theme = useTheme();
  // questionId → selected labels (multiSelect toggles, single-select replaces)
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  const toggle = useMemo(
    () => (q: UserInputQuestion, option: string) =>
      setAnswers(prev => {
        const cur = prev[q.id] ?? [];
        const next = q.multiSelect
          ? cur.includes(option)
            ? cur.filter(o => o !== option)
            : [...cur, option]
          : [option];
        return { ...prev, [q.id]: next };
      }),
    [],
  );

  const complete = questions.every(
    q => labelsFor(q, answers[q.id], custom[q.id]).length > 0,
  );
  const submitFg = complete
    ? theme.scheme === 'dark'
      ? '#000000'
      : '#FFFFFF'
    : '#FFFFFF';

  const submit = () => {
    if (!complete) return;
    onSubmit(
      requestId,
      questions.map(q => ({
        questionId: q.id,
        labels: labelsFor(q, answers[q.id], custom[q.id]),
      })),
    );
  };

  return (
    <View style={styles.panel}>
      {questions.map(q => (
        <View key={q.id} style={styles.question}>
          <Text style={[styles.header, { color: theme.textSecondary }]}>
            {q.header}
          </Text>
          <Text style={[styles.prompt, { color: theme.text }]}>
            {q.question}
          </Text>
          <View style={styles.options}>
            {q.options.map(option => {
              const selected = answers[q.id]?.includes(option) === true;
              return (
                <Pressable
                  key={option}
                  onPress={() => toggle(q, option)}
                  accessibilityRole="button"
                  accessibilityLabel={option}
                  accessibilityState={{ selected }}
                  style={[
                    styles.option,
                    { borderColor: selected ? theme.text : theme.border },
                    selected && { backgroundColor: theme.text + '14' },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: selected ? theme.text : theme.text },
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={custom[q.id] ?? ''}
            onChangeText={text =>
              setCustom(prev => ({ ...prev, [q.id]: text }))
            }
            placeholder={t('session.question.custom')}
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.custom,
              {
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
            accessibilityLabel={t('session.question.custom')}
            autoCapitalize="sentences"
            autoCorrect
          />
        </View>
      ))}
      <View style={styles.footer}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t('session.question.dismiss')}
          style={[styles.dismiss, { borderColor: theme.border }]}
        >
          <Text style={[styles.dismissText, { color: theme.textSecondary }]}>
            {t('session.question.dismiss')}
          </Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={!complete}
          accessibilityRole="button"
          accessibilityLabel={t('session.submit')}
          accessibilityState={{ disabled: !complete }}
          style={[
            styles.submit,
            { backgroundColor: complete ? theme.sendActive : theme.border },
          ]}
        >
          <Icon name="arrow.up" size={14} color={submitFg} />
          <Text style={[styles.submitText, { color: submitFg }]}>
            {t('session.submit')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 14,
  },
  question: { gap: 8 },
  header: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  prompt: { fontSize: 15, lineHeight: 20 },
  options: { gap: 6 },
  option: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  optionText: { fontSize: 14 },
  custom: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
  footer: { flexDirection: 'row', gap: 8 },
  dismiss: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: { fontSize: 15, fontWeight: '600' },
  submit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 10,
  },
  submitText: { fontSize: 15, fontWeight: '600' },
});
