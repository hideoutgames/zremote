import { displayCheckoutLabel } from '../src/components/CheckoutSelector';

test('checkout chips show full text up to 16 characters', () => {
  expect(displayCheckoutLabel('main')).toBe('main');
  expect(displayCheckoutLabel('Current checkout')).toBe('Current checkout');
  expect(displayCheckoutLabel('Studio MacBook Pro')).toBe('Studio MacBook P…');
  expect(displayCheckoutLabel('abcdefghijklmnop')).toBe('abcdefghijklmnop');
  expect(displayCheckoutLabel('abcdefghijklmnopq')).toBe('abcdefghijklmnop…');
});
