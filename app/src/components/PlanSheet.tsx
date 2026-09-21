import React, { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Icon } from './Icon';
import { Glass } from './Glass';
import { useTheme } from '../theme';
import { markdownStyleFor } from '../markdownStyle';
import { t } from '../i18n/strings';

export function PlanSheet({
  name,
  markdown,
  onDismiss,
  onImplement,
}: {
  name: string;
  markdown: string;
  onDismiss: () => void;
  onImplement: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sheet = useRef<TrueSheet>(null);
  const implementing = useRef(false);
  const mdStyle = markdownStyleFor(theme);

  const implement = () => {
    if (implementing.current) return;
    implementing.current = true;
    onImplement();
    if (sheet.current) {
      void sheet.current.dismiss();
    } else {
      onDismiss();
    }
  };

  return (
    <TrueSheet
      ref={sheet}
      detents={[1]}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      grabber
      backgroundColor={theme.background}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => sheet.current?.dismiss()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('session.back')}
        >
          <View style={[styles.closeButton, { borderColor: theme.border }]}>
            <Icon name="xmark" size={15} color={theme.text} />
          </View>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {name}
        </Text>
        <View style={styles.closeButton} />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
        showsVerticalScrollIndicator={false}
      >
        <EnrichedMarkdownText
          markdown={markdown}
          markdownStyle={mdStyle}
          flavor="github"
        />
      </ScrollView>
      <View
        style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={implement}
          accessibilityRole="button"
          accessibilityLabel={t('session.implementPlan')}
        >
          <Glass interactive tintColor={theme.planButton} style={styles.cta}>
            <Text style={styles.ctaLabel}>{t('session.implementPlan')}</Text>
          </Glass>
        </Pressable>
      </View>
    </TrueSheet>
  );
}

const CLOSE = 32;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 12,
  },
  closeButton: {
    width: CLOSE,
    height: CLOSE,
    borderRadius: CLOSE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: 20, flex: 1 },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
  },
  cta: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    color: '#1C1204',
    fontSize: 17,
    fontWeight: '700',
  },
});
