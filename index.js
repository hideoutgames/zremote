/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { prewarmOnAppStart } from 'react-native-nitro-websockets';
import App from './App';
import { name as appName } from './app.json';
import { OPENAI_API_KEY, OPENAI_WS_URL } from './src/config';


prewarmOnAppStart(OPENAI_WS_URL, undefined, {
  Authorization: `Bearer ${OPENAI_API_KEY}`,
});

AppRegistry.registerComponent(appName, () => App);
