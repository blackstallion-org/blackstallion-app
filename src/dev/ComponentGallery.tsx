import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { SparkWaveform } from '@/features/family/spark/SparkWaveform';
import { AppText, Icon } from '@/ui/components';
import { editorialArt } from '@/ui/editorialArt';
import { imageLibrary } from '@/ui/imageLibrary';
import {
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  GLASS_SHOWCASE_PRESET,
  GlassBottomSheet,
  GlassButton,
  GlassCard,
  GlassDialog,
  GlassIconButton,
  GlassInput,
  GlassScreen,
  GlassSurface,
  GlassTabBar,
  LiquidDisplayText,
  ListGroup,
  LoadingState,
  OfflineState,
  PermissionDeniedState,
  PhotoBackdrop,
  Pill,
  Row,
  ScoreTile,
  SegmentedControl,
  StatusBadge,
  StatusNote,
  SyntheticDataBanner,
  UnavailableState,
} from '@/ui/glass';
import { ThemeScope, useTheme } from '@/ui/theme/ThemeProvider';
import { palette, radius, space } from '@/ui/tokens';

type SchemeChoice = 'dark' | 'light' | 'both';

/** Deterministic synthetic samples for the waveform renderer demo (NOT audio; gallery only). */
const GALLERY_SAMPLES = Array.from({ length: 3200 }, (_, i) => Math.sin(i / 9) * (0.25 + 0.75 * Math.abs(Math.sin(i / 400))));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** DEVELOPMENT-ONLY gallery of every glass primitive and state, for review and screenshots. */
export function ComponentGallery() {
  const { appScheme } = useTheme();
  const [scheme, setScheme] = useState<SchemeChoice>(appScheme);
  const [rt, setRt] = useState(false);
  const [rm, setRm] = useState(false);
  return (
    <GlassScreen edges={['left', 'right', 'bottom']} keyboard testID="component-gallery">
      <SyntheticDataBanner text="Development-only component gallery. Web renders here are react-native-web, not native iOS/Android." />
      <SegmentedControl
        label="Gallery scheme"
        value={scheme}
        onChange={setScheme}
        segments={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'White' },
          { value: 'both', label: 'Both' },
        ]}
        testID="gallery-scheme"
      />
      <View style={styles.wrap}>
        <Chip label="Reduce Transparency" icon={rt ? 'checkbox' : 'square-outline'} selected={rt} onPress={() => setRt((v) => !v)} testID="gallery-rt" />
        <Chip label="Reduce Motion" icon={rm ? 'checkbox' : 'square-outline'} selected={rm} onPress={() => setRm((v) => !v)} testID="gallery-rm" />
      </View>
      {(scheme === 'both' ? (['dark', 'light'] as const) : [scheme]).map((s) => (
        <ThemeScope key={s} scheme={s} reduceTransparency={rt} reduceMotion={rm}>
          <GalleryBlock title={`${s === 'dark' ? 'Dark (night)' : 'White (default)'}${rt ? ' · Reduce Transparency' : ''}${rm ? ' · Reduce Motion' : ''}`} />
        </ThemeScope>
      ))}
    </GlassScreen>
  );
}

function GalleryBlock({ title }: { title: string }) {
  const { colors } = useTheme();
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [seg, setSeg] = useState<'riding' | 'ground' | 'stable'>('riding');
  const [chip, setChip] = useState('a');
  const [text, setText] = useState('');
  const [otp, setOtp] = useState('');
  return (
    <View style={[styles.block, { backgroundColor: colors.canvas, borderColor: colors.border }]}>
      <AppText variant="title" header>
        {title}
      </AppText>

      <Group title="Palette (exact, 6 Nov 2026)">
        <View style={styles.wrap}>
          {Object.entries(palette).map(([name, hex]) => (
            <View key={name} style={styles.swatch} accessible accessibilityLabel={`${name} ${hex}`}>
              <View style={[styles.swatchChip, { backgroundColor: hex, borderColor: colors.border }]} />
              <AppText variant="caption">{name}</AppText>
              <AppText variant="caption" tone="muted">
                {hex}
              </AppText>
            </View>
          ))}
        </View>
      </Group>

      <Group title="Type roles">
        <LiquidDisplayText text={'Black\nStallion'} accessibilityLabel="Black Stallion (liquid lettering sample)" role="display" />
        <AppText variant="display">Display</AppText>
        <AppText variant="title">Screen title 32/38</AppText>
        <AppText variant="section">Section title 22/28</AppText>
        <AppText>Body 16/24 — readable utility text in the platform system sans.</AppText>
        <AppText variant="button">Button 16/20</AppText>
        <AppText variant="secondary" tone="muted">
          Secondary 14/20 metadata
        </AppText>
        <AppText variant="caption" tone="muted">
          Caption 12/16
        </AppText>
        <AppText variant="score">8 6 10</AppText>
        <AppText>हिंदी नमूना: आज का अभ्यास पूरा हुआ (sample)</AppText>
        <AppText>తెలుగు నమూనా: నేటి సాధన పూర్తయింది (sample)</AppText>
      </Group>

      <Group title="GlassSurface over editorial art (showcase preset 320×76 r38; web adds SVG refraction)">
        <View style={styles.stage}>
          <PhotoBackdrop source={editorialArt.sparkCover} scrim="card" imageStyle={{ top: -40, height: 640 }} />
          <GlassSurface {...GLASS_SHOWCASE_PRESET} width="100%" style={{ maxWidth: 320 }} contentStyle={styles.center} testID="glass-showcase">
            <AppText variant="button">Your content</AppText>
          </GlassSurface>
          <View style={styles.wrap}>
            <Pill label="thin" material="thin" />
            <Pill label="regular" material="regular" />
            <Pill label="thick" material="thick" />
          </View>
        </View>
      </Group>

      <Group title="Image library (assets/library — approved, decorative; cut-outs on flat colour)">
        <View style={styles.wrap}>
          {Object.entries(imageLibrary).map(([name, img]) => (
            <View key={name} style={{ width: 150, gap: space.xs }}>
              <View style={{ height: 120, backgroundColor: img.cutout ? palette.pearl : undefined }}>
                <PhotoBackdrop source={img.source} resizeMode={img.cutout ? 'contain' : 'cover'} />
              </View>
              <AppText variant="caption" tone="muted">
                {name}
              </AppText>
            </View>
          ))}
        </View>
      </Group>

      <Group title="Buttons">
        <GlassButton label="Primary (56)" icon="arrow-forward" iconPosition="trailing" onPress={() => undefined} />
        <GlassButton label="Secondary" variant="secondary" onPress={() => undefined} />
        <GlassButton label="Ghost" variant="ghost" onPress={() => undefined} />
        <GlassButton label="Delete draft" variant="destructive" icon="trash-outline" onPress={() => setConfirm(true)} />
        <GlassButton label="Async save (guarded)" variant="secondary" onPress={() => wait(1500)} testID="gallery-async" />
        <GlassButton label="Loading" loading onPress={() => undefined} />
        <GlassButton label="Disabled" disabled onPress={() => undefined} />
        <View style={styles.wrap}>
          <GlassIconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => undefined} />
          <GlassIconButton icon="play" accessibilityLabel="Play" appearance="solid" size={64} onPress={() => undefined} />
          <GlassIconButton icon="ellipsis-horizontal" accessibilityLabel="More" appearance="plain" onPress={() => undefined} />
          <GlassIconButton icon="share-outline" accessibilityLabel="Share (disabled)" disabled onPress={() => undefined} />
        </View>
      </Group>

      <Group title="Chips, pills, segmented control">
        <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Sample chips">
          <Chip role="radio" label="Aarav (sample)" selected={chip === 'a'} onPress={() => setChip('a')} />
          <Chip role="radio" label="Meera (sample)" selected={chip === 'm'} onPress={() => setChip('m')} />
        </View>
        <Pill label="Daily Spark" icon="sparkles-outline" />
        <SegmentedControl label="Score" value={seg} onChange={setSeg} segments={[{ value: 'riding', label: 'Riding' }, { value: 'ground', label: 'Ground' }, { value: 'stable', label: 'Stable' }]} />
      </Group>

      <Group title="Inputs (label outside the glass)">
        <GlassInput label="Mobile number" hint="10 digits, India (+91)" value={text} onChangeText={setText} keyboardType="phone-pad" />
        <GlassInput label="With error" value="12345" error="Enter a 10-digit mobile number starting with 6, 7, 8 or 9." onChangeText={() => undefined} />
        <GlassInput label="6-digit code" variant="otp" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, ''))} />
      </Group>

      <Group title="Cards">
        <GlassCard>
          <AppText variant="section">Regular card (r22)</AppText>
          <AppText tone="muted">Glass panel for grouped content.</AppText>
        </GlassCard>
        <GlassCard variant="photo" image={editorialArt.communityEvent} height={220}>
          <Pill label="Photo card (r32)" material="thick" />
          <AppText variant="section" tone="onPhoto">
            Picture in a frame, copy on a flat block
          </AppText>
        </GlassCard>
        <GlassCard expandable expandedContent={<AppText tone="muted">Expanded content. No drag (disabled by design).</AppText>}>
          <AppText variant="bodyStrong">Expandable card</AppText>
        </GlassCard>
      </Group>

      <Group title="List group, rows, badges, scores">
        <ListGroup title="Care (sample)">
          <Row label="06:00 · Badal (sample)" value="Morning feed" icon="leaf-outline" trailing={<StatusBadge label="Done" tone="success" />} />
          <Row label="09:00 · Chetak (sample)" value="Water" icon="leaf-outline" trailing={<StatusBadge label="Overdue" tone="danger" />} />
          <Row label="Settings" value="Pressable row" icon="settings-outline" onPress={() => undefined} />
        </ListGroup>
        <View style={styles.wrap}>
          <StatusBadge label="Neutral" />
          <StatusBadge label="Info" tone="info" />
          <StatusBadge label="Done" tone="success" />
          <StatusBadge label="Due" tone="warning" />
          <StatusBadge label="Overdue" tone="danger" />
        </View>
        <GlassCard>
          <View style={styles.row}>
            <ScoreTile label="Riding" value={8} />
            <ScoreTile label="Ground" value={6} />
            <ScoreTile label="Stable" value={null} />
          </View>
        </GlassCard>
        <StatusNote tone="info" message="Information message." />
        <StatusNote tone="success" title="Saved" message="Success message." />
        <StatusNote tone="warning" message="1 overdue care task" />
        <StatusNote tone="danger" title="Not saved" message="Error message." />
      </Group>

      <Group title="Waveform renderer (synthetic samples — gallery only, not audio)">
        <View style={styles.stage}>
          <PhotoBackdrop source={editorialArt.sparkCover} scrim="spark" />
          <ThemeScope scheme="dark">
            <SparkWaveform peaks={GALLERY_SAMPLES} progress={0.4} />
          </ThemeScope>
        </View>
      </Group>

      <Group title="States">
        <GlassCard>
          <LoadingState label="Loading example" rows={1} />
        </GlassCard>
        <GlassCard>
          <EmptyState title="Nothing here yet" message="One sentence and one useful action." action={{ label: 'Useful action', onPress: () => undefined }} />
        </GlassCard>
        <GlassCard>
          <ErrorState message="This information could not be loaded." onRetry={() => undefined} details="Reference: EXAMPLE-0001" />
        </GlassCard>
        <GlassCard>
          <PermissionDeniedState title="Camera is off" message="Allow camera access in your phone settings to scan passports." onOpenSettings={() => undefined} />
        </GlassCard>
        <GlassCard>
          <OfflineState lastUpdated="09:41" onRetry={() => undefined} />
        </GlassCard>
        <GlassCard>
          <UnavailableState message="This feature is switched off until the academy confirms its rules." />
        </GlassCard>
        <SyntheticDataBanner />
      </Group>

      <Group title="Sheets and dialogs (Modal-based)">
        <GlassButton label="Open bottom sheet" variant="secondary" icon="albums-outline" onPress={() => setSheet(true)} />
        <GlassButton label="Open dialog" variant="secondary" icon="chatbox-outline" onPress={() => setDialog(true)} />
        <GlassButton label="Open destructive confirm" variant="secondary" icon="warning-outline" onPress={() => setConfirm(true)} />
      </Group>

      <Group title="Floating tab bar (static preview; real router state in the app)">
        <View style={styles.tabStage}>
          <TabBarPreview />
        </View>
      </Group>

      <GlassBottomSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Sync item"
        description="Bottom sheet on thick glass. Scrim, Android back and Escape close it."
        actions={<GlassButton label="Done" onPress={() => setSheet(false)} />}
      />
      <GlassDialog visible={dialog} onClose={() => setDialog(false)} title="Dialog" message="Centred dialog on thick glass." actions={<GlassButton label="OK" onPress={() => setDialog(false)} />} />
      <ConfirmDialog
        visible={confirm}
        title="Discard queued item?"
        message="It hasn’t reached the academy. Discarding removes it from this phone."
        confirmLabel="Discard item"
        destructiveIcon="trash-outline"
        onConfirm={async () => {
          await wait(600);
          setConfirm(false);
        }}
        onCancel={() => setConfirm(false)}
      />
    </View>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <AppText variant="secondary" tone="muted" header style={{ fontWeight: '600' }}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

function TabBarPreview() {
  const [index, setIndex] = useState(0);
  const tabs = [
    { key: 'home', title: 'Home', icon: 'home' },
    { key: 'progress', title: 'Progress', icon: 'trending-up-outline' },
    { key: 'horse', title: 'Horse', icon: 'heart-outline' },
    { key: 'community', title: 'Community', icon: 'calendar-outline' },
    { key: 'profile', title: 'Profile', icon: 'person-outline' },
  ] as const;
  const descriptors = Object.fromEntries(
    tabs.map((t) => [
      t.key,
      { options: { title: t.title, tabBarIcon: ({ color }: { color: string }) => <Icon name={t.icon} color={color} size={24} /> } },
    ]),
  );
  const props = {
    state: { index, routes: tabs.map((t) => ({ key: t.key, name: t.key })) },
    descriptors,
    emitter: { emit: () => ({ defaultPrevented: false }) },
    navigateToTab: (key: string) => setIndex(tabs.findIndex((t) => t.key === key)),
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as Parameters<typeof GlassTabBar>[0];
  return <GlassTabBar {...props} />;
}

const styles = StyleSheet.create({
  block: { gap: space.xl, padding: space.lg, borderRadius: radius.hero, borderWidth: StyleSheet.hairlineWidth, marginHorizontal: -space.sm },
  group: { gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  row: { flexDirection: 'row', gap: space.lg },
  swatch: { width: 96, gap: 2 },
  swatchChip: { height: 44, borderRadius: radius.control, borderWidth: 1 },
  stage: { borderRadius: radius.hero, overflow: 'hidden', padding: space.lg, gap: space.md, minHeight: 200, justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  tabStage: { height: 96, borderRadius: radius.card, overflow: 'hidden' },
});
