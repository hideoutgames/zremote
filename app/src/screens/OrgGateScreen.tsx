// needsOrganization: pick an existing org or create one (name 1–80 chars).

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthSession } from '../app/runtimeContext';
import { Glass } from '../components/Glass';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';

const log = createLog();

interface Org {
  id: string;
  name: string;
}

export function OrgGateScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuthSession();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    auth
      .listOrgs()
      .then(list => {
        if (live) setOrgs(list as Org[]);
      })
      .catch(e => {
        log.warn(`listOrgs failed: ${e}`);
        if (live) setOrgs([]);
      });
    return () => {
      live = false;
    };
  }, [auth]);

  const select = useCallback(
    async (orgId: string) => {
      setBusy(true);
      setError(null);
      try {
        await auth.selectOrg(orgId);
      } catch (e) {
        log.warn(`selectOrg failed: ${e}`);
        setError(t('signIn.error.generic'));
      } finally {
        setBusy(false);
      }
    },
    [auth],
  );

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) return;
    setBusy(true);
    setError(null);
    try {
      const id = await auth.createOrg(trimmed);
      await auth.selectOrg(id);
    } catch (e) {
      log.warn(`createOrg failed: ${e}`);
      setError(t('signIn.error.generic'));
    } finally {
      setBusy(false);
    }
  }, [auth, name]);

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top + 24,
        },
      ]}
    >
      <Text style={[styles.title, { color: theme.text }]}>
        {t('orgGate.title')}
      </Text>
      {orgs === null ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : orgs.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textSecondary }]}>
          {t('orgGate.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {orgs.map(org => (
            <Pressable
              key={org.id}
              onPress={() => select(org.id)}
              disabled={busy}
            >
              <View
                style={[styles.row, { backgroundColor: theme.cardBackground }]}
              >
                <Text style={[styles.rowText, { color: theme.text }]}>
                  {org.name}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable onPress={() => setCreating(c => !c)} hitSlop={8}>
        <Text style={[styles.createToggle, { color: theme.accent }]}>
          {t('orgGate.create')}
        </Text>
      </Pressable>
      {creating ? (
        <View style={styles.createBox}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('orgGate.createPlaceholder')}
            placeholderTextColor={theme.textSecondary}
            maxLength={80}
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.inputBackground,
                borderColor: theme.border,
              },
            ]}
          />
          <Pressable
            onPress={create}
            disabled={busy || name.trim().length === 0}
            hitSlop={8}
          >
            <Glass interactive style={styles.primary}>
              <Text style={[styles.primaryText, { color: theme.sendActive }]}>
                {t('orgGate.create')}
              </Text>
            </Glass>
          </Pressable>
        </View>
      ) : null}
      {error !== null ? (
        <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 24,
    gap: 16,
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '700' },
  empty: { fontSize: 15 },
  list: { gap: 8 },
  row: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    overflow: 'hidden',
  },
  rowText: { fontSize: 16, fontWeight: '500' },
  createToggle: { fontSize: 15, fontWeight: '500' },
  createBox: { gap: 10 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  primary: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    overflow: 'hidden',
  },
  primaryText: { fontSize: 15, fontWeight: '600' },
  error: { fontSize: 13 },
});
