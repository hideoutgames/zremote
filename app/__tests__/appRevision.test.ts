import { appConfig, appRevisionLabel } from '../src/zeron/native/appConfig';

test('appRevisionLabel falls back to marketing version and dev sha', () => {
  expect(appConfig().gitSha).toBe('dev');
  expect(appRevisionLabel()).toBe('0.1.0 · dev');
});
