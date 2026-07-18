import React, {useImperativeHandle, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {TrueSheet} from '@lodev09/react-native-true-sheet';
import {EnrichedMarkdownText} from 'react-native-enriched-markdown';
import {Icon} from './Icon';
import {darkMarkdownStyle} from '../markdownStyle';
import {theme} from '../theme';

export type ReasoningSheetRef = {present: (reasoning: string) => void};


export const ReasoningSheet = React.memo(function ({
  ref,
}: {
  ref?: React.Ref<ReasoningSheetRef>;
}) {
  const insets = useSafeAreaInsets();
  const sheet = useRef<TrueSheet>(null);
  const [reasoning, setReasoning] = useState('');

  useImperativeHandle(ref, () => ({
    present: text => {
      setReasoning(text);
      sheet.current?.present();
    },
  }));

  return (
    <TrueSheet
      ref={sheet}
      detents={['auto', 1]}
      maxContentHeight={620}
      grabber={true}>
      <View style={styles.header}>
        <Pressable onPress={() => sheet.current?.dismiss()} hitSlop={8}>
          <View style={styles.closeButton}>
            <Icon name="xmark" size={15} color={theme.text} />
          </View>
        </Pressable>
        <Text style={styles.title}>Thought process</Text>
        {/* Spacer matching the close button so the title stays centered. */}
        <View style={styles.closeButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {paddingBottom: insets.bottom + 24},
        ]}
        showsVerticalScrollIndicator={false}>
        <EnrichedMarkdownText
          markdown={reasoning}
          markdownStyle={darkMarkdownStyle}
        />
      </ScrollView>
    </TrueSheet>
  );
});

const CLOSE = 32;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  closeButton: {
    width: CLOSE,
    height: CLOSE,
    borderRadius: CLOSE / 2,
    backgroundColor: theme.glassFallbackBackground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: theme.text,
  },
  scroll: {
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingTop: 4,
  },
});
