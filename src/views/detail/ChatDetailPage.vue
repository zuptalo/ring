<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <!-- Back button + avatar + name + last-seen all live in slot="start" so
             they form one left-aligned group, with a gap so the chevron can't be
             tapped by mistake. The avatar/name cluster stays hidden during the
             page-push transition and fades in at its resting position once it
             completes (headerReady), WhatsApp-style, so any toolbar reflow while
             the back button + title region settle is never visible. -->
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/chats" text="" />
        </ion-buttons>
        <button
          v-if="chat"
          type="button"
          class="chat-header"
          :class="{ ready: headerReady }"
          slot="start"
          @click="openInfo"
        >
          <ion-avatar class="chat-header-avatar">
            <img :src="chat.avatar" :alt="chat.name" />
          </ion-avatar>
          <span class="chat-header-text">
            <span class="chat-header-name">{{ chat.name }}</span>
            <span v-if="statusLine" class="chat-header-status">{{ statusLine }}</span>
          </span>
        </button>
        <ion-buttons slot="end">
          <ion-button v-if="!peerGhosted && !peerBlocked" aria-label="Video call" @click="startCall('Video')">
            <ion-icon slot="icon-only" :icon="videocamOutline" />
          </ion-button>
          <ion-button v-if="!peerGhosted && !peerBlocked" aria-label="Voice call" @click="startCall('Voice')">
            <ion-icon slot="icon-only" :icon="callOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar v-if="showSearch">
        <ion-searchbar
          :value="search"
          placeholder="Search in conversation"
          show-cancel-button="always"
          @ion-input="search = $event.detail.value ?? ''"
          @ion-cancel="closeSearch"
        />
      </ion-toolbar>
    </ion-header>

    <!-- Natural top→bottom order (oldest at top, newest at bottom). We pin to the
         newest on open/send, stay pinned as media decodes (a ResizeObserver), and
         preserve position when older pages load in at the top. No column-reverse →
         no iOS Safari blank-until-scroll bug. Hidden until the first pin to avoid a
         top→bottom flash on open. -->
    <ion-content ref="contentEl" :fullscreen="true" class="chat-content" :scroll-events="true" @ionScroll="onContentScroll">
      <div ref="listEl" class="msg-list" :style="{ visibility: listReady ? 'visible' : 'hidden' }">
      <!-- Top of the list: pull up to load earlier messages (older pages). -->
      <ion-infinite-scroll
        :disabled="!listReady || visible >= messages.length"
        position="top"
        @ion-infinite="loadOlder"
      >
        <ion-infinite-scroll-content loading-text="Loading earlier messages…" />
      </ion-infinite-scroll>

      <template v-for="(item, i) in renderItems" :key="item.key">
        <!-- Day divider sits ABOVE the first message of each day. -->
        <div v-if="showDay(i)" class="day-sep"><span>{{ dayLabel(itemTime(item)) }}</span></div>
        <!-- A single message. The one-element v-for aliases item.message → m so
             the bubble markup is reused unchanged. -->
        <template v-if="item.kind === 'msg'">
        <template v-for="m in [item.message]" :key="m.id">
        <div class="bubble-row" :class="{ out: m.outgoing }">
          <!-- Group chats: the sender's avatar next to their messages (shown once
               per consecutive run; a spacer keeps continuation bubbles aligned). -->
          <template v-if="chat?.isGroup && !m.outgoing">
            <img
              v-if="groupRunStart(i) && senderAvatar(m.senderId)"
              class="msg-avatar"
              :src="senderAvatar(m.senderId)"
              :alt="m.senderName"
              role="button"
              @click.stop="openSenderProfile(m.senderId)"
            />
            <span v-else class="msg-avatar avatar-spacer" aria-hidden="true" />
          </template>
          <!-- Send failed (3 retries) → a red retry button in front of the bubble. -->
          <button
            v-if="m.status === 'failed'"
            type="button"
            class="retry-btn"
            aria-label="Retry sending"
            @click.stop="retryMediaMessage(m.id)"
          >
            <ion-icon :icon="refreshOutline" />
          </button>
          <div class="bubble-col">
            <div class="swipe-wrap">
              <span class="swipe-ico reply" v-show="swipeId === m.id && swipeDx > 4">
                <ion-icon :icon="arrowUndoOutline" />
              </span>
              <span class="swipe-ico trash" v-show="swipeId === m.id && swipeDx < -4">
                <ion-icon :icon="trashOutline" />
              </span>
            <div
              class="bubble"
              :class="{ out: m.outgoing, 'bubble-plain': m.videoNote && !m.deleted, 'bubble-media': mediaBubble(m) }"
              :data-mid="m.id"
              :style="swipeStyle(m.id)"
              @touchstart.passive="onSwipeStart($event, m)"
              @touchmove="onSwipeMove($event)"
              @touchend.passive="onSwipeEnd()"
              @click="!m.deleted && openMenu(m, $event)"
            >
              <template v-if="m.deleted">
                <span class="text deleted-msg"><ion-icon :icon="banOutline" /> This message was deleted</span>
                <span class="time">{{ formatClock(m.timestamp) }}</span>
              </template>
              <template v-else>
              <!-- Quoted message this is a reply to. -->
              <button
                v-if="m.replyTo"
                type="button"
                class="reply-ref"
                @click.stop="scrollToMessage(m.replyTo.id)"
              >
                <span class="reply-ref-body">
                  <span class="reply-ref-author">{{ replyAuthor(m.replyTo.senderId) }}</span>
                  <span class="reply-ref-text">
                    <ion-icon v-if="replyIcon(m.replyTo)" :icon="replyIcon(m.replyTo)!" class="reply-ico" />{{ m.replyTo.preview }}
                  </span>
                </span>
                <img v-if="m.replyTo.thumb" class="reply-thumb" :src="m.replyTo.thumb" alt="" />
              </button>

              <span
                v-if="chat?.isGroup && !m.outgoing && groupRunStart(i)"
                class="sender"
                role="button"
                :style="{ color: userColorBright(m.senderId, colorMembers) }"
                @click.stop="openSenderProfile(m.senderId)"
                >{{ m.senderName }}</span
              >

              <template v-if="m.mediaId && mediaInfo[m.mediaId]">
                <div v-if="m.kind === 'image'" class="media-wrap" @click.stop="openMediaViewer(m.id)">
                  <img class="bubble-image" :src="mediaInfo[m.mediaId].url" alt="photo" />
                  <span v-if="mediaMetaLabel(m)" class="video-meta">{{ mediaMetaLabel(m) }}</span>
                </div>
                <!-- Round video note: plays inline on tap, long-press for actions. -->
                <video-note
                  v-else-if="m.kind === 'video' && m.videoNote"
                  :src="mediaInfo[m.mediaId].url"
                  :poster="mediaInfo[m.mediaId].posterUrl"
                  :duration-sec="m.durationSec"
                  @menu="(ev) => openMenu(m, ev)"
                />
                <!-- Video: a still thumbnail with a play button; tapping opens the
                     full-screen viewer (falls back to inline if no thumbnail). -->
                <template v-else-if="m.kind === 'video'">
                  <div class="video-poster" @click.stop="openMediaViewer(m.id)">
                    <img
                      v-if="m.posterData || mediaInfo[m.mediaId].posterUrl"
                      class="bubble-image"
                      :src="m.posterData || mediaInfo[m.mediaId].posterUrl"
                      alt="video"
                    />
                    <div v-else class="bubble-image video-noposter" />
                    <ion-icon class="play-overlay" :icon="playCircle" />
                    <span v-if="mediaMetaLabel(m)" class="video-meta">{{ mediaMetaLabel(m) }}</span>
                  </div>
                </template>
                <voice-player
                  v-else-if="m.kind === 'voice'"
                  :src="mediaInfo[m.mediaId].url"
                  :outgoing="m.outgoing"
                  :avatar="!m.outgoing && !chat?.isGroup ? chat?.avatar : undefined"
                  :duration-sec="m.durationSec"
                />
                <!-- Shared audio file (music): track card with cover/title/artist. -->
                <audio-card
                  v-else-if="m.kind === 'audio'"
                  :title="m.audio?.title || mediaInfo[m.mediaId].name"
                  :artist="m.audio?.artist"
                  :duration-sec="m.durationSec"
                  :cover-url="mediaInfo[m.mediaId].posterUrl"
                  :active="audioCurId === m.id"
                  :playing="audioCurId === m.id && audioPlaying"
                  :progress="audioCurId === m.id ? audioProgress : 0"
                  @toggle="toggleAudio(m.id)"
                  @seek="(f) => seekAudio(m.id, f)"
                />
                <a
                  v-else-if="m.kind === 'file'"
                  class="file-chip"
                  :href="mediaInfo[m.mediaId].url"
                  :download="mediaInfo[m.mediaId].name"
                  @click.stop
                >
                  <ion-icon :icon="documentOutline" />
                  <span>{{ mediaInfo[m.mediaId].name }}</span>
                </a>
              </template>

              <!-- Video not downloaded yet: the sent thumbnail + a download button
                   (auto-download is off, or it's a manual fetch). -->
              <div
                v-if="m.kind === 'video' && !m.videoNote && !m.mediaId && m.pendingMedia"
                class="video-poster pending"
                @click.stop="downloadVideo(m.id)"
              >
                <img v-if="m.posterData" class="bubble-image" :src="m.posterData" alt="video" />
                <div v-else class="bubble-image video-noposter" />
                <span class="dl-btn">
                  <ion-spinner v-if="downloadingVideo[m.id]" name="crescent" />
                  <ion-icon v-else :icon="downloadOutline" />
                </span>
                <span v-if="mediaMetaLabel(m)" class="video-meta">{{ mediaMetaLabel(m) }}</span>
              </div>

              <!-- Media removed from THIS device to free space: a placeholder so the
                   chat still shows something was here (distinct from a sender-deleted
                   message, and from a not-yet-downloaded one). -->
              <div v-if="mediaCleared(m)" class="media-cleared" @click.stop>
                <ion-icon :icon="clearedIcon(m.kind)" />
                <span>{{ clearedLabel(m) }} removed to free space</span>
              </div>

              <!-- Location / poll / shared-contact cards. -->
              <location-bubble v-if="m.kind === 'location' && m.location" :loc="m.location" />
              <poll-bubble
                v-else-if="m.kind === 'poll' && m.poll"
                :poll="m.poll"
                :me="selfId"
                @vote="(opt) => votePoll(m.id, opt)"
              />
              <contact-bubble
                v-else-if="m.kind === 'contact' && m.contact"
                :contact="m.contact"
                @message="openSharedContact(m.contact)"
              />

              <!-- Link card (privacy-safe: domain + icon, no remote fetch). -->
              <a
                v-if="m.kind === 'text' && hasLink(m.body)"
                class="link-card"
                :href="linkOf(m.body)"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop.prevent="openExternal(linkOf(m.body))"
              >
                <span class="link-thumb"><ion-icon :icon="globeOutline" /></span>
                <span class="link-meta">
                  <span class="link-domain">{{ linkDomain(m.body) }}</span>
                  <span class="link-url">{{ linkOf(m.body) }}</span>
                </span>
              </a>
              <span v-if="m.body" class="text" :class="{ 'emoji-only': emojiBig(m.body) }"><template
                v-for="(p, pi) in bodyParts(m.body)"
                :key="pi"
              ><a
                  v-if="p.url"
                  class="msg-link"
                  :href="p.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  @click.stop.prevent="openExternal(p.url)"
                >{{ p.text }}</a><animated-emoji
                  v-else-if="p.emoji"
                  :emoji="p.emoji"
                  :animate="animEmoji"
                  :large="emojiBig(m.body)"
                /><template v-else>{{ p.text }}</template></template></span>
              <!-- Background job: separate encode + upload progress bars. -->
              <div v-if="m.status === 'compressing'" class="job-progress">
                <div v-if="m.mediaQuality && m.mediaQuality !== 'original'" class="job-row">
                  <span class="job-label">Encoding</span>
                  <span class="job-track"><span class="job-fill" :style="{ width: jobPct(m.id, 'compress') }" /></span>
                  <span class="job-num">{{ jobPct(m.id, 'compress') }}</span>
                </div>
                <div class="job-row">
                  <span class="job-label">Uploading</span>
                  <span class="job-track"><span class="job-fill" :style="{ width: jobPct(m.id, 'upload') }" /></span>
                  <span class="job-num">{{ jobPct(m.id, 'upload') }}</span>
                </div>
              </div>
              <span class="time">
                {{ formatClock(m.sentAt ?? m.timestamp) }}
                <ion-icon
                  v-if="m.outgoing && m.status !== 'failed'"
                  class="tick"
                  :class="{ read: m.status === 'read' }"
                  :icon="statusIcon(m.status)"
                />
              </span>
              </template>
            </div>
            </div>

            <!-- Reactions straddle the bubble's bottom edge (mostly hanging
                 below); normal flow then reserves their space so the next
                 message keeps a regular gap. -->
            <div v-if="m.reactions?.length" class="reactions">
              <button
                v-for="g in groupedReactions(m.reactions)"
                :key="g.emoji"
                type="button"
                class="reaction"
                :class="{ mine: g.mine }"
                @click.stop="reactToMessage(m.id, g.emoji)"
              >
                <span class="r-emoji"><emoji :emoji="g.emoji" /></span>
                <span v-if="g.count > 1" class="r-count">{{ g.count }}</span>
              </button>
            </div>
          </div>
          <!-- Quick forward for incoming media / files / links. -->
          <button
            v-if="forwardable(m)"
            type="button"
            class="fwd-float"
            aria-label="Forward"
            @click.stop="openForward(m.id)"
          >
            <ion-icon :icon="arrowRedoOutline" />
          </button>
        </div>
        </template>
        </template>

        <!-- An album: media sent together, shown as a grid (up to 4, +N more).
             Tapping outside a cell reacts to the album as a whole. -->
        <div v-else class="bubble-row" :class="{ out: item.messages[0].outgoing }">
          <div class="bubble-col">
            <div class="swipe-wrap">
            <span class="swipe-ico reply" v-show="swipeId === item.messages[0].id && swipeDx > 4">
              <ion-icon :icon="arrowUndoOutline" />
            </span>
            <span class="swipe-ico trash" v-show="swipeId === item.messages[0].id && swipeDx < -4">
              <ion-icon :icon="trashOutline" />
            </span>
            <div
              v-if="item.messages.every((mm) => mm.deleted)"
              class="bubble"
              :class="{ out: item.messages[0].outgoing }"
            >
              <span class="text deleted-msg"><ion-icon :icon="banOutline" /> This message was deleted</span>
              <span class="time">{{ formatClock(item.messages[item.messages.length - 1].timestamp) }}</span>
            </div>
            <div
              v-else
              class="bubble album-bubble"
              :class="{ out: item.messages[0].outgoing }"
              :data-mid="item.messages[0].id"
              :style="swipeStyle(item.messages[0].id)"
              @touchstart.passive="onSwipeStart($event, item.messages[0])"
              @touchmove="onSwipeMove($event)"
              @touchend.passive="onSwipeEnd()"
              @click="openMenu(item.messages[0], $event)"
            >
              <button
                v-if="item.messages[0].replyTo"
                type="button"
                class="reply-ref"
                @click.stop="scrollToMessage(item.messages[0].replyTo.id)"
              >
                <span class="reply-ref-body">
                  <span class="reply-ref-author">{{ replyAuthor(item.messages[0].replyTo.senderId) }}</span>
                  <span class="reply-ref-text">
                    <ion-icon v-if="replyIcon(item.messages[0].replyTo)" :icon="replyIcon(item.messages[0].replyTo)!" class="reply-ico" />{{ item.messages[0].replyTo.preview }}
                  </span>
                </span>
                <img v-if="item.messages[0].replyTo.thumb" class="reply-thumb" :src="item.messages[0].replyTo.thumb" alt="" />
              </button>
              <span v-if="item.messages[0].albumName" class="album-name">{{ item.messages[0].albumName }}</span>
              <div class="album-grid">
                <button
                  v-for="(am, idx) in albumCells(item.messages)"
                  :key="am.id"
                  type="button"
                  class="album-cell"
                  @click.stop="openMediaViewer(am.id)"
                >
                  <template v-if="am.mediaId && mediaInfo[am.mediaId]">
                    <img :src="mediaInfo[am.mediaId].posterUrl || mediaInfo[am.mediaId].url" alt="" />
                    <ion-icon v-if="am.kind === 'video'" class="play-overlay-sm" :icon="playCircle" />
                    <div v-if="idx === 3 && albumOverlay(item.messages)" class="album-more">
                      +{{ albumOverlay(item.messages) }}
                    </div>
                  </template>
                </button>
              </div>
              <span class="time">
                {{ formatClock(item.messages[item.messages.length - 1].timestamp) }}
                <ion-icon
                  v-if="item.messages[0].outgoing"
                  class="tick"
                  :class="{ read: item.messages[item.messages.length - 1].status === 'read' }"
                  :icon="statusIcon(item.messages[item.messages.length - 1].status)"
                />
              </span>
            </div>
            </div>

            <!-- Album-as-a-whole reactions (carried on its first message). -->
            <div v-if="item.messages[0].reactions?.length" class="reactions">
              <button
                v-for="g in groupedReactions(item.messages[0].reactions)"
                :key="g.emoji"
                type="button"
                class="reaction"
                :class="{ mine: g.mine }"
                @click.stop="reactToMessage(item.messages[0].id, g.emoji)"
              >
                <span class="r-emoji"><emoji :emoji="g.emoji" /></span>
                <span v-if="g.count > 1" class="r-count">{{ g.count }}</span>
              </button>
            </div>
          </div>
          <button
            v-if="!item.messages[0].outgoing && !item.messages.every((mm) => mm.deleted)"
            type="button"
            class="fwd-float"
            aria-label="Forward"
            @click.stop="openForward(item.messages[0].id)"
          >
            <ion-icon :icon="arrowRedoOutline" />
          </button>
        </div>

      </template>

      <div v-if="messages.length === 0" class="empty">
        <ion-note>{{ search ? 'No matching messages' : 'No messages yet' }}</ion-note>
      </div>
      </div>
    </ion-content>

    <ion-footer id="chat-footer">
      <!-- Reply preview: the message being replied to, with a cancel button. -->
      <ion-toolbar v-if="replyingTo && !chat?.pending" class="reply-bar">
        <div class="reply-preview">
          <img v-if="replyingTo.thumb" class="reply-thumb" :src="replyingTo.thumb" alt="" />
          <div class="reply-quote">
            <span class="reply-ref-author">{{ replyAuthor(replyingTo.senderId) }}</span>
            <span class="reply-ref-text">
              <ion-icon v-if="replyIcon(replyingTo)" :icon="replyIcon(replyingTo)!" class="reply-ico" />{{ replyingTo.preview }}
            </span>
          </div>
          <ion-button fill="clear" aria-label="Cancel reply" @click="replyingTo = null">
            <ion-icon slot="icon-only" :icon="closeOutline" />
          </ion-button>
        </div>
      </ion-toolbar>
      <!-- A still-pending (un-accepted) friend request: lock the composer until
           the other side accepts. -->
      <ion-toolbar v-if="chat?.pending">
        <div class="pending-note">
          <ion-icon :icon="timeOutline" />
          <span>Waiting for your friend request to be accepted</span>
        </div>
      </ion-toolbar>
      <!-- The peer deleted their account: read-only, history kept intact. -->
      <ion-toolbar v-else-if="peerGhosted">
        <div class="pending-note">
          <ion-icon :icon="banOutline" />
          <span>This account no longer exists, you can't send messages.</span>
        </div>
      </ion-toolbar>
      <!-- We've blocked this contact: read-only until unblocked. -->
      <ion-toolbar v-else-if="peerBlocked">
        <div class="pending-note">
          <ion-icon :icon="banOutline" />
          <span>You blocked this contact.</span>
          <ion-button fill="clear" size="small" @click="onUnblock">Unblock</ion-button>
        </div>
      </ion-toolbar>
      <ion-toolbar v-else>
        <!-- Recording mode: delete · live waveform + timer · pause/resume · send -->
        <template v-if="recording">
          <ion-buttons slot="start">
            <ion-button color="danger" aria-label="Delete recording" @click="cancelRecording">
              <ion-icon slot="icon-only" :icon="trashOutline" />
            </ion-button>
          </ion-buttons>
          <div class="rec-status">
            <span class="rec-dot" :class="{ paused: recPaused }"></span>
            <div class="rec-wave">
              <span
                v-for="(h, i) in recBars"
                :key="i"
                class="rec-bar"
                :style="{ height: barH(h) }"
              />
            </div>
            <span class="rec-time">{{ recElapsed }}</span>
          </div>
          <ion-buttons slot="end">
            <ion-button :aria-label="recPaused ? 'Resume' : 'Pause'" @click="togglePause">
              <ion-icon slot="icon-only" :icon="recPaused ? micOutline : pause" />
            </ion-button>
            <ion-button color="primary" aria-label="Send recording" @click="stopAndSendRecording">
              <ion-icon slot="icon-only" :icon="sendOutline" />
            </ion-button>
          </ion-buttons>
        </template>

        <!-- Normal mode -->
        <template v-else>
          <ion-buttons slot="start">
            <ion-button @click="openAttach">
              <ion-icon slot="icon-only" :icon="addOutline" />
            </ion-button>
          </ion-buttons>
          <!-- Auto-growing multi-line textarea so long messages wrap and the box
               grows (capped in CSS, then scrolls). autocapitalize/autocorrect/
               spellcheck on → the OS keyboard offers predictive text & suggestions.
               The Return key inserts a line break; send with the send button. -->
          <ion-textarea
            ref="composerEl"
            class="composer"
            :value="draft"
            placeholder="Message"
            :auto-grow="true"
            :rows="1"
            autocapitalize="sentences"
            autocorrect="on"
            :spellcheck="true"
            enterkeyhint="enter"
            @ion-input="onComposerInput"
            @keydown.enter="onComposerEnter"
          />
          <ion-buttons slot="end">
            <ion-button
              v-if="draft.trim()"
              color="primary"
              @click="send"
              @pointerdown.prevent
            >
              <ion-icon slot="icon-only" :icon="sendOutline" />
            </ion-button>
            <template v-else>
              <!-- Tap = camera; hold ~0.6s = round video note. -->
              <ion-button
                aria-label="Camera"
                @pointerdown="camDown"
                @pointerup="camUp"
                @pointerleave="camCancel"
              >
                <ion-icon slot="icon-only" :icon="cameraOutline" />
              </ion-button>
              <ion-button color="primary" aria-label="Record voice" @click="startRecording">
                <ion-icon slot="icon-only" :icon="micOutline" />
              </ion-button>
            </template>
          </ion-buttons>
        </template>
      </ion-toolbar>

      <!-- Hidden pickers driven by the composer / attach sheet -->
      <input ref="cameraInput" type="file" accept="image/*,video/*" capture="environment" hidden @change="onPick($event, 'auto')" />
      <!-- Universal picker: on iOS this surfaces Photo Library / Take Photo or
           Video / Choose Files. Each file's kind is detected from its mime. -->
      <input ref="photoInput" type="file" multiple hidden @change="onPick($event, 'auto')" />
    </ion-footer>

    <!-- Full emoji picker (the "+" in the reaction popover). The <emoji-picker>
         web component is created imperatively into this host (see mountPicker). -->
    <ion-modal
      :is-open="pickerOpen"
      :initial-breakpoint="0.85"
      :breakpoints="[0, 0.85, 1]"
      @did-present="mountPicker"
      @did-dismiss="closePicker"
    >
      <ion-content>
        <div ref="pickerHost" class="picker-host"></div>
      </ion-content>
    </ion-modal>

    <!-- Full-screen album viewer -->
    <media-viewer
      :open="viewer.open"
      :items="viewerItems"
      :start="viewer.start"
      @close="viewer.open = false"
      @dismiss="onViewerDismiss"
      @react="onViewerReact"
      @reply="onViewerReply"
      @favorite="onViewerFavorite"
      @del="onViewerDelete"
      @share="onViewerShare"
      @caption="onViewerCaption"
      @goto="onViewerGoto"
      @allmedia="onViewerAllMedia"
    />

    <!-- Round video-note recorder (hold the camera button) -->
    <video-note-recorder
      :open="videoNoteOpen"
      @send="onVideoNoteSend"
      @cancel="videoNoteOpen = false"
    />

    <!-- Forward a message/media to other chats -->
    <forward-picker :open="forwardOpen" @send="onForwardSend" @close="forwardOpen = false" />

    <!-- Poll composer + contact picker + location composer (from the + sheet) -->
    <poll-composer :open="pollOpen" @create="onPollCreate" @close="pollOpen = false" />
    <location-composer :open="locationOpen" @send="onLocationSend" @close="locationOpen = false" />
    <audio-review
      :open="audioReview.open"
      :initial-title="audioReview.title"
      :initial-artist="audioReview.artist"
      :cover-url="audioReview.coverUrl"
      :duration-sec="audioReview.durationSec"
      @send="onAudioReviewSend"
      @close="onAudioReviewClose"
    />
    <contact-picker
      :open="contactPickerOpen"
      :contacts="contacts"
      @select="onContactSelect"
      @close="contactPickerOpen = false"
    />
  </ion-page>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonButtons, IonButton,
  IonBackButton, IonIcon, IonSearchbar, IonContent, IonFooter, IonTextarea,
  IonAvatar, IonNote, IonModal, IonSpinner, actionSheetController, alertController, popoverController, toastController,
  IonInfiniteScroll, IonInfiniteScrollContent,
  onIonViewWillEnter, onIonViewDidEnter, onIonViewWillLeave,
} from '@ionic/vue';
import type { InfiniteScrollCustomEvent } from '@ionic/vue';
import {
  callOutline, videocamOutline, documentOutline, playCircle, sendOutline,
  timeOutline, checkmark, checkmarkDone, addOutline, cameraOutline,
  micOutline, trashOutline, closeOutline, pause, banOutline, arrowRedoOutline, arrowUndoOutline, globeOutline,
  locationOutline, barChartOutline, personOutline, refreshOutline, downloadOutline,
  imageOutline, musicalNotesOutline,
} from 'ionicons/icons';
import {
  getChat, getContact, listContacts, listMessages, markChatRead, sendMediaMessage, sendMessage,
  reactToMessage, deleteMessage, softDeleteMessage, toggleFavorite, setCaption, forwardMessage,
  quickReactEmojis,
  retryMediaMessage, resumePendingMediaJobs, downloadMessageMedia,
  sendLocation, sendPoll, sendContact, votePoll, messageSharedContact,
  unblockContact, detectTerminated,
} from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import MessageActions from '@/components/MessageActions.vue';
import ReactionDetails from '@/components/ReactionDetails.vue';
import VoicePlayer from '@/components/VoicePlayer.vue';
import VideoNote from '@/components/VideoNote.vue';
import VideoNoteRecorder from '@/components/VideoNoteRecorder.vue';
import MediaViewer from '@/components/MediaViewer.vue';
import ForwardPicker from '@/components/ForwardPicker.vue';
import LocationBubble from '@/components/LocationBubble.vue';
import PollBubble from '@/components/PollBubble.vue';
import ContactBubble from '@/components/ContactBubble.vue';
import PollComposer from '@/components/PollComposer.vue';
import ContactPicker from '@/components/ContactPicker.vue';
import LocationComposer from '@/components/LocationComposer.vue';
import AudioCard from '@/components/AudioCard.vue';
import AudioReview from '@/components/AudioReview.vue';
import Emoji from '@/components/Emoji.vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import { segmentEmoji, emojiOnlyCount } from '@/utils/emoji';
import { userColorBright } from '@/utils/user-color';
import { useAnimationPrefs } from '@/composables/useAnimationPrefs';
import { type Quality } from '@/services/media-encode';
import { jobProgress } from '@/services/media-jobs';
import { resolutionLabel, fileSizeLabel, generateVideoPoster } from '@/utils/media-meta';
import { openExternal } from '@/utils/external';
import { readAudioTags, readAudioDuration } from '@/utils/id3';
import { get, put } from '@/db/idb';
import type { Chat, Contact, Media, Message, MessageStatus, Reaction, ReplyRef, SharedContact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { isUnlocked, isUnlockedNow } from '@/services/crypto/identity';
import { sendReadReceipts } from '@/composables/useSync';
import { peerPresence, presenceLabel } from '@/composables/usePresence';
import { startDirectCall, startGroupCall } from '@/composables/useCall';
import { ensureProfile } from '@/composables/useProfileGate';
import { setActiveChat } from '@/services/notify';
import { formatClock, dayLabel, sameDay, formatStamp, formatFull } from '@/utils/time';

const route = useRoute();
const router = useRouter();
const chatId = route.params.id as string;

// Online / last-seen line under the contact name (1:1 only; '' when unknown).
const statusLine = computed(() => {
  const c = chat.value;
  if (!c || c.isGroup) return '';
  const peer = c.participantIds[0];
  return peer ? presenceLabel(peerPresence(peer)) : '';
});

// Tapping the header avatar/name opens the info sub-page: group info for groups,
// contact info for 1:1 (where conversation search and "share my info" live).
function openInfo() {
  const c = chat.value;
  if (!c) return;
  if (c.isGroup) {
    router.push(`/group/${c.id}`);
    return;
  }
  const peer = c.participantIds[0];
  if (peer) router.push(`/contact/${peer}`);
}

// Tapping a group message's sender name opens that person's profile (shows their
// @username, About, and a Message action).
function openSenderProfile(senderId: string): void {
  if (senderId && senderId !== 'me') router.push(`/contact/${senderId}`);
}

// Place a voice/video call: 1:1 (direct P2P) or, for a group chat, a group call
// joining the SFU room keyed by the chat id.
async function startCall(kind: 'Voice' | 'Video') {
  const c = chat.value;
  if (!c) return;
  const k = kind === 'Video' ? 'video' : 'audio';
  if (c.isGroup) {
    // Pass the members so the server rings the rest of the group (it has no group object).
    await startGroupCall(c.id, k, c.name, c.avatar, c.participantIds);
    return;
  }
  const peer = c.participantIds[0];
  if (peer) await startDirectCall(peer, k);
}

// Blocking now lives in the Chat Info hub (Contact info), reached by tapping the
// name/avatar - the header overflow menu was removed. Unblock stays as a shortcut on
// the blocked-state notice toolbar below, where the user is already looking at it.
async function onUnblock() {
  const pid = peerId.value;
  if (!pid) return;
  try {
    await unblockContact(pid);
  } catch {
    const t = await toastController.create({ message: 'Could not unblock. Try again.', duration: 1500, color: 'danger' });
    await t.present();
  }
}

function closeSearch() {
  showSearch.value = false;
  search.value = '';
}

// Fetch a deferred (not-yet-downloaded) video's full clip on tap.
const downloadingVideo = reactive<Record<string, boolean>>({});
async function downloadVideo(id: string): Promise<void> {
  if (downloadingVideo[id]) return;
  downloadingVideo[id] = true;
  try {
    await downloadMessageMedia(id);
  } catch {
    /* leave it pending so the user can tap again */
  } finally {
    delete downloadingVideo[id];
  }
}

// Badge on a photo/video bubble (same facts both sides), e.g. for a video
// "HD · 720p · 0:34 · 4.2 MB", for a photo "HD · 1.2 MB".
const QUALITY_LABEL: Record<string, string> = { sd: 'SD', hd: 'HD', original: 'Original' };
function mediaMetaLabel(m: Message): string {
  const parts: string[] = [];
  if (m.mediaQuality) parts.push(QUALITY_LABEL[m.mediaQuality] ?? '');
  if (m.kind === 'video') {
    const res = resolutionLabel(m.mediaWidth, m.mediaHeight);
    if (res) parts.push(res);
    if (m.durationSec) {
      const t = Math.round(m.durationSec);
      parts.push(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    }
  } else if (m.kind === 'image' && m.mediaWidth && m.mediaHeight) {
    parts.push(`${m.mediaWidth}×${m.mediaHeight}`);
  }
  const size = fileSizeLabel(m.mediaSize);
  if (size) parts.push(size);
  return parts.filter(Boolean).join(' · ');
}

// Encode / upload progress as a "42%" string for the in-flight bars.
function jobPct(id: string, phase: 'compress' | 'upload'): string {
  return `${Math.round((jobProgress[id]?.[phase] ?? 0) * 100)}%`;
}

function statusIcon(status: MessageStatus) {
  if (status === 'compressing' || status === 'pending') return timeOutline;
  if (status === 'sent') return checkmark;
  return checkmarkDone; // delivered & read
}

const selfId = getSelfUserId() ?? '';
// A viewer-independent, stable ordering for per-member name colors: include self and
// sort by id, so the same sender gets the same color on EVERY member's device, and a
// roster change can't reshuffle everyone's colors (participantIds is per-device and is
// mutated/reordered on add/remove).
const colorMembers = computed(() =>
  [...new Set([selfId, ...(chat.value?.participantIds ?? [])])].sort(),
);
const { animEmoji } = useAnimationPrefs();

// Reactions grouped by emoji for display: emoji, count, and whether it's mine.
function groupedReactions(reactions: Reaction[] | undefined) {
  const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of reactions ?? []) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (r.userId === selfId) g.mine = true;
    map.set(r.emoji, g);
  }
  return [...map.values()];
}
const myEmoji = (m: Message) => (m.reactions ?? []).find((r) => r.userId === selfId)?.emoji;

// Whether an item starts a new day (the divider renders above it). True for the
// oldest loaded item too.
function showDay(i: number): boolean {
  const cur = renderItems.value[i];
  const prev = renderItems.value[i - 1];
  return !!cur && (!prev || !sameDay(itemTime(cur), itemTime(prev)));
}

/* ---- media viewer (over ALL the chat's media) ---- */
// Every image/video in the chat, chronological. The viewer shows them all and
// starts at whichever one was tapped (in a bubble or an album).
const chatMediaMsgs = computed(() =>
  messages.value.filter(
    (m) =>
      (m.kind === 'image' || (m.kind === 'video' && !m.videoNote)) &&
      m.mediaId &&
      mediaInfo.value[m.mediaId!],
  ),
);
const viewer = ref<{ open: boolean; start: number }>({ open: false, start: 0 });
const viewerItems = computed(() =>
  chatMediaMsgs.value.map((m) => {
    const mi = mediaInfo.value[m.mediaId!];
    return {
      id: m.id,
      url: mi.url,
      thumb: mi.posterUrl || mi.url,
      kind: mi.mime.startsWith('video/') ? 'video' : 'image',
      caption: m.body,
      senderName: m.outgoing ? 'You' : chat.value?.isGroup ? m.senderName : chat.value?.name ?? m.senderName,
      when: formatFull(m.timestamp),
      outgoing: m.outgoing,
      favorite: !!m.favorite,
      reactions: groupedReactions(m.reactions).map((g) => ({ emoji: g.emoji, count: g.count })),
    };
  }),
);
// Tapping any media opens the viewer at that item, across all chat media.
function openMediaViewer(msgId: string): void {
  const start = chatMediaMsgs.value.findIndex((m) => m.id === msgId);
  viewer.value = { open: true, start: Math.max(0, start) };
}
function onViewerDismiss(id: string): void {
  viewer.value.open = false;
  // Album members render under one bubble keyed by the first message's id.
  const m = messages.value.find((x) => x.id === id);
  let target = id;
  if (m?.albumId) {
    const first = messages.value
      .filter((x) => x.albumId === m.albumId)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    if (first) target = first.id;
  }
  void nextTick(() => scrollToMessage(target));
}

const viewerMsg = (id: string) => messages.value.find((m) => m.id === id);
function onViewerReact(id: string, emoji: string): void {
  void reactToMessage(id, emoji);
}
function onViewerReply(id: string): void {
  const m = viewerMsg(id);
  if (m) void startReply(m);
  viewer.value.open = false;
}
function onViewerFavorite(id: string): void {
  void toggleFavorite(id);
}
async function onViewerDelete(id: string): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Delete this media?',
    buttons: [
      { text: 'Delete', role: 'destructive', handler: () => void deleteMessage(id) },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}
function onViewerShare(id: string): void {
  viewer.value.open = false;
  openForward(id);
}
async function onViewerCaption(id: string): Promise<void> {
  const m = viewerMsg(id);
  const alert = await alertController.create({
    header: 'Caption',
    inputs: [{ name: 'cap', type: 'textarea', value: m?.body ?? '', placeholder: 'Add a caption' }],
    buttons: [
      { text: 'Cancel', role: 'cancel' as const },
      { text: 'Save', handler: (d: { cap?: string }) => void setCaption(id, (d?.cap ?? '').trim()) },
    ],
  });
  await alert.present();
}
function onViewerGoto(id: string): void {
  viewer.value.open = false;
  void nextTick(() => scrollToMessage(id));
}
function onViewerAllMedia(): void {
  viewer.value.open = false;
  router.push(`/chat/${chatId}/media`);
}

// Tapping a bubble opens the unified popover (emoji quick-row + actions) anchored
// to it. It opens downward when the bubble is in the top half of the screen and
// upward in the bottom half, so the menu stays on screen.
async function openMenu(m: Message, ev: Event) {
  const y = (ev as MouseEvent).clientY ?? window.innerHeight;
  const side = y < window.innerHeight / 2 ? 'bottom' : 'top';
  const popover = await popoverController.create({
    component: MessageActions,
    cssClass: 'reaction-popover',
    componentProps: {
      isOutgoing: m.outgoing,
      canCopy: !!m.body,
      myEmoji: myEmoji(m),
      reactionCount: m.reactions?.length ?? 0,
      quick: await quickReactEmojis(),
    },
    event: ev,
    reference: 'event',
    side,
    alignment: 'center',
  });
  await popover.present();
  const { data } = await popover.onWillDismiss();
  if (!data) return;
  if (data.action === 'react') await reactToMessage(m.id, data.emoji);
  else if (data.action === 'more') await openEmojiPicker(m);
  else if (data.action === 'details') await openReactionDetails(m);
  else if (data.action === 'reply') void startReply(m);
  else if (data.action === 'forward') openForward(m.id);
  else if (data.action === 'info') router.push(`/chat/${chatId}/info/${m.id}`);
  else if (data.action === 'copy') navigator.clipboard?.writeText(m.body).catch(() => {});
}

/* ---- forwarding ---- */
const LINK_RE = /\bhttps?:\/\/[^\s]+/i;
const hasLink = (s: string) => LINK_RE.test(s);
const linkOf = (s: string) => s.match(LINK_RE)?.[0] ?? '';
const linkDomain = (s: string) => {
  try {
    return new URL(linkOf(s)).hostname.replace(/^www\./, '');
  } catch {
    return linkOf(s);
  }
};
// Split body text into plain runs and clickable URL runs (to linkify messages).
// Split a body into render segments: links, emoji (Noto-animated), and text.
function bodyParts(body: string): Array<{ text?: string; url?: string; emoji?: string }> {
  const out: Array<{ text?: string; url?: string; emoji?: string }> = [];
  for (const p of linkParts(body)) {
    if (p.url) {
      out.push({ text: p.text, url: p.url });
      continue;
    }
    for (const seg of segmentEmoji(p.text ?? '')) {
      if (seg.emoji) out.push({ emoji: seg.emoji });
      else if (seg.text) out.push({ text: seg.text });
    }
  }
  return out;
}
// An all-emoji message of up to 3 emoji renders larger.
function emojiBig(body: string): boolean {
  const n = emojiOnlyCount(body);
  return n > 0 && n <= 3;
}

function linkParts(body: string): Array<{ text: string; url?: string }> {
  const parts: Array<{ text: string; url?: string }> = [];
  const re = /\bhttps?:\/\/[^\s]+/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ text: m[0], url: m[0] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}
// A bubble whose main content is a single photo/video → render with a thin frame
// (narrow padding) hugging the media, rather than the normal text padding.
const mediaBubble = (m: Message) =>
  !m.deleted && !!m.mediaId && (m.kind === 'image' || (m.kind === 'video' && !m.videoNote));

// A media message whose blob was cleaned up locally to free space (not the same as
// a sender-deleted message, nor a not-yet-downloaded one) → show a placeholder.
const mediaCleared = (m: Message): boolean =>
  !!m.mediaCleared && !m.mediaId && !m.pendingMedia && !m.deleted;
function clearedLabel(m: Message): string {
  switch (m.kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return m.videoNote ? 'Video note' : 'Video';
    case 'voice':
      return 'Voice message';
    case 'audio':
      return 'Audio';
    case 'file':
      return 'Document';
    default:
      return 'Media';
  }
}
function clearedIcon(kind: string): string {
  switch (kind) {
    case 'image':
      return imageOutline;
    case 'video':
      return videocamOutline;
    case 'voice':
      return micOutline;
    case 'audio':
      return musicalNotesOutline;
    default:
      return documentOutline;
  }
}
// Incoming media / file / link → show a quick floating forward button beside it.
// (Media must be downloaded; a deferred video has no blob to forward yet.)
const forwardable = (m: Message) =>
  !m.outgoing &&
  !m.deleted &&
  (((m.kind === 'image' || m.kind === 'video' || m.kind === 'file') && !!m.mediaId) ||
    (m.kind === 'text' && hasLink(m.body)));

const forwardOpen = ref(false);
const forwardId = ref<string | null>(null);
function openForward(id: string): void {
  forwardId.value = id;
  forwardOpen.value = true;
}
async function onForwardSend(chatIds: string[]): Promise<void> {
  forwardOpen.value = false;
  if (forwardId.value && chatIds.length) await forwardMessage(forwardId.value, chatIds);
  forwardId.value = null;
  const t = await toastController.create({ message: 'Forwarded', duration: 1200, position: 'bottom' });
  await t.present();
}

/* ---- reply ---- */
const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
const contactsMap = computed(() => new Map(contacts.value.map((c) => [c.id, c])));
const replyingTo = ref<ReplyRef | null>(null);
const composerEl = ref<{ $el: HTMLIonTextareaElement } | null>(null);

// A short text snapshot of a message for the quote (the media icon is rendered
// separately from `replyTo.kind`, so these labels carry no emoji).
function previewOf(m: Message): string {
  if (m.body) return m.body;
  if (m.kind === 'image') return 'Photo';
  if (m.kind === 'video') return m.videoNote ? 'Video note' : 'Video';
  if (m.kind === 'voice') return 'Voice message';
  if (m.kind === 'file') {
    const name = m.mediaId ? mediaInfo.value[m.mediaId]?.name : undefined;
    return name && name !== 'attachment' ? name : 'Document';
  }
  if (m.kind === 'location') return m.location?.label || 'Location';
  if (m.kind === 'poll') return m.poll?.question || 'Poll';
  if (m.kind === 'contact') return m.contact?.name || 'Contact';
  return 'Message';
}

// Ionic icon for a quoted media message (none for plain text).
function replyIcon(r: ReplyRef): string | null {
  if (r.kind === 'image') return cameraOutline;
  if (r.kind === 'video') return videocamOutline;
  if (r.kind === 'voice') return micOutline;
  if (r.kind === 'file') return documentOutline;
  if (r.kind === 'location') return locationOutline;
  if (r.kind === 'poll') return barChartOutline;
  if (r.kind === 'contact') return personOutline;
  return null;
}

// Author label for a quote, resolved per-viewer: "You" for self, else the
// contact's name (outgoing messages use the real self id, not 'me').
function replyAuthor(senderId: string): string {
  if (senderId === selfId) return 'You';
  return contactsMap.value.get(senderId)?.name ?? chat.value?.name ?? 'Unknown';
}

// A group sender's avatar (data-URL), looked up from contacts by id.
function senderAvatar(senderId: string): string {
  return contactsMap.value.get(senderId)?.avatar ?? '';
}

// Whether render-item i begins a new run from its sender, i.e. the previous
// message was from someone else (or was outgoing). The avatar + colored name show
// only on a run's first bubble; continuation bubbles get a spacer for alignment.
function groupRunStart(i: number): boolean {
  if (!chat.value?.isGroup) return false;
  const cur = renderItems.value[i];
  if (cur?.kind !== 'msg' || cur.message.outgoing) return false;
  const prev = renderItems.value[i - 1];
  if (!prev) return true;
  const prevMsg = prev.kind === 'msg' ? prev.message : prev.messages[prev.messages.length - 1];
  return prevMsg.outgoing || prevMsg.senderId !== cur.message.senderId;
}

async function startReply(m: Message): Promise<void> {
  let thumb: string | undefined;
  if (m.mediaId && (m.kind === 'image' || m.kind === 'video')) {
    const mi = mediaInfo.value[m.mediaId];
    const srcUrl = m.kind === 'image' ? mi?.url : mi?.posterUrl;
    if (srcUrl) thumb = await smallThumb(srcUrl);
  }
  replyingTo.value = {
    id: m.id,
    senderId: m.outgoing ? selfId : m.senderId,
    preview: previewOf(m),
    thumb,
    kind: m.kind,
    videoNote: m.videoNote,
  };
  // Focus the composer so the user can type the reply right away.
  await nextTick();
  void composerEl.value?.$el?.setFocus();
}

// A tiny square thumbnail (data URL) of an image/poster for the reply quote.
function smallThumb(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = 48;
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(undefined);
      const r = Math.max(s / img.width, s / img.height);
      const w = img.width * r;
      const h = img.height * r;
      ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
      resolve(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
}

// Tapping a quote scrolls to the original message if it's currently loaded.
function scrollToMessage(id: string): void {
  const el = document.querySelector(`[data-mid="${id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  // The quoted message isn't on this device, e.g. a reply to a message sent
  // before we joined this group. The quote bubble still renders from its embedded
  // snapshot; there's just nothing to scroll to.
  void toastController
    .create({ message: 'Original message not available', duration: 1400, position: 'bottom' })
    .then((t) => t.present());
}

// Drag-to-swipe a bubble (touch only): drag right past the threshold to reply,
// left to delete, revealing an icon underneath. Releasing short of the threshold
// snaps back and does nothing.
const SWIPE_MAX = 110; // how far the bubble can travel
const SWIPE_TRIGGER = 70; // release past this fires the action
const swipeId = ref<string | null>(null); // the message currently being dragged
const swipeDx = ref(0); // its current x offset
const swipeReleasing = ref(false); // animate the snap-back
let swipeStartX = 0;
let swipeStartY = 0;
let swipeDir: 'h' | 'v' | null = null;
let swipeTarget: Message | null = null;

function swipeStyle(id: string): Record<string, string> | undefined {
  if (id !== swipeId.value) return undefined;
  return {
    transform: `translateX(${swipeDx.value}px)`,
    transition: swipeReleasing.value ? 'transform 0.2s ease' : 'none',
  };
}
function onSwipeStart(e: TouchEvent, m: Message): void {
  if (m.deleted) return;
  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
  swipeDir = null;
  swipeTarget = m;
  swipeId.value = m.id;
  swipeDx.value = 0;
  swipeReleasing.value = false;
}
function onSwipeMove(e: TouchEvent): void {
  if (!swipeTarget) return;
  const dx = e.touches[0].clientX - swipeStartX;
  const dy = e.touches[0].clientY - swipeStartY;
  if (swipeDir === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
    swipeDir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
    if (swipeDir === 'v') {
      swipeTarget = null; // a vertical scroll, not a swipe
      swipeId.value = null;
      return;
    }
  }
  if (swipeDir === 'h') {
    let v = dx;
    if (Math.abs(v) > SWIPE_MAX) v = (v > 0 ? 1 : -1) * (SWIPE_MAX + (Math.abs(v) - SWIPE_MAX) * 0.18);
    swipeDx.value = v;
    if (e.cancelable) e.preventDefault();
  }
}
function onSwipeEnd(): void {
  const m = swipeTarget;
  const dx = swipeDx.value;
  const dir = swipeDir;
  swipeTarget = null;
  swipeDir = null;
  if (!m) {
    swipeId.value = null;
    return;
  }
  swipeReleasing.value = true;
  swipeDx.value = 0; // snap back
  window.setTimeout(() => {
    swipeId.value = null;
    swipeReleasing.value = false;
  }, 220);
  if (dir === 'h' && Math.abs(dx) >= SWIPE_TRIGGER) {
    if (dx > 0) void startReply(m);
    else void confirmDelete(m);
  }
}
async function confirmDelete(m: Message): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Delete message?',
    buttons: [
      {
        text: 'Delete',
        role: 'destructive',
        handler: () => {
          if (m.albumId) void deleteAlbum(m.albumId);
          else void softDeleteMessage(m.id);
        },
      },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}
async function deleteAlbum(albumId: string): Promise<void> {
  for (const x of messages.value.filter((m) => m.albumId === albumId)) await softDeleteMessage(x.id);
}

// Reactions detail (who reacted with what, and when), resolves reactor names
// from contacts; works for 1:1 and group messages.
async function openReactionDetails(m: Message) {
  const items = await Promise.all(
    (m.reactions ?? [])
      .slice()
      .sort((a, b) => a.at - b.at)
      .map(async (r) => ({
        name: r.userId === selfId ? 'You' : (await getContact(r.userId))?.name ?? r.userId.slice(0, 8),
        emoji: r.emoji,
        when: formatStamp(r.at),
      })),
  );
  const popover = await popoverController.create({
    component: ReactionDetails,
    cssClass: 'reaction-popover',
    componentProps: { items },
  });
  await popover.present();
}

/* ---- full emoji picker (bottom sheet) ---- */
// emoji-picker-element is a framework-agnostic web component; we create it
// imperatively (so no Vue custom-element config is needed) and lazy-load it only
// when the picker opens.
const pickerOpen = ref(false);
const pickerHost = ref<HTMLElement>();
let pickerTarget: string | null = null;
let pickerEl: HTMLElement | null = null;

async function openEmojiPicker(m: Message) {
  pickerTarget = m.id;
  await import('emoji-picker-element');
  pickerOpen.value = true;
}
async function mountPicker() {
  await nextTick();
  if (!pickerHost.value || pickerEl) return;
  pickerEl = document.createElement('emoji-picker');
  pickerEl.addEventListener('emoji-click', onEmojiPicked as EventListener);
  pickerHost.value.appendChild(pickerEl);
}
function onEmojiPicked(ev: Event) {
  const emoji = (ev as CustomEvent<{ unicode?: string }>).detail?.unicode;
  const target = pickerTarget;
  pickerOpen.value = false;
  if (emoji && target) void reactToMessage(target, emoji);
}
function closePicker() {
  pickerOpen.value = false;
  if (pickerEl) {
    pickerEl.removeEventListener('emoji-click', onEmojiPicked as EventListener);
    pickerEl.remove();
    pickerEl = null;
  }
  pickerTarget = null;
}

const search = ref('');
const showSearch = ref(false);
const draft = ref('');

// Keep the line you're typing visible. Once the composer hits its max height it
// scrolls, but the scroll container is the ion-textarea HOST (its inner native
// textarea grows to fit, so it never scrolls itself), and the browser only keeps
// the caret in view within that native element, not the host. So a fresh bottom
// line ends up clipped just below the fold until you nudge it up. Pin the host to
// the bottom on input so the newest line stays fully visible.
function onComposerInput(e: CustomEvent): void {
  draft.value = (e.detail as { value?: string | null }).value ?? '';
  const host = composerEl.value?.$el;
  if (host) requestAnimationFrame(() => { host.scrollTop = host.scrollHeight; });
}

// Block Return while the composer is empty (or only whitespace) so a message can't
// start with blank lines / be opened with nothing typed.
function onComposerEnter(e: KeyboardEvent): void {
  if (!draft.value.trim()) e.preventDefault();
}

// Tidy an outgoing message: strip trailing spaces on each line, collapse runs of
// blank lines to at most one, and drop leading/trailing blank lines, so messages
// don't carry unnecessary vertical space.
function normalizeOutgoing(text: string): string {
  return text
    .replace(/[^\S\n]+$/gm, '') // trailing spaces/tabs per line
    .replace(/\n{3,}/g, '\n\n') // at most one blank line between paragraphs
    .trim(); // leading/trailing blank lines + whitespace
}

const cameraInput = ref<HTMLInputElement | null>(null);
const photoInput = ref<HTMLInputElement | null>(null);

const chat = useLiveQuery<Chat | undefined>(
  () => getChat(chatId),
  ['chats'],
  undefined,
);

// The 1:1 peer's contact (live), to drive the ghosted/blocked composer states.
const peerId = computed(() =>
  chat.value && !chat.value.isGroup ? chat.value.participantIds[0] : undefined,
);
const peerContact = useLiveQuery<Contact | undefined>(
  () => (peerId.value ? getContact(peerId.value) : Promise.resolve(undefined)),
  ['contacts'],
  undefined,
  () => peerId.value,
);
const peerGhosted = computed(
  () => peerContact.value?.ghosted === true || chat.value?.ghosted === true,
);
const peerBlocked = computed(() => peerContact.value?.blocked === true);

// Opening the conversation clears its unread count (and the Chats badge) and
// sends 'read' receipts to the sender (the blue "seen" checks on their side).
// viewActive tracks whether the chat is actually on-screen, so we only mark
// messages seen while it's visible (Ionic keeps pages alive in the background).
const viewActive = ref(false);

// WhatsApp-style header reveal: keep the avatar/name/last-seen hidden during the
// page-push transition (it animates/reflows in the toolbar as the back button and
// title region settle), then fade it in at its final position once the transition
// completes, so the user never sees it shift. Reset before each enter so the fade
// replays every time the chat is opened.
const headerReady = ref(false);
let headerReadyFallback: ReturnType<typeof setTimeout> | undefined;

onIonViewWillEnter(() => {
  headerReady.value = false;
  // Re-check whether the peer terminated their account: an established ratchet
  // session keeps sealing fine after they delete, so opening the chat is our
  // chance to ghost them (→ "Ghosted" header + locked composer).
  if (peerId.value) void detectTerminated(peerId.value);
});

// Re-pin to the newest message whenever the content grows (media decoding, text
// reflow) or the viewport shrinks (keyboard), but only while the user is at the
// bottom (stickBottom), so reading history isn't interrupted.
let resizeObs: ResizeObserver | null = null;
let listReadyFallback: ReturnType<typeof setTimeout> | undefined;
function observeScroll(): void {
  if (!resizeObs && 'ResizeObserver' in window) {
    resizeObs = new ResizeObserver(() => {
      if (stickBottom) void scrollToNewest();
    });
  }
  if (resizeObs && listEl.value) resizeObs.observe(listEl.value); // content height (media)
  void ensureScrollEl().then((el) => {
    if (el && resizeObs) resizeObs.observe(el); // viewport height (keyboard)
  });
}

onMounted(() => {
  void markChatRead(chatId);
  void resumePendingMediaJobs(); // restart any compressions interrupted by a reload
  document.addEventListener('visibilitychange', onVisibilityChange);
  // Safety net: if the enter transition's didEnter never fires (e.g. opened
  // directly with no animation), still reveal the header rather than leave it
  // invisible. Longer than the push transition so it won't show a mid-shift.
  headerReadyFallback = setTimeout(() => (headerReady.value = true), 600);
  observeScroll();
  // Safety net: reveal the list even if the messages query never fires a change
  // (e.g. an already-empty chat), so it can't stay hidden.
  listReadyFallback = setTimeout(() => (listReady.value = true), 800);
});
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  clearTimeout(headerReadyFallback);
  clearTimeout(listReadyFallback);
  resizeObs?.disconnect();
});
// Send 'read' ("seen") receipts ONLY when the user is genuinely looking at this
// chat: its view is the active one AND the app is foregrounded (document visible).
// A message that arrives via push while the app is backgrounded (screen off /
// another app) must NOT be marked seen just because the chat view is still mounted
// so the sender would see a false "seen". The receipt is sent instead when the user
// returns to the foregrounded chat (onVisibilityChange) or opens it.
function markChatSeenIfVisible(): void {
  if (viewActive.value && document.visibilityState === 'visible') void sendReadReceipts(chatId);
}

onIonViewDidEnter(() => {
  viewActive.value = true;
  headerReady.value = true; // transition done → fade the header in at rest
  observeScroll(); // resolve + observe the scroll element (re-pin on keyboard/resize)
  setActiveChat(chatId); // suppress in-app banners for the chat we're viewing
  void markChatRead(chatId);
  markChatSeenIfVisible();
  scheduleShareHint();
  // Entered with ?search=1 (from the contact-info "Search" action) → open search.
  if (route.query.search) showSearch.value = true;
});

// Re-schedule once the keystore unlocks (e.g. opened straight into this chat
// behind the passcode gate), so the hint waits until we're actually in the app.
watch(isUnlocked, (unlocked) => {
  if (unlocked && viewActive.value) scheduleShareHint();
});

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    if (viewActive.value) {
      // Returning to the foregrounded chat → now the user actually sees any
      // messages that landed (via push) while we were backgrounded; mark them read.
      markChatSeenIfVisible();
      scheduleShareHint();
    }
  } else {
    // Backgrounded: clear so a stale toast can't surface over the gate on return.
    clearTimeout(shareHintTimer);
    dismissShareHintToast();
  }
}

/* ---- profile re-share hint removed ----
   Profiles now propagate through the in-network directory (publishOwnProfile on
   edit; contacts refreshed via refreshContactProfiles), so there's nothing to
   prompt the user to "share". scheduleShareHint is kept as a no-op so the
   existing view/visibility lifecycle callers stay valid. */

let shareHintToast: HTMLIonToastElement | null = null;
let shareHintTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleShareHint(): void {
  clearTimeout(shareHintTimer);
}

function dismissShareHintToast(): void {
  void shareHintToast?.dismiss().catch(() => {});
  shareHintToast = null;
}

onIonViewWillLeave(() => {
  viewActive.value = false;
  setActiveChat(null);
  clearTimeout(shareHintTimer);
  dismissShareHintToast(); // don't let the hint linger on other pages
});

const messages = useLiveQuery(
  () => listMessages(chatId, search.value),
  ['messages'],
  [],
  () => search.value,
);

// A new message marks the chat seen (only when foregrounded; markChatSeenIfVisible
// no-ops otherwise) and auto-follows to the bottom, but only when we were already
// pinned there (stickBottom) or it's our own send, never while reading history.
// The FIRST load also reveals the list (listReady) once it's scrolled to newest, so
// opening a long chat doesn't flash the oldest message first.
let didInitialLoad = false;
watch(messages, async (list, prev) => {
  markChatSeenIfVisible();
  if (!didInitialLoad) {
    didInitialLoad = true;
    if (!search.value && list.length) {
      stickBottom = true;
      await scrollToNewest();
    }
    listReady.value = true;
    return;
  }
  if (search.value) return; // searching filters the list, don't yank the view
  if (list.length <= (prev?.length ?? 0)) return; // reaction/status update, not new
  const newest = list[list.length - 1]; // listMessages is oldest-first
  if (newest?.outgoing || stickBottom) void scrollToNewest();
});

// Paginate: render the newest `visible` messages (natural order); pulling up at the
// top loads older ones.
const PAGE = 25;
const visible = ref(PAGE);
const visibleMessages = computed(() => messages.value.slice(-visible.value));
watch(search, () => (visible.value = PAGE));

// Collapse consecutive media messages that share an albumId into one album item
// (rendered as a grid). Everything else stays a single message. The list is
// oldest-first; album members are kept in send-order for the grid.
type RenderItem =
  | { kind: 'msg'; key: string; message: Message }
  | { kind: 'album'; key: string; messages: Message[] };
const renderItems = computed<RenderItem[]>(() => {
  const list = visibleMessages.value;
  const out: RenderItem[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.albumId) {
      const group = [m];
      while (i + 1 < list.length && list[i + 1].albumId === m.albumId) group.push(list[++i]);
      group.sort((a, b) => a.timestamp - b.timestamp); // send order for the grid
      out.push({ kind: 'album', key: m.albumId, messages: group });
    } else {
      out.push({ kind: 'msg', key: m.id, message: m });
    }
  }
  return out;
});
const itemTime = (it: RenderItem) => (it.kind === 'msg' ? it.message.timestamp : it.messages[0].timestamp);

// First 4 cells of an album, plus the "+N more" overlay count on the 4th.
const albumCells = (msgs: Message[]) => msgs.slice(0, 4);
const albumOverlay = (msgs: Message[]) => (msgs.length > 4 ? msgs.length - 3 : 0);

async function loadOlder(ev: InfiniteScrollCustomEvent) {
  // Prepending older messages grows the list above the viewport; keep the messages
  // currently under the user's eyes by adding the height delta to scrollTop.
  const el = await ensureScrollEl();
  const before = el?.scrollHeight ?? 0;
  visible.value += PAGE;
  await nextTick();
  if (el) el.scrollTop += el.scrollHeight - before;
  void ev.target.complete();
}

// Resolve on-device media (Blobs) to object URLs for rendering.
interface MediaInfo {
  url: string;
  posterUrl?: string;
  mime: string;
  name: string;
}

const mediaInfo = ref<Record<string, MediaInfo>>({});
watch(
  messages,
  async (list) => {
    for (const m of list) {
      if (m.mediaId && !mediaInfo.value[m.mediaId]) {
        const media = await get<Media>('media', m.mediaId);
        if (media) {
          const url = URL.createObjectURL(media.blob);
          const info: MediaInfo = {
            url,
            posterUrl: media.posterBlob ? URL.createObjectURL(media.posterBlob) : undefined,
            mime: media.mime,
            name: media.name,
          };
          mediaInfo.value[m.mediaId] = info;
          // Videos: prefer the sent thumbnail (m.posterData, a stable data URL).
          // Otherwise derive one from the first frame and PERSIST it (posterBlob)
          // so it isn't regenerated/lost on every remount.
          if (m.kind === 'video' && !info.posterUrl && !m.posterData) {
            const blob = media.blob;
            const mid = m.mediaId;
            void generateVideoPoster(blob).then(async (poster) => {
              if (!poster) return;
              mediaInfo.value[mid] = { ...mediaInfo.value[mid], posterUrl: poster };
              try {
                const md = await get<Media>('media', mid);
                if (md && !md.posterBlob) {
                  md.posterBlob = await (await fetch(poster)).blob();
                  md.updatedAt = Date.now();
                  await put('media', md);
                }
              } catch {
                /* best-effort cache */
              }
            });
          }
          // Audio (shared music): pull embedded cover art for the track card.
          if (m.kind === 'audio' && !info.posterUrl) {
            void readAudioTags(media.blob).then((tags) => {
              if (tags.cover && m.mediaId) {
                mediaInfo.value[m.mediaId] = {
                  ...mediaInfo.value[m.mediaId],
                  posterUrl: URL.createObjectURL(tags.cover),
                };
              }
            });
          }
        }
      }
    }
  },
  { immediate: true },
);

// Close the viewer if its last item was deleted. (Defined here, after `messages`,
// because watch() evaluates its source once at setup.)
watch(viewerItems, (items) => {
  if (viewer.value.open && items.length === 0) viewer.value.open = false;
});

// Jump to the newest message (the bottom of the natural-order list), e.g. after
// sending, including a reply when scrolled up to the quoted message.
const contentEl = ref<{ $el: HTMLElement } | null>(null);
const listEl = ref<HTMLElement | null>(null);
// Hidden until the first pin to bottom, so opening a long chat doesn't flash the
// oldest message before jumping to the newest.
const listReady = ref(false);
// Whether the view is pinned to the newest message, drives auto-follow on a new
// message and re-pinning as media decodes / the keyboard opens. Updated on scroll.
let stickBottom = true;
// Short window during which scroll events are the echo of our OWN pin-to-bottom,
// not the user. Without it, ion-content's throttled scroll event fires after late
// media has grown the list, nearBottom() reads false, stickBottom drops, and the
// ResizeObserver stops re-pinning → the view drifts up. Refreshed on each pin;
// genuine user scrolls land outside it.
let suppressStickUntil = 0;
// Cache ion-content's inner scroll element so we can read scroll metrics
// synchronously and pin without an async hop each message.
let scrollEl: HTMLElement | null = null;
async function ensureScrollEl(): Promise<HTMLElement | null> {
  if (!scrollEl) {
    scrollEl =
      (await (contentEl.value?.$el as unknown as { getScrollElement?: () => Promise<HTMLElement> })?.getScrollElement?.()) ??
      null;
  }
  return scrollEl;
}
async function scrollToNewest(): Promise<void> {
  await nextTick();
  const el = await ensureScrollEl();
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  stickBottom = true;
  suppressStickUntil = Date.now() + 250;
}
// Within ~120px of the bottom counts as "pinned to newest". Defaults to true before
// the scroll element resolves (a fresh chat opens pinned to newest).
function nearBottom(): boolean {
  if (!scrollEl) return true;
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
}
// Track whether the user is at the bottom (auto-follow) or has scrolled up to read
// history (so a new message / media load doesn't yank them down). Skip the echo of
// our own programmatic pin so late-loading media can't flip the pin off mid-settle.
function onContentScroll(): void {
  if (Date.now() < suppressStickUntil) return;
  stickBottom = nearBottom();
}

async function send() {
  const text = normalizeOutgoing(draft.value);
  if (!text) return;
  if (peerGhosted.value || peerBlocked.value) return; // composer is hidden anyway; backstop
  draft.value = '';
  // Plain copy, replyingTo.value is a reactive Proxy, which IndexedDB can't clone.
  const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
  replyingTo.value = null;
  await sendMessage(chatId, text, reply);
  await scrollToNewest();
}

/* ---- attachments ---- */

async function openAttach() {
  const sheet = await actionSheetController.create({
    header: 'Share',
    buttons: [
      { text: 'Media & File', handler: () => photoInput.value?.click() },
      { text: 'Camera', handler: () => cameraInput.value?.click() },
      { text: 'Location', handler: () => void shareLocation() },
      { text: 'Contact', handler: () => void openContactPicker() },
      { text: 'Poll', handler: () => void openPollComposer() },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}

/* ---- location / poll / contact ---- */

// Grab the consumed reply quote (a plain copy, the reactive Proxy can't be
// cloned into IndexedDB) and clear the composer's reply bar.
function takeReply(): ReplyRef | undefined {
  const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
  replyingTo.value = null;
  return reply;
}

// Open the location composer (it acquires + refines GPS and previews a map
// before the user confirms the send).
const locationOpen = ref(false);
const shareLocation = () => (locationOpen.value = true);
async function onLocationSend(c: { lat: number; lng: number }): Promise<void> {
  locationOpen.value = false;
  await sendLocation(chatId, { lat: c.lat, lng: c.lng }, takeReply());
  void scrollToNewest();
}

const pollOpen = ref(false);
const contactPickerOpen = ref(false);
const openPollComposer = () => (pollOpen.value = true);
const openContactPicker = () => (contactPickerOpen.value = true);

async function onPollCreate(poll: { question: string; options: string[]; multi: boolean }): Promise<void> {
  pollOpen.value = false;
  await sendPoll(chatId, poll.question, poll.options, poll.multi, takeReply());
  void scrollToNewest();
}

async function onContactSelect(c: SharedContact): Promise<void> {
  contactPickerOpen.value = false;
  await sendContact(chatId, c, takeReply());
  void scrollToNewest();
}

// Tapping "Message" on a shared contact opens (creating if needed) a chat with them.
async function openSharedContact(c: SharedContact): Promise<void> {
  if (!(await ensureProfile())) return; // require a name + photo before starting a new chat
  const id = await messageSharedContact(c);
  if (id) router.push(`/chat/${id}`);
}

function triggerCamera() {
  cameraInput.value?.click();
}

/* ---- video note: hold the camera button to record a round clip ---- */
const videoNoteOpen = ref(false);
let camTimer: number | undefined;
let camHeld = false;
function camDown(): void {
  camHeld = false;
  camTimer = window.setTimeout(() => {
    camHeld = true;
    videoNoteOpen.value = true;
  }, 600);
}
function camUp(): void {
  if (camTimer) clearTimeout(camTimer);
  camTimer = undefined;
  if (!camHeld) triggerCamera(); // a short tap = the normal camera
}
function camCancel(): void {
  if (camTimer) clearTimeout(camTimer);
  camTimer = undefined;
}
async function onVideoNoteSend(blob: Blob, dur: number): Promise<void> {
  videoNoteOpen.value = false;
  // Plain copy, replyingTo.value is a reactive Proxy, which IndexedDB can't clone.
  const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
  replyingTo.value = null;
  await sendMediaMessage(chatId, 'video', blob, 'video-note', dur, { videoNote: true, replyTo: reply });
}

// Ask for an optional album name; defaults to today's date. Returns the name, or
// null if cancelled.
function promptAlbumName(): Promise<string | null> {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return new Promise((resolve) => {
    void alertController
      .create({
        header: 'Album name',
        message: 'Optional, leave blank to use the date.',
        inputs: [{ name: 'name', type: 'text', value: '', placeholder: date, attributes: { maxlength: 60 } }],
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          { text: 'Send', handler: (d: { name?: string }) => resolve((d?.name ?? '').trim() || date) },
        ],
      })
      .then((a) => a.present());
  });
}

// Ask the send quality for photos/videos (WhatsApp-style). Returns null if the
// user cancels.
function pickQuality(): Promise<Quality | null> {
  return new Promise((resolve) => {
    void actionSheetController
      .create({
        header: 'Send quality',
        buttons: [
          { text: 'HD quality', handler: () => resolve('hd') },
          { text: 'SD quality (smaller)', handler: () => resolve('sd') },
          { text: 'Original quality', handler: () => resolve('original') },
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
        ],
      })
      .then((s) => {
        // Tapping the backdrop also dismisses → treat as cancel.
        s.onDidDismiss().then((d) => {
          if (d.role === 'backdrop') resolve(null);
        });
        return s.present();
      });
  });
}

async function onPick(e: Event, mode: 'auto' | 'file') {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ''; // allow re-picking the same file
  if (!files.length) return;
  // Plain copy, replyingTo.value is a reactive Proxy, which IndexedDB can't clone.
  const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
  replyingTo.value = null;
  // Detect each file's kind from its mime type (the universal picker can return
  // documents and music alongside photos/videos).
  const kindOf = (f: File): 'image' | 'video' | 'audio' | 'file' =>
    mode === 'file'
      ? 'file'
      : f.type.startsWith('video/')
        ? 'video'
        : f.type.startsWith('image/')
          ? 'image'
          : f.type.startsWith('audio/')
            ? 'audio'
            : 'file';
  // Audio files take a separate path (metadata review before sending).
  const audioFiles = files.filter((f) => kindOf(f) === 'audio');
  const otherFiles = files.filter((f) => kindOf(f) !== 'audio');
  let replyLeft = reply; // the quote attaches to the first item sent

  if (otherFiles.length) {
    // Photos/videos can be sent at HD/SD/Original; ask once for the whole batch.
    const hasMedia = otherFiles.some((f) => kindOf(f) === 'image' || kindOf(f) === 'video');
    let quality: Quality = 'original';
    if (hasMedia) {
      const q = await pickQuality();
      if (q === null) return; // cancelled
      quality = q;
    }
    // Several photos/videos chosen together share an album id → rendered as a grid.
    const allMedia = otherFiles.every((f) => kindOf(f) === 'image' || kindOf(f) === 'video');
    const albumId = otherFiles.length > 1 && allMedia ? crypto.randomUUID() : undefined;
    let albumName: string | undefined;
    if (albumId) {
      const name = await promptAlbumName();
      if (name === null) return; // cancelled
      albumName = name;
    }
    // Send the originals + chosen quality; compression for photos/videos runs in
    // the background (status 'compressing' with a progress bar) so the UI never
    // blocks and the user can keep chatting.
    for (const file of otherFiles) {
      const kind = kindOf(file) as 'image' | 'video' | 'file';
      await sendMediaMessage(chatId, kind, file, file.name || 'attachment', undefined, {
        replyTo: replyLeft,
        albumId,
        albumName,
        quality,
      });
      replyLeft = undefined;
    }
  }

  // Queue audio files for the title/artist review sheet (one at a time).
  if (audioFiles.length) {
    for (const f of audioFiles) audioQueue.value.push({ blob: f, name: f.name || 'audio', reply: replyLeft });
    replyLeft = undefined;
    if (!audioReview.value.open) void processNextAudio();
  }
}

/* ---- shared audio player: received/sent music files play as a playlist ---- */
const audioEl = new Audio();
const audioCurId = ref<string | null>(null);
const audioPlaying = ref(false);
const audioProgress = ref(0);
audioEl.addEventListener('timeupdate', () => {
  audioProgress.value = audioEl.duration ? audioEl.currentTime / audioEl.duration : 0;
});
audioEl.addEventListener('play', () => (audioPlaying.value = true));
audioEl.addEventListener('pause', () => (audioPlaying.value = false));
audioEl.addEventListener('ended', () => {
  audioPlaying.value = false;
  audioProgress.value = 0;
  playNextAudio();
});
onUnmounted(() => {
  audioEl.pause();
  audioEl.src = '';
});

// Audio messages in chronological order, the implicit playlist.
const audioOrder = computed(() =>
  [...messages.value]
    .filter((m) => m.kind === 'audio' && !m.deleted && m.mediaId)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((m) => m.id),
);
const audioUrlFor = (id: string): string | undefined => {
  const m = messages.value.find((x) => x.id === id);
  return m?.mediaId ? mediaInfo.value[m.mediaId]?.url : undefined;
};
function toggleAudio(id: string): void {
  if (audioCurId.value === id) {
    if (audioEl.paused) void audioEl.play();
    else audioEl.pause();
    return;
  }
  const url = audioUrlFor(id);
  if (!url) return;
  audioEl.src = url;
  audioCurId.value = id;
  audioProgress.value = 0;
  void audioEl.play();
}
function seekAudio(id: string, frac: number): void {
  if (audioCurId.value !== id || !audioEl.duration) return;
  audioEl.currentTime = frac * audioEl.duration;
}
function playNextAudio(): void {
  const ids = audioOrder.value;
  const i = audioCurId.value ? ids.indexOf(audioCurId.value) : -1;
  const next = i >= 0 && i + 1 < ids.length ? ids[i + 1] : null;
  if (next) toggleAudio(next);
  else audioCurId.value = null;
}

/* ---- audio file review queue (title/artist before sending) ---- */
interface PendingAudio {
  blob: Blob;
  name: string;
  reply?: ReplyRef;
}
const audioQueue = ref<PendingAudio[]>([]);
const audioReview = ref<{
  open: boolean;
  title: string;
  artist: string;
  coverUrl?: string;
  durationSec?: number;
}>({ open: false, title: '', artist: '' });
let audioCurrent: PendingAudio | null = null;

async function processNextAudio(): Promise<void> {
  const next = audioQueue.value.shift();
  if (!next) {
    audioReview.value = { open: false, title: '', artist: '' };
    return;
  }
  audioCurrent = next;
  const [tags, durationSec] = await Promise.all([readAudioTags(next.blob), readAudioDuration(next.blob)]);
  const fallbackTitle = next.name.replace(/\.\w+$/, '');
  audioReview.value = {
    open: true,
    title: tags.title || fallbackTitle,
    artist: tags.artist || '',
    coverUrl: tags.cover ? URL.createObjectURL(tags.cover) : undefined,
    durationSec,
  };
}
async function onAudioReviewSend(meta: { title: string; artist: string }): Promise<void> {
  const cur = audioCurrent;
  audioReview.value = { ...audioReview.value, open: false };
  if (cur) {
    await sendMediaMessage(chatId, 'audio', cur.blob, cur.name, audioReview.value.durationSec, {
      audio: { title: meta.title, artist: meta.artist || undefined },
      replyTo: cur.reply,
    });
    void scrollToNewest();
  }
  await processNextAudio();
}
function onAudioReviewClose(): void {
  audioReview.value = { ...audioReview.value, open: false };
  void processNextAudio(); // skip this one, continue the queue
}

/* ---- audio recording (live waveform + pause/resume) ---- */

const REC_BARS = 42;
const recording = ref(false);
const recPaused = ref(false);
const recElapsed = ref('0:00');
const recBars = ref<number[]>([]); // live amplitude history, scrolling
let recorder: MediaRecorder | null = null;
let recChunks: BlobPart[] = [];
let recTimer: number | undefined; // elapsed display
let recSampler: number | undefined; // waveform sampler
let recAudioCtx: AudioContext | null = null;
let recAnalyser: AnalyserNode | null = null;
let recAccumMs = 0; // active recording time across pauses
let recSegStart = 0; // current segment start

const fmtMs = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const barH = (h: number) => `${Math.round(3 + h * 18)}px`;
const recActiveMs = () => recAccumMs + (recPaused.value ? 0 : Date.now() - recSegStart);

function tickElapsed(): void {
  recElapsed.value = fmtMs(recActiveMs());
}

function sampleWave(): void {
  if (!recAnalyser) return;
  const buf = new Uint8Array(recAnalyser.fftSize);
  recAnalyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  const next = [...recBars.value, Math.min(1, rms * 3.2)];
  if (next.length > REC_BARS) next.shift();
  recBars.value = next;
}

function startSampler(): void {
  recSampler = window.setInterval(sampleWave, 90);
}
function stopSampler(): void {
  if (recSampler) clearInterval(recSampler);
  recSampler = undefined;
}

function teardownRec(): void {
  if (recTimer) clearInterval(recTimer);
  recTimer = undefined;
  stopSampler();
  recorder?.stream.getTracks().forEach((t) => t.stop());
  void recAudioCtx?.close().catch(() => {});
  recAudioCtx = null;
  recAnalyser = null;
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const types = ['audio/webm', 'audio/mp4', 'audio/ogg'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recChunks = [];
    recorder.ondataavailable = (ev) => ev.data.size && recChunks.push(ev.data);
    recorder.start();
    // Tap the mic stream for a live waveform.
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    recAudioCtx = new AC();
    recAnalyser = recAudioCtx.createAnalyser();
    recAnalyser.fftSize = 512;
    recAudioCtx.createMediaStreamSource(stream).connect(recAnalyser);
    recBars.value = [];
    recPaused.value = false;
    recAccumMs = 0;
    recSegStart = Date.now();
    recording.value = true;
    recElapsed.value = '0:00';
    recTimer = window.setInterval(tickElapsed, 200);
    startSampler();
  } catch {
    const t = await toastController.create({ message: 'Microphone unavailable', duration: 1500 });
    await t.present();
  }
}

function togglePause(): void {
  if (!recorder) return;
  if (recPaused.value) {
    recorder.resume();
    recPaused.value = false;
    recSegStart = Date.now();
    startSampler();
  } else {
    recorder.pause();
    recPaused.value = true;
    recAccumMs += Date.now() - recSegStart;
    stopSampler();
  }
}

async function stopAndSendRecording() {
  if (!recorder) return;
  const durationSec = Math.max(1, Math.round(recActiveMs() / 1000));
  const rec = recorder;
  const mime = rec.mimeType || 'audio/webm';
  const blob: Blob = await new Promise((resolve) => {
    rec.onstop = () => resolve(new Blob(recChunks, { type: mime }));
    if (recPaused.value) rec.resume(); // some browsers won't finalize while paused
    rec.stop();
  });
  teardownRec();
  recording.value = false;
  recPaused.value = false;
  recorder = null;
  // Plain copy, replyingTo.value is a reactive Proxy, which IndexedDB can't clone.
  const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
  replyingTo.value = null;
  await sendMediaMessage(chatId, 'voice', blob, 'voice-message', durationSec, { replyTo: reply });
}

function cancelRecording() {
  if (recorder) {
    recorder.onstop = null;
    if (recPaused.value) recorder.resume();
    recorder.stop();
  }
  teardownRec();
  recChunks = [];
  recBars.value = [];
  recording.value = false;
  recPaused.value = false;
  recorder = null;
}
</script>

<style scoped>
/* The header contact (avatar + name + last-seen) sits in slot="start" right after
   the back button as one tappable group. A flex row keeps the avatar + text
   together; the margin separates it from the back chevron so they don't get
   mis-tapped, and max-width lets a long name truncate instead of crowding the
   call buttons. */
.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-inline-start: 8px;
  padding: 2px 4px;
  background: transparent;
  border: none;
  color: var(--app-text);
  cursor: pointer;
  min-width: 0;
  /* Reserve room for the back button (~44px) and the two end call buttons
     (~96px) plus padding, so the name truncates rather than overflowing. */
  max-width: calc(100vw - 170px);
  /* Hidden during the push transition; fades in at rest (see headerReady). The
     small delay lets the toolbar fully settle before the fade starts so no shift
     is ever visible. */
  opacity: 0;
  transition: opacity 0.2s ease 0.025s;
}
.chat-header.ready {
  opacity: 1;
}
.chat-header-avatar {
  width: 36px;
  height: 36px;
  flex: none;
}
.chat-header-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  text-align: start;
  line-height: 1.2;
}
.chat-header-name {
  font-size: 16px;
  font-weight: 600;
  /* --app-text (black on light, white on dark); the <button> wrapper otherwise
     renders its text in the iOS system blue. */
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-header-status {
  font-size: 12px;
  color: var(--app-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rec-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline: 10px;
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
}
.rec-wave {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  height: 24px;
  overflow: hidden;
}
.rec-bar {
  width: 3px;
  min-height: 3px;
  border-radius: 1px;
  background: var(--ion-color-primary);
}
.rec-time {
  flex: none;
  min-width: 36px;
  text-align: right;
}
.rec-dot.paused {
  background: var(--app-text-muted);
}
.pending-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  color: var(--app-text-muted);
  font-size: 13px;
}
/* Composer reply preview bar. */
.reply-bar {
  --min-height: 0;
}
.reply-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline: 10px;
}
.reply-quote {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-left: 3px solid var(--ion-color-primary);
  padding: 2px 8px;
}
.reply-quote .reply-ref-text {
  display: block;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ion-color-danger);
}
.chat-content {
  /* Personal backdrop: Ring's shield mark scattered/rotated and tiled over the
     theme background. The grey fill+stroke reads on both light and dark. */
  --background:
    url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27264%27 height=%27264%27 viewBox=%270 0 264 264%27%3E%3Cg fill=%27none%27 stroke=%27rgba(132,132,132,0.20)%27 stroke-width=%273%27%3E%3Cg transform=%27translate(16,14) scale(0.3) rotate(-148 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(96,18) scale(0.18) rotate(63 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(152,12) scale(0.24) rotate(172 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(222,20) scale(0.16) rotate(-37 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(48,64) scale(0.2) rotate(98 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(120,72) scale(0.32) rotate(-12 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(198,62) scale(0.22) rotate(-95 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(246,68) scale(0.15) rotate(141 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(12,118) scale(0.18) rotate(205 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(82,124) scale(0.27) rotate(-66 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(152,128) scale(0.2) rotate(28 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(222,120) scale(0.18) rotate(-118 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(40,172) scale(0.24) rotate(160 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(112,182) scale(0.3) rotate(-24 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(188,176) scale(0.2) rotate(82 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(246,172) scale(0.15) rotate(-160 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(70,222) scale(0.18) rotate(-200 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(152,224) scale(0.22) rotate(117 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3Cg transform=%27translate(224,224) scale(0.16) rotate(-52 50 49)%27%3E%3Cpath d=%27M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z%27/%3E%3Ccircle cx=%2750%27 cy=%2749%27 r=%2718%27/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")
      repeat,
    var(--ion-background-color, #fff);
  /* Padding via Ionic's own vars so fullscreen/header offsets are preserved */
  --padding-top: 12px;
  --padding-bottom: 12px;
  --padding-start: 12px;
  --padding-end: 12px;
}
/* Natural top→bottom message flow. The list fills the viewport (min-height) so a
   short conversation can pin to the bottom like a chat, while a long one overflows
   and scrolls normally, no column-reverse, no iOS Safari paint bug. */
.msg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 100%;
}
/* Bottom-anchor: the first child soaks up the free space above it, so a short
   conversation sits at the bottom while a long one stays fully scrollable to the
   top (avoids the justify-content:flex-end overflow-clip bug on iOS). */
.msg-list > ion-infinite-scroll:first-child {
  margin-top: auto;
}
.bubble-row {
  display: flex;
  justify-content: flex-start;
}
.bubble-row.out {
  justify-content: flex-end;
}
/* Column wrapper around a bubble + its reactions, so the pills can hang below
   the bubble in normal flow. */
.bubble-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 78%;
  min-width: 0;
}
.bubble-row.out .bubble-col {
  align-items: flex-end;
}
.bubble {
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 16px;
  background: var(--app-bubble-in);
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* Soft shadow (not a border) so the bright incoming bubble still reads on the
     light theme's white background. */
  box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.08);
}
.bubble.out {
  background: var(--app-bubble-out);
}
/* A round video note has no chat bubble behind it; instead the circle gets a
   thin frame ring and its timestamp sits in a small pill, both matching the
   in/out bubble colour. */
.bubble-plain,
.bubble-plain.out {
  background: transparent;
  box-shadow: none;
  padding: 0;
  align-items: center;
}
.bubble-plain :deep(.vnp) {
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--app-bubble-in);
}
.bubble-plain.out :deep(.vnp) {
  box-shadow: 0 0 0 3px var(--app-bubble-out);
}
.bubble-plain .time {
  align-self: center;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--app-bubble-in);
  box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.08);
}
.bubble-plain.out .time {
  background: var(--app-bubble-out);
}
/* Media bubbles: a thin (3px) frame hugging the photo/video; caption, sender and
   timestamp keep a small inset so they don't touch the edge. */
.bubble-media {
  padding: 3px;
  gap: 0;
}
.bubble-media .bubble-image {
  border-radius: 13px;
}
.bubble-media .sender {
  padding: 2px 6px 0;
}
.bubble-media .text {
  padding: 3px 6px 0;
}
.bubble-media .time {
  padding: 2px 6px;
}
.bubble-media .reply-ref {
  margin: 1px 1px 3px;
}
.sender {
  font-size: 13px;
  font-weight: 600;
  /* Per-sender colour is applied inline (see userColor); this is the fallback. */
  color: var(--app-text);
}
/* Group chats: a sender's avatar to the left of their bubbles. Shown once per run;
   the spacer reserves its width so the continuation bubbles line up under it. */
.msg-avatar {
  width: 34px;
  min-width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  margin: 2px 7px 0 0;
  align-self: flex-start;
  background: var(--app-bubble-in);
  cursor: pointer;
}
.avatar-spacer {
  visibility: hidden;
}
/* Drag-to-swipe: the bubble translates over the revealed reply/trash icon. */
.swipe-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
}
.bubble-row.out .swipe-wrap {
  align-items: flex-end;
}
.swipe-ico {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  z-index: 0;
}
.swipe-ico.reply {
  left: 6px;
  background: var(--ion-color-primary);
}
.swipe-ico.trash {
  right: 6px;
  background: var(--ion-color-danger);
}
.swipe-wrap .bubble {
  position: relative;
  z-index: 1;
}
/* Quoted message (reply reference) shown above a bubble's content. */
.reply-ref {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: start;
  border: none;
  border-left: 3px solid var(--ion-color-primary);
  border-radius: 6px;
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  padding: 4px 8px;
  margin-bottom: 3px;
  cursor: pointer;
}
.reply-ref-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.reply-thumb {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 4px;
  object-fit: cover;
}
.reply-ref-author {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
}
.reply-ref-text {
  font-size: 13px;
  color: var(--app-text-muted);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
}
.reply-ico {
  font-size: 14px;
  vertical-align: -2px;
  margin-right: 3px;
}
.text {
  font-size: 17px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
/* An all-emoji message (≤3) renders larger and roomier. */
.text.emoji-only {
  line-height: 1.15;
  padding: 2px 0;
}
/* Floating quick-forward button beside incoming media/files/links. */
.fwd-float {
  align-self: center;
  flex: none;
  width: 42px;
  height: 42px;
  margin-inline-start: 8px;
  border: none;
  border-radius: 50%;
  background: var(--app-surface);
  color: var(--app-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  cursor: pointer;
}
/* Background job: labelled encode + upload progress bars. */
.job-progress {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 4px 0 2px;
}
.job-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--app-text-muted);
}
.job-label {
  flex: none;
  width: 56px;
}
.job-track {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.14);
  overflow: hidden;
}
.job-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--ion-color-primary);
  transition: width 0.2s ease;
}
.job-num {
  flex: none;
  width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* Wrapper so a photo can overlay its quality/size badge. */
.media-wrap {
  position: relative;
  display: inline-block;
  cursor: pointer;
}
/* Failed send → red retry button in front of the bubble. */
.retry-btn {
  align-self: center;
  flex: none;
  width: 34px;
  height: 34px;
  margin-inline-end: 8px;
  border: none;
  border-radius: 50%;
  background: var(--ion-color-danger);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
}
/* Not-yet-downloaded video: thumbnail + a tappable download button. */
.video-poster.pending {
  cursor: pointer;
}
.video-noposter {
  width: 220px;
  max-width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.2);
}
.dl-btn {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
}
.dl-btn ion-spinner {
  width: 26px;
  height: 26px;
}
/* Resolution · length · size badge on a video thumbnail (both sides). */
.video-meta {
  position: absolute;
  left: 6px;
  bottom: 6px;
  display: inline-block;
  padding: 2px 7px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
/* Link preview card (privacy-safe: domain + icon, no remote fetch). */
.link-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.06);
  text-decoration: none;
  color: inherit;
  max-width: 260px;
  margin-bottom: 2px;
}
.link-thumb {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--ion-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.link-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.link-domain {
  font-size: 14px;
  font-weight: 600;
}
.link-url {
  font-size: 12px;
  color: var(--app-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.msg-link {
  color: var(--ion-color-primary);
  text-decoration: underline;
  word-break: break-all;
}
.deleted-msg {
  font-style: italic;
  color: var(--app-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.media-cleared {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 12px;
  background: rgba(120, 120, 128, 0.12);
  color: var(--app-text-muted);
  font-style: italic;
  font-size: 14px;
}
.media-cleared ion-icon {
  font-size: 20px;
  flex-shrink: 0;
}
.time {
  align-self: flex-end;
  font-size: 12px;
  color: var(--app-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
/* Reaction pills straddle the bubble's bottom edge: the negative margin pulls
   them up so only ~30% overlaps the bubble (the rest hangs below), while still
   occupying normal-flow space so the next message keeps a regular gap. */
.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: -8px;
  padding-inline: 8px;
  position: relative;
  z-index: 1;
}
.bubble-row.out .reactions {
  justify-content: flex-end;
}
.reaction {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  height: 24px;
  border: 1px solid var(--ion-color-step-150, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  background: var(--ion-background-color, #fff);
  cursor: pointer;
  line-height: 1;
}
.reaction.mine {
  border-color: var(--ion-color-primary);
  background: color-mix(in srgb, var(--ion-color-primary) 14%, var(--ion-background-color, #fff));
}
.r-emoji {
  font-size: 14px;
}
.r-count {
  font-size: 12px;
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
}
/* Media album: a 2-column grid of square thumbnails (up to 4, with a +N more
   overlay on the last cell). */
.album-bubble {
  padding: 4px;
  gap: 4px;
}
.album-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
  padding: 2px 6px 0;
}
.album-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  width: 240px;
  max-width: 68vw;
  border-radius: 12px;
  overflow: hidden;
}
.album-cell {
  position: relative;
  aspect-ratio: 1;
  border: none;
  padding: 0;
  background: var(--app-surface);
  cursor: pointer;
  overflow: hidden;
}
.album-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.album-more {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 600;
}
.play-overlay-sm {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-size: 34px;
  pointer-events: none;
}
.album-bubble .time {
  padding-inline: 4px;
}
/* Centered day divider between message groups. */
.day-sep {
  align-self: center;
  margin: 6px 0;
}
.day-sep span {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 12px;
  background: var(--app-surface);
  color: var(--app-text-muted);
  font-size: 12px;
  font-weight: 600;
}
.picker-host {
  display: flex;
  justify-content: center;
  height: 100%;
}
/* :deep, the <emoji-picker> is created imperatively, so it has no scoped
   data-attr; reach it through the (scoped) host instead. */
.picker-host :deep(emoji-picker) {
  width: 100%;
  height: 100%;
}
.tick {
  font-size: 16px;
}
/* WhatsApp-style blue "seen" double-check. */
.tick.read {
  color: #34b7f1;
}
.bubble-image {
  border-radius: 12px;
  width: 220px;
  max-width: 100%;
  display: block;
}
.video-poster {
  position: relative;
  display: inline-block;
}
.play-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 48px;
  color: #fff;
  filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.5));
}
.bubble-audio {
  width: 240px;
  max-width: 100%;
  height: 40px;
}
.file-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: inherit;
  text-decoration: none;
}
.empty {
  text-align: center;
  margin-top: 40px;
}
/* Auto-growing message composer: wrap long text and grow vertically, but cap the
   height (~5 lines) and scroll beyond that so the keypad/footer stay sane. */
.composer {
  --padding-top: 6px;
  --padding-bottom: 6px;
  max-height: 7.5rem;
  overflow-y: auto;
}
</style>
