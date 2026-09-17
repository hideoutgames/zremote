// App config surface: reads `extra` from expo-constants (populated from
// app.config.ts). Thin adapter — no defaults beyond the config itself.

import Constants from 'expo-constants';

export interface ZeronAppConfig {
  edgeUrl: string;
  workosClientId: string;
  workosApiBase: string;
}

export const appConfig = (): ZeronAppConfig => {
  const extra = Constants.expoConfig?.extra as
    | Partial<ZeronAppConfig>
    | undefined;
  return {
    edgeUrl: extra?.edgeUrl ?? 'https://edge.zeron.sh',
    workosClientId: extra?.workosClientId ?? '',
    workosApiBase: extra?.workosApiBase ?? 'https://api.workos.com',
  };
};
