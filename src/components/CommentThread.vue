<template>
  <div class="thread-list">
    <template v-for="thread in threads" :key="thread.comment.id">
      <ion-list class="comment-group">
        <ion-item-sliding>
          <ion-item lines="none" class="comment-row">
            <ion-avatar v-if="!thread.comment.deleted" slot="start" class="avatar">
              <user-avatar
                :src="avatarOf(thread.comment.actor) || initialsAvatar(nameOf(thread.comment.actor))"
                :alt="nameOf(thread.comment.actor)"
              />
            </ion-avatar>
            <ion-label class="content" dir="auto">
              <template v-if="thread.comment.deleted">
                <p class="deleted">This comment was deleted</p>
              </template>
              <template v-else>
                <div class="meta">
                  <strong>{{ nameOf(thread.comment.actor) }}</strong>
                  <span>{{ ago(thread.comment.at) }}</span>
                </div>
                <p class="text"><emoji-text :text="thread.comment.text || ''" /></p>
                <div class="actions">
                  <ion-button fill="clear" size="small" @click="$emit('reply', thread.comment)">Reply</ion-button>
                  <reaction-actions :comment="thread.comment" />
                </div>
              </template>
            </ion-label>
          </ion-item>
          <ion-item-options v-if="!thread.comment.deleted && canModerate(thread.comment)" side="end">
            <ion-item-option color="danger" @click="$emit('delete', thread.comment)">Delete</ion-item-option>
          </ion-item-options>
        </ion-item-sliding>

        <div v-if="thread.replies.length" class="replies">
          <ion-item-sliding v-for="reply in visibleReplies(thread)" :key="reply.id">
            <ion-item lines="none" class="comment-row reply-row">
              <ion-avatar slot="start" class="avatar">
                <user-avatar :src="avatarOf(reply.actor) || initialsAvatar(nameOf(reply.actor))" :alt="nameOf(reply.actor)" />
              </ion-avatar>
              <ion-label class="content" dir="auto">
                <div class="meta">
                  <strong>{{ nameOf(reply.actor) }}</strong>
                  <span>{{ ago(reply.at) }}</span>
                </div>
                <p v-if="reply.replyToActor" class="answering">
                  Replying to {{ reply.replyToName || nameOf(reply.replyToActor) }}
                </p>
                <p class="text"><emoji-text :text="reply.text || ''" /></p>
                <div class="actions">
                  <ion-button fill="clear" size="small" @click="$emit('reply', reply)">Reply</ion-button>
                  <reaction-actions :comment="reply" />
                </div>
              </ion-label>
            </ion-item>
            <ion-item-options v-if="canModerate(reply)" side="end">
              <ion-item-option color="danger" @click="$emit('delete', reply)">Delete</ion-item-option>
            </ion-item-options>
          </ion-item-sliding>

          <ion-button
            v-if="thread.replies.length > REPLIES_SHOWN"
            fill="clear"
            size="small"
            class="more"
            @click="toggleThread(thread.comment.id)"
          >{{ expanded.has(thread.comment.id) ? 'Show fewer replies' : `Show ${thread.replies.length - REPLIES_SHOWN} more replies` }}</ion-button>
        </div>
      </ion-list>
    </template>

    <p v-if="!threads.length" class="empty">No comments yet.</p>

    <audience-sheet
      :is-open="!!audienceComment"
      title="Reactions"
      :rows="audienceRows"
      :by-emoji="true"
      empty-text="No reactions yet"
      @dismiss="audienceComment = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, type PropType } from 'vue';
import {
  IonAvatar, IonButton, IonItem, IonItemOption, IonItemOptions,
  IonItemSliding, IonLabel, IonList,
} from '@ionic/vue';
import UserAvatar from '@/components/UserAvatar.vue';
import EmojiText from '@/components/EmojiText.vue';
import Emoji from '@/components/Emoji.vue';
import AudienceSheet from '@/components/AudienceSheet.vue';
import { initialsAvatar } from '@/db/avatars';
import { reactToPost, MAX_DISTINCT_REACTIONS, MAX_REACTIONS_PER_USER } from '@/db/queries';
import { useReactionPicker } from '@/composables/useReactionPicker';
import { appToast } from '@/services/toast';
import { attributedReactions } from '@/utils/reaction-groups';
import { ago } from '@/utils/post-time';
import { buildThreads, REPLIES_SHOWN, type Thread } from '@/utils/comment-thread';
import type { PostEngagement } from '@/db/types';

const props = defineProps<{
  postId: string;
  comments: PostEngagement[];
  reactions: PostEngagement[];
  selfId: string;
  postOwnerId: string;
  nameOf: (id: string) => string;
  avatarOf: (id: string) => string;
  canModerate: (comment: PostEngagement) => boolean;
}>();

defineEmits<{
  (e: 'reply', comment: PostEngagement): void;
  (e: 'delete', comment: PostEngagement): void;
}>();

const threads = computed(() => buildThreads(props.comments));
const expanded = ref(new Set<string>());
const audienceComment = ref<PostEngagement | null>(null);
const { openQuick } = useReactionPicker();

function reactionsFor(comment: PostEngagement): PostEngagement[] {
  return props.reactions.filter((r) => r.parent === comment.id && !r.deleted);
}

function groupedFor(comment: PostEngagement): Array<{ emoji: string; count: number; mine: boolean }> {
  const groups = new Map<string, { count: number; mine: boolean }>();
  for (const row of reactionsFor(comment)) {
    if (!row.emoji) continue;
    const current = groups.get(row.emoji) ?? { count: 0, mine: false };
    current.count += 1;
    if (row.actor === props.selfId) current.mine = true;
    groups.set(row.emoji, current);
  }
  return [...groups].map(([emoji, value]) => ({ emoji, ...value }));
}

async function react(comment: PostEngagement, emoji: string): Promise<void> {
  const result = await reactToPost(props.postId, emoji, comment.id);
  if (result === 'limit' || result === 'limit-emojis') {
    await appToast({
      message: result === 'limit-emojis'
        ? `This comment already has ${MAX_DISTINCT_REACTIONS} different reactions.`
        : `You can add up to ${MAX_REACTIONS_PER_USER} reactions.`,
      duration: 1600,
    });
  }
}

async function openReactions(comment: PostEngagement, ev: Event): Promise<void> {
  const rows = groupedFor(comment);
  const maySeePeople = props.selfId === props.postOwnerId || props.selfId === comment.actor;
  if (rows.length && maySeePeople) {
    audienceComment.value = comment;
    return;
  }
  await openQuick(ev, {
    myEmojis: rows.filter((r) => r.mine).map((r) => r.emoji),
    existing: rows.map((r) => r.emoji),
    atEmojiCap: rows.length >= MAX_DISTINCT_REACTIONS,
    onPick: (emoji) => react(comment, emoji),
  });
}

function openAdd(comment: PostEngagement, ev: Event): void {
  const rows = groupedFor(comment);
  void openQuick(ev, {
    myEmojis: rows.filter((r) => r.mine).map((r) => r.emoji),
    existing: rows.map((r) => r.emoji),
    atEmojiCap: rows.length >= MAX_DISTINCT_REACTIONS,
    onPick: (emoji) => react(comment, emoji),
  });
}

const ReactionActions = defineComponent({
  name: 'ReactionActions',
  props: { comment: { type: Object as PropType<PostEngagement>, required: true } },
  setup(componentProps) {
    return () => {
      const groups = groupedFor(componentProps.comment);
      return h('span', { class: 'reaction-actions' }, [
        ...groups.map((group) => h(IonButton, {
          fill: 'clear', size: 'small', class: { mine: group.mine },
          onClick: (ev: Event) => void openReactions(componentProps.comment, ev),
          'aria-label': `${group.count} ${group.emoji} reactions`,
        }, () => [h(Emoji, { emoji: group.emoji }), ` ${group.count}`])),
        h(IonButton, {
          fill: 'clear', size: 'small',
          onClick: (ev: Event) => openAdd(componentProps.comment, ev),
          'aria-label': 'React to comment',
        }, () => '😊+'),
      ]);
    };
  },
});

function visibleReplies(thread: Thread<PostEngagement>): PostEngagement[] {
  return expanded.value.has(thread.comment.id) ? thread.replies : thread.replies.slice(0, REPLIES_SHOWN);
}

function toggleThread(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

const audienceRows = computed(() => {
  const comment = audienceComment.value;
  if (!comment) return [];
  return attributedReactions(
    reactionsFor(comment).map((r) => ({ actor: r.actor, emoji: r.emoji, at: r.at, deleted: r.deleted })),
    props.nameOf,
    (id) => props.avatarOf(id) || initialsAvatar(props.nameOf(id)),
  ).map((row) => ({ ...row, when: ago(row.at) }));
});
</script>

<style scoped>
.comment-group { margin: 0 0 8px; padding: 0; background: transparent; }
.comment-row { --background: var(--ion-item-background); --min-height: 0; align-items: flex-start; }
.reply-row { --padding-start: 28px; }
.avatar { width: 32px; height: 32px; margin-top: 8px; }
.content { margin: 7px 0; }
.meta { display: flex; align-items: baseline; gap: 8px; font-size: 14px; }
.meta span, .answering, .deleted, .empty { color: var(--ion-color-medium); }
.meta span, .answering { font-size: 12px; }
.answering, .text, .deleted { margin: 2px 0 0; white-space: pre-wrap; }
.actions { display: flex; align-items: center; flex-wrap: wrap; margin-inline-start: -10px; }
.actions ion-button { min-height: 28px; margin: 0; font-size: 12px; }
.replies { border-inline-start: 2px solid var(--ion-color-step-150); margin-inline-start: 15px; }
.more { margin-inline-start: 24px; }
.empty { font-size: 14px; }
</style>
