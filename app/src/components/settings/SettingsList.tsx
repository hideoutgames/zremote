// Inset-grouped settings list (iOS Settings / HIG). Page and cell colors
// stay local so Home / session chrome keep their existing tokens.

import React, {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme, type Theme } from '../../theme';
import { Icon } from '../Icon';

export const settingsPageBackground = (theme: Theme): string =>
  theme.scheme === 'light' ? '#F2F2F7' : '#000000';

export const settingsCellBackground = (theme: Theme): string =>
  theme.scheme === 'light' ? '#FFFFFF' : '#1C1C1E';

const separatorColor = (theme: Theme): string =>
  theme.scheme === 'light' ? '#C6C6C8' : '#38383A';

const LEADING_INSET = 16;
const ICON_SIZE = 29;
const ICON_GAP = 12;

export function SettingsGroup({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {header !== undefined ? (
        <Text style={[styles.caption, { color: theme.textSecondary }]}>
          {header}
        </Text>
      ) : null}
      <View
        style={[
          styles.groupBody,
          { backgroundColor: settingsCellBackground(theme) },
        ]}
      >
        {items.map((child, i) => {
          if (
            !isValidElement(child) ||
            (child.type !== SettingsRow && child.type !== SettingsInputRow)
          ) {
            return child;
          }
          return cloneElement(child as ReactElement<{ last?: boolean }>, {
            last: i === items.length - 1,
          });
        })}
      </View>
      {footer !== undefined ? (
        <Text style={[styles.captionFooter, { color: theme.textSecondary }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function SettingsRow({
  title,
  subtitle,
  value,
  leading,
  trailing,
  onPress,
  destructive,
  showChevron,
  last,
  accessibilityLabel,
  testID,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  showChevron?: boolean;
  last?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const theme = useTheme();
  const label = accessibilityLabel ?? title;
  const separatorLeft =
    leading !== undefined
      ? LEADING_INSET + ICON_SIZE + ICON_GAP
      : LEADING_INSET;
  const rowStyle: StyleProp<ViewStyle> = [
    styles.row,
    subtitle !== undefined ? styles.rowWithSubtitle : null,
  ];
  const inner = (
    <>
      {leading !== undefined ? (
        <View style={styles.leading}>{leading}</View>
      ) : null}
      <View style={styles.textCol}>
        <Text
          style={[
            styles.title,
            { color: destructive === true ? theme.danger : theme.text },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text
            style={[styles.subtitle, { color: theme.textSecondary }]}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? (
        <Text
          style={[styles.value, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {trailing}
      {showChevron === true ? (
        <Icon name="chevron.right" size={14} color={theme.textSecondary} />
      ) : null}
      {last === true ? null : (
        <View
          pointerEvents="none"
          style={[
            styles.separator,
            {
              backgroundColor: separatorColor(theme),
              left: separatorLeft,
            },
          ]}
        />
      )}
    </>
  );

  if (onPress !== undefined) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
        style={rowStyle}
      >
        {inner}
      </Pressable>
    );
  }

  return (
    <View accessibilityLabel={label} testID={testID} style={rowStyle}>
      {inner}
    </View>
  );
}

export function SettingsInputRow({
  label,
  value,
  onChangeText,
  placeholder,
  last,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  last?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.title, { color: theme.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: theme.text }]}
        accessibilityLabel={accessibilityLabel ?? label}
      />
      {last === true ? null : (
        <View
          pointerEvents="none"
          style={[
            styles.separator,
            {
              backgroundColor: separatorColor(theme),
              left: LEADING_INSET,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  caption: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  captionFooter: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  groupBody: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: LEADING_INSET,
    paddingVertical: 11,
    gap: 8,
  },
  rowWithSubtitle: {
    minHeight: 56,
  },
  leading: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, gap: 1 },
  title: { fontSize: 17 },
  subtitle: { fontSize: 15 },
  value: { fontSize: 17, flexShrink: 1, maxWidth: '50%' },
  input: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 0,
    textAlign: 'right',
  },
  separator: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
});
