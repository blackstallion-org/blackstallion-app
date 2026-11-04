import { useCallback } from 'react';

import { Button, OptionGroup } from '@/ui/components';

import { useAccess } from './AccessProvider';
import type { Experience } from './domain/access';

export const EXPERIENCE_LABEL: Record<Experience, string> = { family: 'Family', field: 'Field Ops' };

/**
 * Switch sequence (07): change the context key; the previous experience's
 * route guard turns false, which removes its whole history and lands on the
 * only remaining experience home (see (authenticated)/_layout). Grants are
 * untouched. No imperative navigation: it would race the guard update.
 */
export function useExperienceSwitch() {
  const access = useAccess();
  return useCallback(
    (target: Experience) => {
      if (access.state.phase !== 'authorized' || access.state.experience === target) return;
      if (!access.state.session.allowedExperiences.includes(target)) return;
      access.switchExperience(target);
    },
    [access],
  );
}

/** Header control: rendered only when the snapshot allows both experiences (13 S03). */
export function ExperienceSwitchButton() {
  const access = useAccess();
  const switchTo = useExperienceSwitch();
  if (!access.canSwitch || access.state.phase !== 'authorized') return null;
  const target: Experience = access.state.experience === 'family' ? 'field' : 'family';
  return (
    <Button
      testID="experience-switch"
      variant="secondary"
      fullWidth={false}
      icon="swap-horizontal"
      label={`Switch to ${EXPERIENCE_LABEL[target]}`}
      accessibilityHint="Changes the view only. Your permissions stay the same."
      onPress={() => switchTo(target)}
    />
  );
}

export function ExperienceOptions() {
  const access = useAccess();
  const switchTo = useExperienceSwitch();
  if (!access.canSwitch || access.state.phase !== 'authorized') return null;
  const options = access.state.session.allowedExperiences.map((e) => ({ value: e, label: EXPERIENCE_LABEL[e] }));
  return (
    <OptionGroup
      testID="experience-options"
      label="Experience"
      options={options}
      value={access.state.experience}
      onChange={switchTo}
    />
  );
}
