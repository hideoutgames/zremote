// In-transcript rendering of an `input` part: the asked question(s) and,
// once resolved, the labels the user submitted. Answers come from the
// session command ledger (`respondInput`), not the CRDT part.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MessagePart, UserInputAnswer } from '../../zeron/protocol/types';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';

const labelsFor = (
  questionId: string,
  answers: readonly UserInputAnswer[],
): string[] => answers.find(a => a.questionId === questionId)?.labels ?? [];

export const InputCard = React.memo(function ({
  part,
  answers = [],
  embedded = false,
}: {
  part: Extract<MessagePart, { kind: 'input' }>;
  answers?: readonly UserInputAnswer[];
  embedded?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        embedded ? styles.embedded : undefined,
        embedded
          ? undefined
          : {
              backgroundColor: theme.cardBackground,
              borderColor: theme.border,
            },
      ]}
    >
      {part.questions.map(question => {
        const chosen = labelsFor(question.id, answers);
        return (
          <View key={question.id} style={styles.block}>
            <View style={styles.head}>
              <Icon
                name="questionmark.circle"
                size={15}
                color={theme.indicatorAwaitingInput}
              />
              <Text style={[styles.title, { color: theme.text }]}>
                {question.question}
              </Text>
            </View>
            {chosen.length > 0 ? (
              <Text style={[styles.answer, { color: theme.textSecondary }]}>
                {chosen.join(', ')}
              </Text>
            ) : null}
          </View>
        );
      })}
      {part.resolved ? (
        <Text style={[styles.answered, { color: theme.indicatorCompleted }]}>
          {t('session.answered')}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 3,
    gap: 8,
  },
  embedded: {
    borderWidth: 0,
    paddingHorizontal: 0,
    marginVertical: 0,
    backgroundColor: 'transparent',
  },
  block: { gap: 4 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, flexShrink: 1, fontSize: 14, fontWeight: '500' },
  answer: { fontSize: 14, marginLeft: 23 },
  answered: { fontSize: 12, fontWeight: '600' },
});
