import { describe, it, expect } from 'vitest';
import { notifyPreview } from './notify-preview';
import type { MessagePayload } from '@/services/crypto/message';

const p = (over: Partial<MessagePayload>): MessagePayload => ({ kind: 'text', ...over }) as MessagePayload;

describe('notifyPreview', () => {
  it('prefers an album name over everything', () => {
    expect(notifyPreview(p({ albumName: 'Trip', body: 'cap', kind: 'image' }))).toBe('Trip');
  });

  it('uses the body/caption when present', () => {
    expect(notifyPreview(p({ kind: 'text', body: 'hello' }))).toBe('hello');
    expect(notifyPreview(p({ kind: 'image', body: 'a caption' }))).toBe('a caption');
  });

  it('spells out media kinds without a caption', () => {
    expect(notifyPreview(p({ kind: 'image' }))).toBe('Photo');
    expect(notifyPreview(p({ kind: 'video' }))).toBe('Video');
    expect(notifyPreview(p({ kind: 'video', videoNote: true }))).toBe('Video note');
    expect(notifyPreview(p({ kind: 'voice' }))).toBe('Voice message');
    expect(notifyPreview(p({ kind: 'file' }))).toBe('Document');
  });

  it('uses titles/labels for rich kinds, with fallbacks', () => {
    expect(notifyPreview(p({ kind: 'audio', audio: { title: 'Song' } }))).toBe('Song');
    expect(notifyPreview(p({ kind: 'audio' }))).toBe('Audio');
    expect(notifyPreview(p({ kind: 'location', location: { lat: 0, lng: 0, label: 'Home' } }))).toBe('Location: Home');
    expect(notifyPreview(p({ kind: 'location' }))).toBe('Shared a location');
    expect(notifyPreview(p({ kind: 'poll', poll: { question: 'Lunch?', options: [], multi: false, votes: [] } }))).toBe('Poll: Lunch?');
    expect(notifyPreview(p({ kind: 'contact', contact: { userId: 'u', name: 'Ada' } }))).toBe('Contact: Ada');
  });

  it('falls back to a generic line for an unknown kind', () => {
    expect(notifyPreview(p({ kind: 'whatever' as MessagePayload['kind'] }))).toBe('New message');
  });

  // Spec 0008 (US3): game bubbles and move signals get spelled-out lines.
  it('spells out a game invitation, with a generic fallback for unknown games', () => {
    expect(notifyPreview(p({ kind: 'game', game: { gameType: 'tictactoe' } }))).toBe(
      'Wants to play Tic-tac-toe',
    );
    expect(notifyPreview(p({ kind: 'game', game: { gameType: 'from-the-future' } }))).toBe(
      'Wants to play a game',
    );
  });

});
