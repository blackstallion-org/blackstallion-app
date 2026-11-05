import { DEFAULT_APPEARANCE, parseAppearance, resolveScheme } from '../preferences/appearance';

test('default is the espresso/amber theme (dark) on first launch', () => {
  expect(DEFAULT_APPEARANCE).toBe('dark');
  expect(parseAppearance(null)).toBe('dark');
  expect(parseAppearance('garbage')).toBe('dark');
});

test('stored values parse', () => {
  expect(parseAppearance('dark')).toBe('dark');
  expect(parseAppearance('light')).toBe('light');
  expect(parseAppearance('system')).toBe('system');
});

test('system follows the OS; explicit choices ignore it', () => {
  expect(resolveScheme('system', 'dark')).toBe('dark');
  expect(resolveScheme('system', 'light')).toBe('light');
  expect(resolveScheme('system', null)).toBe('dark');
  expect(resolveScheme('light', 'dark')).toBe('light');
  expect(resolveScheme('dark', 'light')).toBe('dark');
});
