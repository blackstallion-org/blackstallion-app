import { GlassInput, type GlassInputProps } from '@/ui/glass/GlassInput';

export type TextFieldProps = Omit<GlassInputProps, 'variant'>;

/** Pre-glass API kept for existing screens; renders a GlassInput (label outside the glass). */
export function TextField(props: TextFieldProps) {
  // A one-time-code field gets the OTP presentation automatically.
  return <GlassInput {...props} variant={props.textContentType === 'oneTimeCode' ? 'otp' : 'text'} />;
}
