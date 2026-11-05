/**
 * Amber liquid-glass primitives (design/claude-liquid-glass-brief §3–4).
 * Screen builders compose screens from these; every app-owned action goes
 * through GlassButton / GlassIconButton / Chip / SegmentedControl / Row / GlassTabBar.
 */
export { GlassSurface } from './GlassSurface';
export { GLASS_SHOWCASE_PRESET, type GlassSurfaceProps } from './GlassSurface.types';
export { selectGlassRenderer, type GlassFill, type GlassRenderer } from './glassRenderer';
export { GlassBackdropHost, useBlurTarget } from './GlassBackdrop';
export { GlassButton, type GlassButtonProps, type GlassButtonVariant } from './GlassButton';
export { GlassIconButton, type GlassIconButtonProps } from './GlassIconButton';
export { GlassCard, type GlassCardProps } from './GlassCard';
export { GlassInput, type GlassInputProps } from './GlassInput';
export { ConfirmDialog, GlassBottomSheet, GlassDialog, type ConfirmDialogProps, type GlassBottomSheetProps, type GlassDialogProps } from './GlassModal';
export { GlassTabBar } from './GlassTabBar';
export { FloatingTabBarScope, useFloatingTabInset, useInFloatingTabs } from './floatingTabInset';
export { LiquidDisplayText } from './LiquidDisplayText';
export { PhotoBackdrop } from './PhotoBackdrop';
export { AmbientBackdrop, GlassHeader, GlassScreen, GlassScreen as Page, type GlassHeaderProps, type GlassScreenProps } from './GlassScreen';
export {
  EmptyState,
  ErrorState,
  FeatureGatedState,
  LoadingState,
  OfflineState,
  PermissionDeniedState,
  Skeleton,
  StatusNote,
  SyntheticDataBanner,
  UnavailableState,
  type StateAction,
} from './states';
export { Chip, Pill } from './Chip';
export { SegmentedControl, type Segment } from './SegmentedControl';
export { ListGroup, Row, type RowProps } from './ListGroup';
export { ScoreTile } from './ScoreTile';
export { StatusBadge, toneColors, type StatusTone } from './StatusBadge';
export { usePressGuard, type PressHandler } from './usePressGuard';
