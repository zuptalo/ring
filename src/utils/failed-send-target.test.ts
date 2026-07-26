import { describe, it, expect } from 'vitest';
import { pickFailedJumpTarget } from './failed-send-target';

const hidden = (ids: string[]) => (id: string) => ids.includes(id);

describe('pickFailedJumpTarget', () => {
  it('jumps to the most recent failure in a non-hidden chat', () => {
    const target = pickFailedJumpTarget(
      [
        { id: 'm1', chatId: 'c1', timestamp: 100 },
        { id: 'm2', chatId: 'c1', timestamp: 300 },
        { id: 'm3', chatId: 'c2', timestamp: 200 },
      ],
      hidden([]),
    );
    expect(target).toEqual({ chatId: 'c1', messageId: 'm2' });
  });

  it('returns nothing when every failure is in a hidden chat (informative-only banner)', () => {
    const target = pickFailedJumpTarget(
      [
        { id: 'm1', chatId: 'secret', timestamp: 100 },
        { id: 'm2', chatId: 'secret', timestamp: 300 },
      ],
      hidden(['secret']),
    );
    expect(target).toBeUndefined();
  });

  it('skips a more-recent hidden failure and targets the newest visible one', () => {
    const target = pickFailedJumpTarget(
      [
        { id: 'mv', chatId: 'visible', timestamp: 100 },
        { id: 'mh', chatId: 'secret', timestamp: 999 }, // newer, but hidden — must be skipped
      ],
      hidden(['secret']),
    );
    expect(target).toEqual({ chatId: 'visible', messageId: 'mv' });
  });

  it('ignores items with no chatId', () => {
    const target = pickFailedJumpTarget(
      [
        { id: 'm1', timestamp: 500 },
        { id: 'm2', chatId: 'c1', timestamp: 100 },
      ],
      hidden([]),
    );
    expect(target).toEqual({ chatId: 'c1', messageId: 'm2' });
  });

  it('returns nothing for an empty failure set', () => {
    expect(pickFailedJumpTarget([], hidden([]))).toBeUndefined();
  });
});
