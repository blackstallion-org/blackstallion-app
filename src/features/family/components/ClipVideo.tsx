import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';

/**
 * The native player boundary for a PRIVATE clip. The source is a short-lived signed URL; caching is off so nothing of
 * the child's video is kept on the device after the screen closes (D13), and the player is released on unmount.
 * Full screen goes through the OS control. Not device-verified (web render + jest only).
 */
export function ClipVideo({ uri, label, onError, autoPlay = true, testID }: { uri: string; label: string; onError: () => void; autoPlay?: boolean; testID?: string }) {
  const player = useVideoPlayer({ uri, useCaching: false }, (p) => {
    p.loop = false;
    if (autoPlay) p.play();
  });
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') onError();
  });
  return (
    <VideoView
      testID={testID}
      player={player}
      nativeControls
      contentFit="contain"
      allowsPictureInPicture={false}
      fullscreenOptions={{ enable: true }}
      accessibilityLabel={label}
      style={styles.video}
    />
  );
}

const styles = StyleSheet.create({ video: { width: '100%', height: '100%' } });
