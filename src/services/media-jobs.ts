/**
 * In-memory progress for in-flight media background jobs, keyed by message id.
 * Two phases are tracked separately so the bubble can show a "Encoding" bar and
 * an "Uploading" bar with relatively accurate fill. Deliberately NOT persisted:
 * an interrupted job resumes from 0 on restart.
 */
import { reactive } from 'vue';

export interface JobProgress {
  compress: number; // 0..1
  upload: number; // 0..1
}

export const jobProgress = reactive<Record<string, JobProgress>>({});

function ensure(messageId: string): JobProgress {
  if (!jobProgress[messageId]) jobProgress[messageId] = { compress: 0, upload: 0 };
  return jobProgress[messageId];
}
const clamp = (p: number) => Math.max(0, Math.min(1, p));

export function setCompressProgress(messageId: string, p: number): void {
  ensure(messageId).compress = clamp(p);
}
export function setUploadProgress(messageId: string, p: number): void {
  ensure(messageId).upload = clamp(p);
}
export function resetJobProgress(messageId: string): void {
  jobProgress[messageId] = { compress: 0, upload: 0 };
}
export function clearJobProgress(messageId: string): void {
  delete jobProgress[messageId];
}
