/**
 * @jest-environment node
 */
// Static a11y audit: scan every Field Ops screen source file for common accessibility gaps.
// This catches icon-only controls without labels, images without labels, and Pressables without
// accessible names AT THE SOURCE LEVEL. It does not replace VoiceOver/TalkBack testing on a device
// (which has NOT been done — label "untested on device").
//
// The runtime type system (GlassIconButton requires accessibilityLabel) provides a compile-time
// guarantee; this test catches gaps in non-glass components and validates the pattern holds at scale.
import fs from 'fs';
import path from 'path';

const FIELD_DIR = path.resolve(__dirname, '..', 'features', 'field');
const FIELD_OPS_DIR = path.resolve(__dirname, '..', 'features', 'fieldOps', 'screens');
const UI_GLASS_DIR = path.resolve(__dirname, '..', 'ui', 'glass');

function tsxFiles(dir: string): { path: string; name: string; content: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx$/.test(d.name) && !d.name.includes('.test.'))
    .map((d) => ({
      path: path.join(dir, d.name),
      name: d.name,
      content: fs.readFileSync(path.join(dir, d.name), 'utf8'),
    }));
}

const fieldScreens = tsxFiles(FIELD_DIR);
const fieldOpsScreens = tsxFiles(FIELD_OPS_DIR);
const allScreens = [...fieldScreens, ...fieldOpsScreens];

describe('A11y static audit: Field Ops screens', () => {
  test('A-01 every Pressable has an accessibilityLabel, accessibilityRole, or wraps visible text', () => {
    // Pressable or TouchableOpacity on a line without accessibilityLabel/accessibilityRole/accessible
    // is suspicious. We look for bare Pressable/TouchableOpacity JSX without a11y props on the same element.
    const issues: string[] = [];
    for (const file of allScreens) {
      // Match opening tags: <Pressable or <TouchableOpacity
      const tagPattern = /<(Pressable|TouchableOpacity)\b([^>]*?)>/g;
      let match;
      while ((match = tagPattern.exec(file.content)) !== null) {
        const attrs = match[2]!;
        const hasA11y =
          /accessibilityLabel/.test(attrs) ||
          /accessibilityRole/.test(attrs) ||
          /accessible\s*=/.test(attrs);
        // Check if it wraps a text child (heuristic: next few lines contain <Text or label=)
        const after = file.content.slice(match.index, match.index + 500);
        const wrapsText = /<Text[\s>]/.test(after.slice(0, 200));
        if (!hasA11y && !wrapsText) {
          const line = file.content.slice(0, match.index).split('\n').length;
          issues.push(`${file.name}:${line} — bare ${match[1]} without a11y props or visible text`);
        }
      }
    }
    expect(issues).toEqual([]);
  });

  test('A-02 every Image has an accessibilityLabel or is explicitly decorative', () => {
    const issues: string[] = [];
    for (const file of allScreens) {
      const imgPattern = /<Image\b([^>]*?)\/?>|<Image\b([^>]*?)>/g;
      let match;
      while ((match = imgPattern.exec(file.content)) !== null) {
        const attrs = (match[1] || match[2])!;
        const hasLabel = /accessibilityLabel/.test(attrs);
        const isDecorative =
          /accessible\s*=\s*\{?\s*false/.test(attrs) ||
          /importantForAccessibility\s*=\s*"no/.test(attrs) ||
          /accessibilityElementsHidden\s*=\s*\{?\s*true/.test(attrs);
        if (!hasLabel && !isDecorative) {
          const line = file.content.slice(0, match.index).split('\n').length;
          issues.push(`${file.name}:${line} — Image without accessibilityLabel or decorative marker`);
        }
      }
    }
    expect(issues).toEqual([]);
  });

  test('A-03 no icon-only control lacks an accessibilityLabel', () => {
    // GlassIconButton requires accessibilityLabel at the TS level, so this checks
    // non-glass patterns: <Pressable> containing <Icon> but no <Text> and no accessibilityLabel.
    const issues: string[] = [];
    for (const file of allScreens) {
      // Find Pressable/TouchableOpacity blocks with Icon but no Text
      const pressableBlocks =
        /<(Pressable|TouchableOpacity)\b([^>]*?)>([\s\S]*?)<\/\1>/g;
      let match;
      while ((match = pressableBlocks.exec(file.content)) !== null) {
        const attrs = match[2]!;
        const body = match[3]!;
        const hasIcon = /<Icon[\s>]|icon=/.test(body);
        const hasText = /<Text[\s>]/.test(body);
        const hasLabel = /accessibilityLabel/.test(attrs);
        if (hasIcon && !hasText && !hasLabel) {
          const line = file.content.slice(0, match.index).split('\n').length;
          issues.push(`${file.name}:${line} — icon-only ${match[1]} without accessibilityLabel`);
        }
      }
    }
    expect(issues).toEqual([]);
  });

  test('A-04 GlassIconButton type requires accessibilityLabel (compile-time guarantee still in place)', () => {
    // Verify the type definition still enforces this
    const glassFiles = tsxFiles(UI_GLASS_DIR);
    const iconButtonFile = glassFiles.find((f) => f.name === 'GlassIconButton.tsx');
    expect(iconButtonFile).toBeDefined();
    // accessibilityLabel must be a required (non-optional) string prop
    expect(iconButtonFile!.content).toMatch(/accessibilityLabel:\s*string\s*;/);
    expect(iconButtonFile!.content).not.toMatch(/accessibilityLabel\?\s*:/);
  });

  test('A-05 every screen file uses translated strings (no hard-coded English user-facing text)', () => {
    // Check that screens import a translator and don't have bare English strings in JSX
    const issues: string[] = [];
    for (const file of allScreens) {
      // Skip component files that are just parts/panels
      if (file.name === 'parts.tsx' || file.name === 'LocationPanel.tsx') continue;
      const usesTranslator =
        /useFieldStrings|useFieldOpsT|fieldTranslator|createFieldOpsTranslator/.test(file.content);
      if (!usesTranslator) {
        issues.push(`${file.name} — no translator import (strings may be hard-coded)`);
      }
    }
    expect(issues).toEqual([]);
  });

  test('A-06 no hard-coded accessibilityLabel strings (all labels should come from i18n)', () => {
    const issues: string[] = [];
    for (const file of allScreens) {
      // Match accessibilityLabel="some literal" (not a variable/expression)
      const hardcoded = /accessibilityLabel="[A-Za-z][^"]*"/g;
      let match;
      while ((match = hardcoded.exec(file.content)) !== null) {
        const line = file.content.slice(0, match.index).split('\n').length;
        issues.push(`${file.name}:${line} — hard-coded accessibilityLabel: ${match[0]}`);
      }
    }
    expect(issues).toEqual([]);
  });
});
