import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/ui/components';
import { GlassScreen, LiquidDisplayText, PhotoBackdrop, type GlassHeaderProps } from '@/ui/glass';
import { imageLibrary } from '@/ui/imageLibrary';
import { space } from '@/ui/tokens';

export const AUTH_COPY = {
  brandMark: 'Black\nStallion',
  brandName: 'Black Stallion Academy of Horsemanship',
  eyebrow: 'Academy of Horsemanship',
} as const;

/**
 * Editorial frame for the signed-out screens (SH-01, SH-02). 6 Nov 2026 redesign: one flat Dark Brown field (both
 * appearances), the Marwari head cut-out standing on the colour at the top right, a small serif overline, the script
 * brand mark, then the form. No photo behind text, no scrim, no fade. The brand mark is decorative lettering with one
 * accessible header; everything the person reads or types is in the sans face.
 *
 * `compact` (SH-02) keeps the cut-out small so the code field and keyboard fit on small phones, and uses a plain
 * screen title instead of the brand mark.
 */
export function AuthFrame({
  testID,
  title,
  subtitle,
  header,
  compact = false,
  children,
}: {
  testID: string;
  title?: string;
  subtitle: string;
  header?: GlassHeaderProps;
  compact?: boolean;
  children: ReactNode;
}) {
  const { height, width } = useWindowDimensions();
  const art = imageLibrary.authHorse;
  // Small phones (≤ 700 pt tall) keep the cut-out smaller so the first field and Send code stay on the first screen.
  const share = compact ? 0.18 : height <= 700 ? 0.22 : 0.34;
  const artH = Math.round(Math.min(height * share, (width * 0.62) / art.aspect));
  return (
    <GlassScreen keyboard testID={testID} header={header} tone="brown">
      <View style={[styles.artRow, { height: artH }]}>
        <View style={{ width: Math.round(artH * art.aspect), height: artH }}>
          <PhotoBackdrop source={art.source} resizeMode="contain" />
        </View>
      </View>
      <View style={styles.copy}>
        {compact ? null : (
          <AppText variant="overline" tone="muted">
            {AUTH_COPY.eyebrow.toUpperCase()}
          </AppText>
        )}
        {title ? (
          <AppText variant="title" header>
            {title}
          </AppText>
        ) : (
          <LiquidDisplayText text={AUTH_COPY.brandMark} accessibilityLabel={AUTH_COPY.brandName} role="display" />
        )}
        <AppText tone="muted">{subtitle}</AppText>
      </View>
      {children}
    </GlassScreen>
  );
}

const styles = StyleSheet.create({
  artRow: { flexDirection: 'row', justifyContent: 'flex-end', marginRight: -space.screenInset },
  copy: { gap: space.sm },
});
