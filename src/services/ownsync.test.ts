import { describe, it, expect } from 'vitest';
import { SYNCED_PREF_KEYS } from './ownsync-keys';

describe('own-data sync key allowlist (spec 1026 US2 / FR-010)', () => {
  it('does not sync the removed privacy.blockUnknown key', () => {
    expect(SYNCED_PREF_KEYS).not.toContain('privacy.blockUnknown');
  });

  it('still syncs the relocated privacy.disableLinkPreviews key', () => {
    expect(SYNCED_PREF_KEYS).toContain('privacy.disableLinkPreviews');
  });
});
