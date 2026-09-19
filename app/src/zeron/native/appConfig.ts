// App config surface: reads `extra` from expo-constants (populated from
// app.config.ts). Thin adapter — no defaults beyond the config itself.

import Constants from 'expo-constants';

export interface ZeronAppConfig {
  edgeUrl: string;
  workosClientId: string;
  workosApiBase: string;
  gitSha: string;
}

export const appConfig = (): ZeronAppConfig => {
  const extra = Constants.expoConfig?.extra as
    | Partial<ZeronAppConfig>
    | undefined;
  return {
    edgeUrl: extra?.edgeUrl ?? 'https://edge.zeron.sh',
    workosClientId: extra?.workosClientId ?? '',
    workosApiBase: extra?.workosApiBase ?? 'https://api.workos.com',
    gitSha: extra?.gitSha ?? 'dev',
  };
};

/** Marketing version + CFBundleVersion + short SHA, e.g. `0.1.0 (24) · f60249e`. */
export const appRevisionLabel = (): string => {
  const cfg = appConfig();
  const version =
    Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '0.1.0';
  const build = Constants.nativeBuildVersion;
  const sha = cfg.gitSha === 'dev' ? 'dev' : cfg.gitSha.slice(0, 7);
  return build !== undefined && build !== ''
    ? `${version} (${build}) · ${sha}`
    : `${version} · ${sha}`;
};
