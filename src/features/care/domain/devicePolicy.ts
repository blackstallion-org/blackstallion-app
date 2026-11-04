// Gates for behaviour that depends on unresolved policy. Default is restrictive; flip only with recorded evidence.

/**
 * Local evidence storage protection (10 §Storage boundaries). Until a target build proves file protection
 * (iOS data protection class, Android file-based encryption, backup exclusion) and the owner accepts the result,
 * real users cannot save proof photos/locations on the device. Synthetic development builds may.
 */
export type StorageProtectionStatus = 'unverified' | 'verified_on_device';

export interface DevicePolicyInput {
  buildProfile: 'development' | 'preview' | 'production';
  usesSyntheticData: boolean;
  storageProtection: StorageProtectionStatus;
  ownerAcceptedStorageEvidence: boolean;
}

export interface DevicePolicy {
  offlineEvidenceAllowed: boolean;
  offlineEvidenceReason: 'synthetic_dev_only' | 'approved' | 'storage_protection_unverified';
  /** D11 unapproved: no check-in UI, no client claim of identity verification, no face recognition */
  staffCheckInAvailable: false;
  /** device biometrics may unlock the app locally but are never sent as proof of employee identity */
  biometricUnlockIsIdentityProof: false;
}

export function evaluateDevicePolicy(i: DevicePolicyInput): DevicePolicy {
  let allowed = false;
  let reason: DevicePolicy['offlineEvidenceReason'] = 'storage_protection_unverified';
  if (i.storageProtection === 'verified_on_device' && i.ownerAcceptedStorageEvidence) {
    allowed = true;
    reason = 'approved';
  } else if (i.buildProfile === 'development' && i.usesSyntheticData) {
    allowed = true;
    reason = 'synthetic_dev_only';
  }
  return { offlineEvidenceAllowed: allowed, offlineEvidenceReason: reason, staffCheckInAvailable: false, biometricUnlockIsIdentityProof: false };
}
