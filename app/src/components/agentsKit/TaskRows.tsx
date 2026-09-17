// Ported from Agents Kit components/beautiful-ui/task-rows.tsx
// (MIT © Shane Levine): a checklist of `{text, done}` items — checkmark + row
// text, done items dimmed and struck through.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';

export interface TaskItem {
  text: string;
  done: boolean;
}

export const TaskRows = React.memo(function ({ items }: { items: TaskItem[] }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.list,
        { backgroundColor: theme.cardBackground, borderColor: theme.border },
      ]}
    >
      {items.map((item, i) => (
        <View key={i} style={styles.row}>
          <Icon
            name={item.done ? 'checkmark.circle' : 'circle.fill'}
            size={15}
            color={item.done ? theme.indicatorCompleted : theme.textSecondary}
          />
          <Text
            style={[
              styles.text,
              { color: item.done ? theme.textSecondary : theme.text },
              item.done ? styles.done : undefined,
            ]}
          >
            {item.text}
          </Text>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  list: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    marginVertical: 3,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  text: { flex: 1, fontSize: 14, lineHeight: 19 },
  done: { textDecorationLine: 'line-through' },
});
