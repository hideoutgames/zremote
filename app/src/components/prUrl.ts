// Open or share a change-request URL. The phone has no merge/checks RPCs;
// GitHub-only actions leave the app via the PR link the host already sent.

import { Linking, Share } from 'react-native';

export const openPrUrl = (url: string): void => {
  if (url === '') return;
  Linking.openURL(url).catch(() => {});
};

export const sharePrUrl = (url: string): void => {
  if (url === '') return;
  Share.share({ message: url, url }).catch(() => {});
};
