import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { AppText } from '@/ui/components';
import { editorialArt } from '@/ui/editorialArt';
import { AmbientBackdrop, GlassScreen, LiquidDisplayText, PhotoBackdrop, Pill, type GlassHeaderProps } from '@/ui/glass';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { space } from '@/ui/tokens';

export const AUTH_COPY = {
  brandMark: 'Black\nStallion',
  brandName: 'Black Stallion Academy of Horsemanship',
  eyebrow: 'Academy of Horsemanship',
} as const;

/**
 * Editorial frame for the signed-out screens (SH-01, SH-02). Default (dark) theme: the auth-hero portrait full
 * bleed, espresso scrim, copy and form in the scrim's text zone. Light theme: the portrait fades into warm paper and
 * the form sits on the paper. The brand mark is decorative liquid lettering with one accessible header.
 *
 * `compact` (SH-02) keeps less of the portrait clear, so the code field and keyboard fit on small phones, and uses a
 * plain screen title instead of the brand mark.
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
  const { appScheme } = useTheme();
  const { height } = useWindowDimensions();
  const dark = appScheme === 'dark';
  const clear = compact ? height * (dark ? 0.16 : 0.18) - 40 : height * (dark ? 0.27 : 0.3) - 40;
  return (
    <GlassScreen
      keyboard
      testID={testID}
      header={header}
      scheme={dark ? 'dark' : undefined}
      backdrop={
        dark ? (
          <PhotoBackdrop source={editorialArt.authHero} scrim="auth" />
        ) : (
          <>
            <AmbientBackdrop />
            <PhotoBackdrop source={editorialArt.authHero} scrim="fade" height={Math.round(height * 0.6)} />
          </>
        )
      }
    >
      {compact ? null : <Pill label={AUTH_COPY.eyebrow} icon="ribbon-outline" material="thick" />}
      {/* Keeps the portrait clear; the copy starts where the scrim/fade makes text safe. */}
      <View style={{ height: Math.max(compact ? space.lg : space.xl, clear) }} />
      <View style={{ gap: space.sm }}>
        {title ? (
          <AppText variant="title" header tone={dark ? 'onPhoto' : 'default'}>
            {title}
          </AppText>
        ) : (
          <LiquidDisplayText text={AUTH_COPY.brandMark} accessibilityLabel={AUTH_COPY.brandName} role="display" />
        )}
        <AppText tone={dark ? 'onPhoto' : 'muted'}>{subtitle}</AppText>
      </View>
      {children}
    </GlassScreen>
  );
}
