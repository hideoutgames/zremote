// Open or share a change-request URL. The phone has no merge/checks RPCs;
// opening a URL leaves the app via the link the host already sent.

import { Linking, Platform, Share } from 'react-native';

export const openPrUrl = (url: string): void => {
  if (url === '') return;
  Linking.openURL(url).catch(() => {});
};

/** One payload field only — iOS Share with both `message` and `url` set
 * offers the same link twice. */
export const sharePrUrl = (url: string): void => {
  if (url === '') return;
  if (Platform.OS === 'ios') {
    Share.share({ url }).catch(() => {});
    return;
  }
  Share.share({ message: url }).catch(() => {});
};
