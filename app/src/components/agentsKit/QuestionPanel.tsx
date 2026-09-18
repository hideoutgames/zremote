// Ported from Agents Kit (permissive collections only):
//   components/beautiful-ui/... approval-card — MIT © Shane Levine
//   components/prompt-kit/question.tsx      — MIT (prompt-kit)
// The composer's answer surface when the host's agent asks: paged questions,
// option buttons (multiSelect toggles), Submit → the chosen labels per
// question. The draft underneath is preserved (this panel replaces the input
// area only while open).

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
}

export const QuestionPanel = React.memo(function ({
  requestId,
  questions,
  onSubmit,
}: QuestionPanelProps) {
  const theme = useTheme();
  // questionId → selected labels (multiSelect toggles, single-select replaces)
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

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

  const complete = questions.every(q => (answers[q.id]?.length ?? 0) > 0);

  const submit = () => {
    if (!complete) return;
    onSubmit(
      requestId,
      questions.map(q => ({ questionId: q.id, labels: answers[q.id] })),
    );
  };

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
      ]}
    >
      {questions.map(q => (
        <View key={q.id} style={styles.question}>
          {q.header !== undefined && q.header !== '' ? (
            <Text style={[styles.header, { color: theme.textSecondary }]}>
              {q.header}
            </Text>
          ) : null}
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
                    {
                      borderColor: selected ? theme.accent : theme.border,
                      backgroundColor: selected
                        ? theme.accent + '22'
                        : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: selected ? theme.accent : theme.text },
                    ]}
                  >
                    {option}
                  </Text>
                  {selected ? (
                    <Icon name="checkmark" size={14} color={theme.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <Pressable
        onPress={submit}
        disabled={!complete}
        accessibilityRole="button"
        accessibilityLabel={t('session.submit')}
        accessibilityState={{ disabled: !complete }}
        style={[
          styles.submit,
          { backgroundColor: complete ? theme.accent : theme.border },
        ]}
      >
        <Text style={styles.submitText}>{t('session.submit')}</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 14,
    marginHorizontal: 8,
    marginTop: 8,
  },
  question: { gap: 8 },
  header: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  prompt: { fontSize: 15, lineHeight: 20 },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  optionText: { fontSize: 15, flex: 1, paddingRight: 8 },
  submit: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
  },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
