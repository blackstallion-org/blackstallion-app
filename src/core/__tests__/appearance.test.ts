import { DEFAULT_APPEARANCE, parseAppearance, resolveScheme } from '../preferences/appearance';

test('default is the flat white theme (light) on first launch', () => {
  expect(DEFAULT_APPEARANCE).toBe('light');
  expect(parseAppearance(null)).toBe('light');
  expect(parseAppearance('garbage')).toBe('light');
});

test('stored values parse', () => {
  expect(parseAppearance('dark')).toBe('dark');
  expect(parseAppearance('light')).toBe('light');
  expect(parseAppearance('system')).toBe('system');
});

test('system follows the OS; explicit choices ignore it', () => {
  expect(resolveScheme('system', 'dark')).toBe('dark');
  expect(resolveScheme('system', 'light')).toBe('light');
  expect(resolveScheme('system', null)).toBe('light');
  expect(resolveScheme('light', 'dark')).toBe('light');
  expect(resolveScheme('dark', 'light')).toBe('dark');
});
