// In-transcript rendering of an `input` part: a card summarising the asked
// question(s); "Answered" once resolved. The answer surface itself is the
// composer's QuestionPanel.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MessagePart } from '../../zeron/protocol/types';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';

export const InputCard = React.memo(function ({
  part,
}: {
  part: Extract<MessagePart, { kind: 'input' }>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
      ]}
    >
      <View style={styles.head}>
        <Icon
          name="questionmark.circle"
          size={15}
          color={theme.indicatorAwaitingInput}
        />
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {part.questions[0]?.question ?? ''}
        </Text>
        {part.resolved ? (
          <Text style={[styles.answered, { color: theme.indicatorCompleted }]}>
            {t('session.answered')}
          </Text>
        ) : null}
      </View>
      {part.questions.length > 1 ? (
        <Text style={[styles.more, { color: theme.textSecondary }]}>
          {`+${part.questions.length - 1}`}
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
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '500' },
  answered: { fontSize: 12, fontWeight: '600' },
  more: { fontSize: 12, marginTop: 4 },
});
