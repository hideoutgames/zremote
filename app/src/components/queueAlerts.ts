import { Alert } from 'react-native';
import { t } from '../i18n/strings';

export const alertHostNotConnectedQueue = (): void => {
  Alert.alert(t('queue.hostNotConnected'), t('queue.addedLocally'), [
    { text: t('queue.continue') },
  ]);
};

export const alertLocalQueuedInfo = (): void => {
  Alert.alert(t('queue.storedLocally'), undefined, [
    { text: t('queue.understood') },
  ]);
};
