import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// Mock the warm singleton with real refs we can mutate, and the avatar generator
// so the test is deterministic and doesn't pull IndexedDB/crypto into node env.
vi.mock('@/db/avatars', () => ({ initialsAvatar: (n: string) => `initials:${n}` }));
vi.mock('@/composables/warmStores', async () => {
  const { ref } = await import('vue');
  return {
    profileName: ref('Alice'),
    profileAbout: ref('Hey there! I am using Ring.'),
    profileAvatarRaw: ref(''),
  };
});

import { useSelfProfile } from './useSelfProfile';
import { profileName, profileAvatarRaw } from '@/composables/warmStores';

beforeEach(() => {
  profileName.value = 'Alice';
  profileAvatarRaw.value = '';
});

describe('useSelfProfile', () => {
  it('returns the SAME singleton refs across calls (shared identity)', () => {
    const a = useSelfProfile();
    const b = useSelfProfile();
    // name + about are the singleton refs themselves, identical across callers.
    expect(a.name).toBe(b.name);
    expect(a.about).toBe(b.about);
    expect(a.name).toBe(profileName);
  });

  it('reflects warm-store updates without a per-call cold restart', () => {
    const { name } = useSelfProfile();
    expect(name.value).toBe('Alice');
    profileName.value = 'Bob Real';
    expect(name.value).toBe('Bob Real');
  });

  it('falls back to a generated initials avatar when no photo is set', () => {
    const { avatar } = useSelfProfile();
    expect(avatar.value).toBe('initials:Alice');
  });

  it('uses the real photo once present', () => {
    const { avatar } = useSelfProfile();
    profileAvatarRaw.value = 'data:image/png;base64,REAL';
    expect(avatar.value).toBe('data:image/png;base64,REAL');
  });
});
