import { BlurTargetView } from 'expo-blur';
import { createContext, useContext, useRef, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { StyleSheet, type View } from 'react-native';

type TargetRef = RefObject<ComponentRef<typeof View> | null>;

const BlurTargetContext = createContext<TargetRef | null>(null);

/** The blur target registered behind the current subtree (Android blur source), if any. */
export const useBlurTarget = (): TargetRef | null => useContext(BlurTargetContext);

/**
 * Wraps the decorative backdrop (photo + scrims) of a screen in an expo-blur
 * BlurTargetView and exposes it to glass surfaces rendered ON TOP of it (as
 * siblings, never descendants). On iOS and web this is a plain View.
 *
 * Usage: <GlassBackdropHost backdrop={<PhotoBackdrop … />}>{content}</GlassBackdropHost>
 */
export function GlassBackdropHost({ backdrop, children }: { backdrop: ReactNode; children: ReactNode }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  return (
    <BlurTargetContext.Provider value={ref}>
      <BlurTargetView
        ref={ref}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {backdrop}
      </BlurTargetView>
      {children}
    </BlurTargetContext.Provider>
  );
}
