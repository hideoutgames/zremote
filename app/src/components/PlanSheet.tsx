// TrueSheet needs a real detent height — `minHeight: '100%'` on the fill
// wrapper (same pattern as GlassSheet / SessionSheet) so the plan ScrollView
// does not collapse to 0 on iPhone.

import React, { useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Icon } from './Icon';
import { Glass } from './Glass';
import { SESSION_SHEET_GRABBER_INSET } from './SessionSheet';
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
  const { height: windowHeight } = useWindowDimensions();
  const sheet = useRef<TrueSheet>(null);
  const mdStyle = markdownStyleFor(theme);
  const cap = Math.max(240, Math.round(windowHeight - insets.top));

  return (
    <TrueSheet
      ref={sheet}
      detents={[1]}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      grabber
      maxContentHeight={cap}
      backgroundColor={theme.background}
    >
      <View testID="plan-sheet" style={styles.fill}>
        <View
          testID="plan-sheet-header"
          style={[styles.header, { paddingTop: SESSION_SHEET_GRABBER_INSET }]}
        >
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
          testID="plan-sheet-scroll"
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
          showsVerticalScrollIndicator={false}
        >
          {markdown.trim() !== '' ? (
            <EnrichedMarkdownText
              markdown={markdown}
              markdownStyle={mdStyle}
              flavor="github"
            />
          ) : null}
        </ScrollView>
        <View
          style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={onImplement}
            accessibilityRole="button"
            accessibilityLabel={t('session.implementPlan')}
          >
            <Glass interactive tintColor={theme.planButton} style={styles.cta}>
              <Text style={styles.ctaLabel}>{t('session.implementPlan')}</Text>
            </Glass>
          </Pressable>
        </View>
      </View>
    </TrueSheet>
  );
}

const CLOSE = 32;

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: '100%' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
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
  scroll: { paddingHorizontal: 20, flex: 1, minHeight: 0 },
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
