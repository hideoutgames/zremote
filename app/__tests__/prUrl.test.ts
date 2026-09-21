import { Platform, Share } from 'react-native';
import { sharePrUrl } from '../src/components/prUrl';

test('iOS share sends only the url field', () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.sharedAction } as never);
  Object.defineProperty(Platform, 'OS', { value: 'ios' });
  sharePrUrl('https://example.test/cr/1');
  expect(share).toHaveBeenCalledWith({ url: 'https://example.test/cr/1' });
  share.mockRestore();
});

test('non-iOS share sends only the message field', () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.sharedAction } as never);
  Object.defineProperty(Platform, 'OS', { value: 'android' });
  sharePrUrl('https://example.test/cr/1');
  expect(share).toHaveBeenCalledWith({
    message: 'https://example.test/cr/1',
  });
  share.mockRestore();
  Object.defineProperty(Platform, 'OS', { value: 'ios' });
});
