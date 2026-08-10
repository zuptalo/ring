import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { put } from '@/db/idb';
import type { Post, Setting } from '@/db/types';
import { bytesToB64url } from '@/services/crypto/envelope';
import { genPostKey, sealActivityPreview } from '@/services/crypto/post';
import { ready } from '@/services/crypto/primitives';
import { previewPostActivityInline } from './sw-inbox';

beforeAll(async () => ready());

describe('closed-app sender-sealed comment activity preview', () => {
  it('decrypts locally, deep-links, and records the engagement exactly once', async () => {
    const postId = `preview-post-${crypto.randomUUID()}`;
    const key = genPostKey();
    await put<Post>('posts', {
      id: postId,
      author: 'author',
      kind: 'text',
      createdAt: Date.now(),
      outgoing: false,
      postKey: bytesToB64url(key),
      updatedAt: Date.now(),
    });
    const preview = sealActivityPreview(key, {
      id: `preview-engagement-${crypto.randomUUID()}`,
      actor: 'friend',
      title: 'Bea',
      body: 'replied to you',
    });

    expect(await previewPostActivityInline(postId, preview)).toEqual([
      expect.objectContaining({ title: 'Bea', body: 'replied to you', url: `/wall/post/${postId}` }),
    ]);
    expect(await previewPostActivityInline(postId, preview)).toEqual([]);
  });

  it('falls back silently when the key is wrong and hides sender copy when previews are off', async () => {
    const postId = `preview-post-${crypto.randomUUID()}`;
    const localKey = genPostKey();
    await put<Post>('posts', {
      id: postId,
      author: 'author',
      kind: 'text',
      createdAt: Date.now(),
      outgoing: false,
      postKey: bytesToB64url(localKey),
      updatedAt: Date.now(),
    });
    expect(await previewPostActivityInline(postId, sealActivityPreview(genPostKey(), {
      id: crypto.randomUUID(), actor: 'friend', title: 'Bea', body: 'replied to you',
    }))).toEqual([]);

    await put<Setting<boolean>>('settings', { key: 'notifications.showPreview', value: false });
    const note = await previewPostActivityInline(postId, sealActivityPreview(localKey, {
      id: crypto.randomUUID(), actor: 'friend', title: 'Bea', body: 'reacted ❤️ to your comment',
    }));
    expect(note[0]).toMatchObject({ title: 'Ring', body: 'New activity' });
  });
});
