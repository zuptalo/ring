<template>
  <ion-page>
    <ion-header :translucent="true">
      <!-- Selection mode: the header becomes a bulk-action bar (count · forward ·
           delete). Entered via "Select" in a message's menu; × leaves it. -->
      <ion-toolbar v-if="selecting">
        <ion-buttons slot="start">
          <ion-button aria-label="Cancel selection" @click="exitSelect">
            <ion-icon slot="icon-only" :icon="closeOutline" />
          </ion-button>
        </ion-buttons>
        <ion-title>{{ selected.length }} selected</ion-title>
        <ion-buttons slot="end">
          <ion-button aria-label="Forward selected" :disabled="!selected.length" @click="forwardSelected">
            <ion-icon slot="icon-only" :icon="arrowRedoOutline" />
          </ion-button>
          <ion-button aria-label="Delete selected" color="danger" :disabled="!selected.length" @click="confirmDeleteSelected">
            <ion-icon slot="icon-only" :icon="trashOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar v-else>
        <!-- Back button + avatar + name + last-seen all live in slot="start" so
             they form one left-aligned group, with a gap so the chevron can't be
             tapped by mistake. The avatar/name cluster stays hidden during the
             page-push transition and fades in at its resting position once it
             completes (headerReady), WhatsApp-style, so any toolbar reflow while
             the back button + title region settle is never visible. -->
        <ion-buttons slot="start">
          <!-- The back button doubles as an unread counter for the REST of the app
               ("< 5"), so new messages in other chats aren't missed while you're here. -->
          <ion-back-button default-href="/tabs/chats" :text="backText" />
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
            <user-avatar :src="chat.avatar" :alt="chat.name" />
          </ion-avatar>
          <span class="chat-header-text">
            <span class="chat-header-name" dir="auto">{{ chat.name }}</span>
            <span v-if="statusLine" class="chat-header-status">{{ statusLine }}</span>
          </span>
        </button>
        <ion-buttons slot="end">
          <!-- spec 1020: jump to where I was @mentioned (the most recent one loaded). -->
          <ion-button v-if="lastMentionId" aria-label="Jump to mention" @click="jumpToMention">
            <ion-icon slot="icon-only" :icon="atOutline" />
          </ion-button>
          <!-- Group size gates the call type (spec 0004 US3): no video past 4 participants,
               no group call at all past 8. 1:1 chats always show both. -->
          <ion-button
            v-if="!peerGhosted && !peerBlocked && canVideoCall"
            aria-label="Video call"
            @click="startCall('Video')"
          >
            <ion-icon slot="icon-only" :icon="videocamOutline" />
          </ion-button>
          <ion-button
            v-if="!peerGhosted && !peerBlocked && canAudioCall"
            aria-label="Voice call"
            @click="startCall('Voice')"
          >
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
        <ion-buttons slot="end">
          <ion-button aria-label="Jump to date" @click="datePickerOpen = true">
            <ion-icon slot="icon-only" :icon="calendarOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <!-- Jump to date: pick a day and scroll to the first message on/after it. -->
      <ion-modal :is-open="datePickerOpen" @did-dismiss="datePickerOpen = false">
        <ion-content class="ion-padding">
          <ion-datetime
            presentation="date"
            :prefer-wheel="true"
            @ion-change="onPickDate"
          />
        </ion-content>
      </ion-modal>
    </ion-header>

    <!-- Natural top→bottom order (oldest at top, newest at bottom). We pin to the
         newest on open/send, stay pinned as media decodes (a ResizeObserver), and
         preserve position when older pages load in at the top. No column-reverse →
         no iOS Safari blank-until-scroll bug. Hidden until the first pin to avoid a
         top→bottom flash on open. -->
    <ion-content ref="contentEl" :fullscreen="true" class="chat-content" :scroll-events="true" @ionScroll="onContentScroll">
      <div ref="listEl" class="msg-list" :style="{ visibility: listReady ? 'visible' : 'hidden' }">
      <!-- Top spacer: reserves the height of the older messages NOT held in `rows`, so the
           scroll range reflects the whole chat. Prepends shrink it (and evictions grow it) to
           keep the read position fixed WITHOUT writing scrollTop — the only way to not stall
           iOS momentum (spec 1011). Height is set imperatively before paint by withScrollAnchor. -->
      <div ref="topSpacer" class="vscroll-pad" :style="{ height: topPadPx + 'px' }" aria-hidden="true"></div>
      <!-- Top of the list: pull up to load earlier messages (older pages). -->
      <!-- Page older messages well before the very top is reached (look-ahead), so
           scrolling back never stalls at the load boundary (spec 1005 FR-001). -->
      <ion-infinite-scroll
        :disabled="!listReady || !hasOlder"
        position="top"
        threshold="25%"
        @ion-infinite="loadOlder"
      >
        <ion-infinite-scroll-content loading-text="Loading earlier messages…" />
      </ion-infinite-scroll>
      <!-- Look-ahead sentinel: an IntersectionObserver with rootMargin = LOOK_AHEAD_PX fires
           loadOlder well BEFORE the top edge is reached, so the older page is in the DOM
           before scrollTop hits 0 (page-before-top, INV-2). ion-infinite-scroll above is the
           backstop. (spec 1011 D5) -->
      <div ref="topSentinel" class="scroll-sentinel" aria-hidden="true"></div>

      <template v-for="(item, i) in renderItems" :key="item.key">
        <!-- Day divider sits ABOVE the first message of each day. -->
        <div v-if="showDay(i)" class="day-sep"><span>{{ dayLabel(itemTime(item)) }}</span></div>
        <!-- A single message. The one-element v-for aliases item.message → m so
             the bubble markup is reused unchanged. -->
        <template v-if="item.kind === 'msg'">
        <template v-for="m in [item.message]" :key="m.id">
        <!-- Call log: a centered informational row (not a bubble). Tap to call back. -->
        <div v-if="m.kind === 'call'" class="call-row" role="button" @click="onCallRow(m)">
          <ion-icon
            :icon="m.callLog?.video ? videocamOutline : callOutline"
            :class="{ 'call-missed': m.callLog?.missed }"
          />
          <span class="call-row-text">{{ m.body }}</span>
          <span v-if="m.callLog?.participants?.length" class="call-row-parts">
            {{ m.callLog.participants.join(', ') }}
          </span>
        </div>
        <!-- Selection mode: the row grows a check circle at the left edge and the
             whole row toggles on tap (bubble innards go inert via CSS, so media/
             poll/menu taps can't fire mid-selection). -->
        <div
          v-else
          class="bubble-row"
          :class="{ out: m.outgoing, 'sel-mode': selecting, 'sel-on': isSelected(m.id), 'game-row': isInlineGameRow(m) }"
          v-memo="[
            m.updatedAt,
            mediaInfo[m.mediaId!]?.posterUrl,
            swipeId === m.id ? swipeDx : 0,
            selecting,
            isSelected(m.id),
            downloadProgress[m.id],
            groupRunStart(i),
            senderAvatar(m.senderId),
          ]"
          @click="selecting && toggleSelect([m.id])"
        >
          <ion-icon
            v-if="selecting"
            class="sel-check"
            :icon="isSelected(m.id) ? checkmarkCircle : ellipseOutline"
          />
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
          <div class="bubble-col" :class="{ 'with-reactions': m.reactions?.length }">
            <div class="swipe-wrap">
              <span class="swipe-ico reply" v-show="swipeId === m.id && swipeDx > 4">
                <ion-icon :icon="arrowUndoOutline" />
              </span>
              <span class="swipe-ico trash" v-show="swipeId === m.id && swipeDx < -4">
                <ion-icon :icon="trashOutline" />
              </span>
            <div
              class="bubble"
              :class="{ out: m.outgoing, 'bubble-plain': m.videoNote && !m.deleted, 'bubble-media': mediaBubble(m), 'bubble-unseen': !m.outgoing && !m.deleted && m.seenReportedAt == null }"
              :data-mid="m.id"
              :style="swipeStyle(m.id)"
              @touchstart.passive="onSwipeStart($event, m)"
              @touchmove.passive="onSwipeMove($event)"
              @touchend.passive="onSwipeEnd()"
              @click="(e) => !m.deleted && onBubbleTap(m, e)"
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
                >{{ senderName(m.senderId, m.senderName) }}</span
              >

              <!-- Fixed-square media frames (image + non-note video) render their 240px
                   box IMMEDIATELY — even before mediaInfo resolves — so a row prepended
                   while scrolling up already has its FINAL height. Gating the whole frame
                   on mediaInfo (as voice/audio/file below still do) inserted ~0-height rows
                   that expanded to 240px once IndexedDB resolved, breaking the scroll anchor
                   and flashing the list blank mid-scroll on iOS (spec 1011). The skeleton
                   inside the frame covers the gap until the poster decodes. -->
              <!-- Tap the image → open the viewer directly; tap the empty/footer area
                   of the bubble → the action menu. -->
              <div v-if="m.kind === 'image' && m.mediaId" class="media-wrap" @click.stop="openMediaViewer(m.id)">
                <!-- Animated GIF / WebP: play the moving original while it's visible
                     on screen (freezes to the poster off-screen). Needs the full blob
                     resolved; if it was freed from the LRU, fall through to the poster. -->
                <AnimatedImage
                  v-if="mediaInfo[m.mediaId]?.animated && mediaInfo[m.mediaId]?.url"
                  :animated-url="mediaInfo[m.mediaId]!.url"
                  :poster-url="mediaInfo[m.mediaId]!.posterUrl"
                  alt="gif"
                />
                <img v-else-if="mediaInfo[m.mediaId]?.posterUrl" class="bubble-image" :src="mediaInfo[m.mediaId]!.posterUrl" alt="photo" loading="lazy" decoding="async" />
                <ion-skeleton-text v-else :animated="true" class="media-skel" />              </div>
              <!-- Video: a still thumbnail with a play button. Tapping the poster opens the
                   action menu (whole bubble is the hit target); the play button is the
                   direct affordance to the full-screen viewer. The sender-embedded
                   posterData shows even before mediaInfo resolves. -->
              <div v-else-if="m.kind === 'video' && !m.videoNote && m.mediaId" class="video-poster" @click.stop="openMediaViewer(m.id)">
                <img
                  v-if="m.posterData || mediaInfo[m.mediaId]?.posterUrl"
                  class="bubble-image"
                  :src="m.posterData || mediaInfo[m.mediaId]!.posterUrl"
                  alt="video"
                  loading="lazy"
                  decoding="async"
                />
                <ion-skeleton-text v-else :animated="true" class="media-skel" />
                <!-- Visual play affordance only; a tap anywhere on the poster opens
                     the viewer via the bubble's tap handler. -->
                <ion-icon class="play-overlay" :icon="playCircle" aria-hidden="true" />              </div>

              <!-- Non-square media (round note / voice / audio card / file chip) stays gated
                   on mediaInfo: these are text-height cards with no fixed-square frame, so
                   they don't cause the 0→240px reflow above, and they need the resolved
                   blob URL to render at all. -->
              <template v-else-if="m.mediaId && mediaInfo[m.mediaId]">
                <!-- Round video note: plays inline on tap; the action menu opens from
                     the bubble footer below. -->
                <video-note
                  v-if="m.kind === 'video' && m.videoNote"
                  :mid="m.id"
                  :src="mediaInfo[m.mediaId].url || ''"
                  :poster="mediaInfo[m.mediaId].posterUrl"
                  :duration-sec="m.durationSec"
                />
                <voice-player
                  v-else-if="m.kind === 'voice'"
                  :mid="m.id"
                  :chat-id="chatId"
                  :sender="m.outgoing ? 'You' : chat?.isGroup ? m.senderName : chat?.name ?? m.senderName"
                  :src="mediaInfo[m.mediaId].url || ''"
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
                  :rate="audioRate"
                  @toggle="toggleAudio(m.id)"
                  @seek="(f) => seekAudio(m.id, f)"
                  @cycle-speed="cycleAudioRate"
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

              <!-- Photo/video not downloaded yet (auto-download off, over the size limit, or a manual
                   fetch): the sent thumbnail + a download button. -->
              <div
                v-if="((m.kind === 'video' && !m.videoNote) || m.kind === 'image') && !m.mediaId && m.pendingMedia"
                class="video-poster pending"
                @click.stop="downloadPendingMedia(m.id)"
              >
                <img v-if="m.posterData" class="bubble-image" :src="m.posterData" :alt="m.kind" />
                <ion-skeleton-text v-else :animated="true" class="media-skel" />
                <span class="dl-btn">
                  <!-- Circular progress around the download glyph while fetching. -->
                  <svg v-if="m.id in downloadProgress" class="dl-ring" viewBox="0 0 36 36" aria-hidden="true">
                    <circle class="dl-ring-track" cx="18" cy="18" r="16" pathLength="100" />
                    <circle class="dl-ring-fill" cx="18" cy="18" r="16" pathLength="100" :stroke-dasharray="`${(downloadProgress[m.id] || 0) * 100} 100`" />
                  </svg>
                  <ion-icon :icon="downloadOutline" />
                </span>
                <!-- Attachment size (climbs live while downloading), so a large clip is obvious
                     before you spend the data. -->
                <span v-if="m.mediaSize" class="dl-size">{{ dlSizeLabel(m) }}</span>
              </div>
              <!-- Audio/file not downloaded yet: a chip with the name/size and a download button. -->
              <button
                v-else-if="(m.kind === 'audio' || m.kind === 'file') && !m.mediaId && m.pendingMedia"
                type="button"
                class="file-chip pending-chip"
                @click.stop="downloadPendingMedia(m.id)"
              >
                <span class="chip-ico">
                  <svg v-if="m.id in downloadProgress" class="dl-ring" viewBox="0 0 36 36" aria-hidden="true">
                    <circle class="dl-ring-track" cx="18" cy="18" r="16" pathLength="100" />
                    <circle class="dl-ring-fill" cx="18" cy="18" r="16" pathLength="100" :stroke-dasharray="`${(downloadProgress[m.id] || 0) * 100} 100`" />
                  </svg>
                  <ion-icon :icon="m.id in downloadProgress ? downloadOutline : (m.kind === 'audio' ? musicalNotesOutline : downloadOutline)" />
                </span>
                <span>{{ m.pendingMedia.name || (m.kind === 'audio' ? 'Audio' : 'File') }}</span>
                <span v-if="m.mediaSize" class="chip-size">{{ dlSizeLabel(m) }}</span>
              </button>

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
              <!-- In-chat game (spec 0008): board + status derived from the
                   validated move log; taps send E2EE move signals. -->
              <game-bubble
                v-else-if="m.kind === 'game' && m.game"
                :game="m.game"
                :outgoing="m.outgoing"
                :peer-name="chat?.name"
                @move="(mv) => playGameMove(chatId, m.id, mv)"
                @resign="resignGame(chatId, m.id)"
                @rematch="(gt) => onGameRematch(gt)"
                @openfs="openFullscreenGame(m.id, m.game.gameType)"
              />
              <!-- Open group challenge (spec 0009): announcement → board → withdrawn. -->
              <challenge-bubble
                v-else-if="m.kind === 'gamechallenge' && m.game"
                :game="m.game"
                :outgoing="m.outgoing"
                :self-id="selfId"
                :names="gameNames"
                @accept="acceptGameChallenge(m.id)"
                @cancel="cancelGameChallenge(m.id)"
                @move="(mv) => playGameMove(chatId, m.id, mv)"
                @resign="resignGame(chatId, m.id)"
                @rematch="(gt) => onGameRematch(gt)"
              />

              <!-- Rich link preview (generated sender-side, delivered E2EE — no
                   recipient-side fetch). Falls back to the domain-only card below
                   until the deferred preview lands (or if it couldn't be built). -->
              <a
                v-if="m.kind === 'text' && m.linkPreview"
                class="link-card rich"
                :class="{ 'lp-iconic': isIconPreview(m.linkPreview) }"
                :href="m.linkPreview.url"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop.prevent="openExternal(m.linkPreview.url)"
              >
                <!-- (spec 2035) A tiny source image (favicon-class, no real og:image)
                     renders as a fixed-size icon beside the text — a hero slot would
                     upscale it into a blurry smear (the reported YouTube card). -->
                <img v-if="m.linkPreview.image" class="lp-thumb" :src="m.linkPreview.image" alt="" />
                <span class="lp-meta">
                  <span v-if="m.linkPreview.title" class="lp-title">{{ m.linkPreview.title }}</span>
                  <span v-if="m.linkPreview.description" class="lp-desc">{{ m.linkPreview.description }}</span>
                  <span class="lp-domain">{{ m.linkPreview.domain }}</span>
                </span>
              </a>
              <!-- Domain-only card (privacy-safe: domain + icon, no remote fetch). -->
              <a
                v-else-if="m.kind === 'text' && hasLink(m.body)"
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
              <span v-if="m.body" class="text" dir="auto" :class="{ 'emoji-only': emojiBig(m.body) }"><template
                v-for="(p, pi) in bodyParts(m)"
                :key="pi"
              ><a
                  v-if="p.url"
                  class="msg-link"
                  :href="p.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  @click.stop.prevent="openExternal(p.url)"
                >{{ p.text }}</a><span
                  v-else-if="p.mention"
                  class="mention"
                  :class="{ me: p.mention.me }"
                  @click.stop="openMentionedContact(p.mention.id)"
                >@{{ p.mention.name }}</span><span
                  v-else-if="p.everyone"
                  class="mention everyone"
                >@everyone</span><a
                  v-else-if="p.contact"
                  class="msg-link"
                  role="button"
                  :href="p.contact.kind === 'phone' ? telHref(p.contact.raw) : mailtoHref(p.contact.raw)"
                  @click.stop.prevent="presentEntityActions(p.contact)"
                >{{ p.contact.raw }}</a><animated-emoji
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
              <!-- Media facts (quality · resolution · size) live in Message info now
                   (long-press → Message info), not on the bubble. -->
              <!-- Direction-aware foot: react button opposite the timestamp; sent →
                   time+tick right / react left, received → time left / react right. -->
              <div class="msg-foot" :class="m.outgoing ? 'out' : 'in'">
                <button
                  v-if="myEmojisFor(m).length < MAX_REACTIONS_PER_USER"
                  type="button"
                  class="react-btn"
                  aria-label="React"
                  @click.stop="openQuickReact(m, $event)"
                  @mousedown.prevent
                >
                  <ion-icon :icon="happyOutline" />
                </button>
                <span class="time">
                  <span v-if="m.editedAt" class="edited">edited</span>
                  <!-- Disappearing message: a small clock + time-left before it self-destructs. -->
                  <span v-if="m.expiresAt" class="ttl-left" :title="`Disappears in ${ttlLeft(m.expiresAt)}`">
                    <ion-icon :icon="timerOutline" />{{ ttlLeft(m.expiresAt) }}
                  </span>
                  <!-- Group "X/N" sits to the LEFT of the clock so it grows/shrinks into the
                       footer's floating edge (like the "edited" tag) — the clock + tick stay a
                       stable right-anchored unit and never slide as the count appears/disappears. -->
                  <span
                    v-if="m.outgoing && m.status !== 'failed' && m.receipts && m.receipts.length > 1"
                    class="tick-count"
                  >{{ tickInfo(m).fraction }}</span>
                  {{ formatClock(m.sentAt ?? m.timestamp) }}
                  <ion-icon
                    v-if="m.outgoing && m.status !== 'failed'"
                    class="tick"
                    :class="{ seen: tickInfo(m).seen }"
                    :icon="tickInfo(m).icon"
                  />
                </span>
              </div>
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
                @click.stop="onReact(m.id, g.emoji)"
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
             Tapping outside a cell reacts to the album as a whole. Selection
             treats the album as one unit (all of its messages toggle together). -->
        <div
          v-else
          class="bubble-row"
          :class="{ out: item.messages[0].outgoing, 'sel-mode': selecting, 'sel-on': isSelected(item.messages[0].id) }"
          v-memo="[
            item.messages.map((mm) => mm.updatedAt).join(),
            item.messages.map((mm) => mediaInfo[mm.mediaId!]?.posterUrl ?? '').join(),
            swipeId === item.messages[0].id ? swipeDx : 0,
            selecting,
            isSelected(item.messages[0].id),
          ]"
          @click="selecting && toggleSelect(item.messages.map((mm) => mm.id))"
        >
          <ion-icon
            v-if="selecting"
            class="sel-check"
            :icon="isSelected(item.messages[0].id) ? checkmarkCircle : ellipseOutline"
          />
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
              @touchmove.passive="onSwipeMove($event)"
              @touchend.passive="onSwipeEnd()"
              @click="(e) => onBubbleTap(item.messages[0], e)"
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
                <!-- A tap on a cell opens the menu for that specific image/video
                     (FR-001 covers the album area); "View" opens the viewer at it. -->
                <button
                  v-for="(am, idx) in albumCells(item.messages)"
                  :key="am.id"
                  type="button"
                  class="album-cell"
                  @click.stop="openMediaViewer(am.id)"
                >
                  <template v-if="am.mediaId && mediaInfo[am.mediaId]?.posterUrl">
                    <img :src="mediaInfo[am.mediaId].gridUrl || mediaInfo[am.mediaId].posterUrl" alt="" loading="lazy" decoding="async" />
                    <ion-icon v-if="am.kind === 'video'" class="play-overlay-sm" :icon="playCircle" />
                    <div v-if="idx === 3 && albumOverlay(item.messages)" class="album-more">
                      +{{ albumOverlay(item.messages) }}
                    </div>
                  </template>
                  <ion-skeleton-text v-else :animated="true" class="media-skel" />
                </button>
              </div>
              <div class="msg-foot" :class="item.messages[0].outgoing ? 'out' : 'in'">
                <button
                  v-if="myEmojisFor(item.messages[0]).length < MAX_REACTIONS_PER_USER"
                  type="button"
                  class="react-btn"
                  aria-label="React"
                  @click.stop="openQuickReact(item.messages[0], $event)"
                  @mousedown.prevent
                >
                  <ion-icon :icon="happyOutline" />
                </button>
                <span class="time">
                  <span v-if="item.messages[0].expiresAt" class="ttl-left" :title="`Disappears in ${ttlLeft(item.messages[0].expiresAt!)}`">
                    <ion-icon :icon="timerOutline" />{{ ttlLeft(item.messages[0].expiresAt!) }}
                  </span>
                  <!-- Count to the LEFT of the clock so the clock + tick stay put as it toggles. -->
                  <span
                    v-if="item.messages[0].outgoing && item.messages[item.messages.length - 1].status !== 'failed' && item.messages[item.messages.length - 1].receipts && item.messages[item.messages.length - 1].receipts!.length > 1"
                    class="tick-count"
                  >{{ tickInfo(item.messages[item.messages.length - 1]).fraction }}</span>
                  {{ formatClock(item.messages[item.messages.length - 1].timestamp) }}
                  <ion-icon
                    v-if="item.messages[0].outgoing && item.messages[item.messages.length - 1].status !== 'failed'"
                    class="tick"
                    :class="{ seen: tickInfo(item.messages[item.messages.length - 1]).seen }"
                    :icon="tickInfo(item.messages[item.messages.length - 1]).icon"
                  />
                </span>
              </div>
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
                @click.stop="onReact(item.messages[0].id, g.emoji)"
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

      <!-- Look-ahead sentinel for downward re-entry: fires loadNewer before the bottom edge
           is reached so trimmed newer rows re-mount ahead of need (spec 1011). -->
      <div ref="bottomSentinel" class="scroll-sentinel" aria-hidden="true"></div>
      <!-- Bottom spacer: reserves the height of newer messages trimmed while scrolling up.
           It's below the viewport, so its size never shifts what the user sees (cosmetic
           scroll range only); shrinks to 0 at the true bottom. -->
      <div class="vscroll-pad" :style="{ height: botPadPx + 'px' }" aria-hidden="true"></div>

      <div v-if="rows.length === 0" class="empty">
        <ion-note>{{ search ? 'No matching messages' : 'No messages yet' }}</ion-note>
      </div>
      </div>
      <!-- Floating "scroll to latest" control (spec 1012 → expanding pill, spec 1013): fades in
           when scrolled up, taps to the first unread (or newest). At rest it's a circle (chevron
           only); when there are messages to catch up to it expands into a stadium/pill with the
           count shown INLINE next to the chevron (not a corner badge). An ion-fab inside
           ion-content auto-sits above the composer and tracks the keyboard. -->
      <ion-fab
        slot="fixed"
        vertical="bottom"
        horizontal="end"
        class="jump-fab"
        :class="{ 'jump-hidden': !jumpVisible }"
        :aria-hidden="!jumpVisible"
      >
        <ion-fab-button
          size="small"
          class="jump-btn"
          :class="{ 'jump-btn-pill': unreadCount > 0 }"
          :style="{ width: pillWidth + 'px' }"
          :aria-label="jumpLabel"
          :tabindex="jumpVisible ? 0 : -1"
          @click="onJumpToLatest"
        >
          <!-- Chevron + inline count. The count span is ALWAYS in the DOM (no v-if) so it can
               animate both ways; the `.jump-btn-pill` class expands/collapses it via max-width +
               opacity, and the auto-width button tracks it for a smooth grow/shrink. -->
          <span class="jump-inner">
            <ion-icon :icon="chevronDownOutline" class="jump-chevron" />
            <span class="jump-count" aria-hidden="true">{{ unreadCount > 0 ? jumpBadge : '' }}</span>
          </span>
        </ion-fab-button>
      </ion-fab>
    </ion-content>

    <ion-footer id="chat-footer">
      <!-- @-mention autocomplete (spec 1020): group members (+ owner-only @everyone)
           matching the @token being typed; tap to insert. -->
      <div v-if="mentionCandidates.length" class="mention-pop">
        <button
          v-for="c in mentionCandidates"
          :key="c.everyone ? '@everyone' : c.id"
          type="button"
          class="mention-row"
          @mousedown.prevent
          @click="pickMention(c)"
        >
          <ion-icon v-if="c.everyone" :icon="megaphoneOutline" class="mention-row-ico" />
          <span class="mention-row-name">{{ c.everyone ? 'Everyone' : c.name }}</span>
          <span v-if="!c.everyone" class="mention-row-handle">@{{ c.username }}</span>
        </button>
      </div>
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
      <!-- Editing one of your own messages: the original is shown above the
           composer (reply-bar styling), the textarea holds the editable text,
           and Send applies the edit instead of sending a new message. -->
      <ion-toolbar v-if="editingMsg && !chat?.pending" class="reply-bar">
        <div class="reply-preview">
          <div class="reply-quote">
            <span class="reply-ref-author">Edit message</span>
            <span class="reply-ref-text" dir="auto">{{ editingMsg.body }}</span>
          </div>
          <ion-button fill="clear" aria-label="Cancel edit" @click="cancelEdit">
            <ion-icon slot="icon-only" :icon="closeOutline" />
          </ion-button>
        </div>
      </ion-toolbar>
      <!-- Media staged in the composer, waiting to be sent: image/video thumbnails and
           file chips above the textarea (each removable); whatever is typed below goes
           out as the caption when Send is tapped. Picked AND pasted media land here
           (spec 1023), so library photos can be captioned just like a paste. -->
      <ion-toolbar v-if="pendingMedia.length" class="paste-bar">
       <div class="paste-stack">
        <div class="paste-row">
          <div
            v-for="(p, i) in pendingMedia"
            :key="p.id"
            class="paste-thumb"
            :class="{ 'is-file': p.kind === 'file', 'has-cap': !!p.caption }"
          >
            <!-- Tapping a staged item captions just that one (overrides the shared caption). -->
            <button
              type="button"
              class="paste-tap"
              :aria-label="p.caption ? 'Edit caption for this item' : 'Add a caption to this item'"
              @click="editItemCaption(i)"
            >
              <img v-if="p.kind === 'image' && p.url" :src="p.url" alt="Attachment" />
              <template v-else-if="p.kind === 'video'">
                <!-- iOS never paints a frame into a <video> until it's played, so we generate a
                     first-frame poster off-screen (canvas) and show that. Spinner until it settles. -->
                <img v-if="p.poster" :src="p.poster" alt="Attachment" />
                <div v-else class="paste-vid">
                  <ion-spinner v-if="!p.ready" name="crescent" class="paste-loading" />
                </div>
                <ion-icon class="paste-play" :icon="playCircle" />
              </template>
              <div v-else class="paste-file">
                <ion-icon :icon="documentOutline" />
                <span class="paste-file-name">{{ p.blob.name || 'File' }}</span>
              </div>
              <ion-icon v-if="p.caption" class="paste-cap-badge" :icon="chatbubbleEllipses" />
              <!-- Top-left pen hints that tapping edits this item's caption (otherwise undiscoverable). -->
              <span v-else class="paste-cap-hint"><ion-icon :icon="createOutline" /></span>
            </button>
            <button type="button" class="paste-x" aria-label="Remove attachment" @click="removePendingMedia(p.id)">
              <ion-icon :icon="closeOutline" />
            </button>
          </div>
        </div>
        <!-- 2+ photos/videos: send as one swipeable album (default) or separate messages. On its own
             row (not squeezed beside the thumbnails) with a lead-in label so the choice is clear. -->
        <div v-if="albumChoiceVisible" class="send-mode">
          <span class="send-mode-label">Send as</span>
          <ion-segment
            :value="sendAsAlbum ? 'album' : 'individual'"
            mode="ios"
            @ion-change="sendAsAlbum = ($event.detail.value as string) === 'album'"
          >
            <ion-segment-button value="album">
              <ion-icon :icon="albumsOutline" />
              <ion-label>Album</ion-label>
            </ion-segment-button>
            <ion-segment-button value="individual">
              <ion-icon :icon="imagesOutline" />
              <ion-label>Separate</ion-label>
            </ion-segment-button>
          </ion-segment>
        </div>
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
        <!-- Recording mode. Capturing: delete · live waveform + timer · pause · send.
             Paused (preview): delete · play-back + speed + waveform · resume (mic) · send. -->
        <template v-if="recording">
          <ion-buttons slot="start">
            <ion-button color="danger" aria-label="Delete recording" @click="cancelRecording">
              <ion-icon slot="icon-only" :icon="trashOutline" />
            </ion-button>
          </ion-buttons>
          <div class="rec-status">
            <!-- Paused → hear back what you recorded; capturing → live record dot. -->
            <button
              v-if="recPaused"
              type="button"
              class="rec-preview"
              :aria-label="recPlaying ? 'Pause preview' : 'Play preview'"
              @click="togglePreview"
            >
              <ion-icon :icon="recPlaying ? pause : play" />
            </button>
            <span v-else class="rec-dot"></span>
            <div class="rec-wave">
              <span
                v-for="(h, i) in recBars"
                :key="i"
                class="rec-bar"
                :style="{ height: barH(h) }"
              />
            </div>
            <speed-pill v-if="recPaused" :rate="recRate" @cycle="cycleRecRate" />
            <span class="rec-time">{{ recElapsed }}</span>
          </div>
          <ion-buttons slot="end">
            <ion-button
              :aria-label="recPaused ? 'Resume recording' : 'Pause'"
              @click="togglePause"
            >
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
            <ion-button color="primary" @click="openAttach">
              <ion-icon slot="icon-only" :icon="addOutline" />
            </ion-button>
          </ion-buttons>
          <!-- Auto-growing multi-line textarea so long messages wrap and the box
               grows (capped in CSS, then scrolls). autocapitalize/autocorrect/
               spellcheck on → the OS keyboard offers predictive text & suggestions.
               On a physical keyboard (desktop) Enter sends and Shift+Enter inserts a
               line break (v-enter-send); on touch the Return key inserts a line break
               and you send with the button. -->
          <ion-textarea
            ref="composerEl"
            :key="composerKey"
            v-enter-send="send"
            class="composer"
            :value="draft"
            :placeholder="pendingMedia.length ? 'Add a caption' : 'Message'"
            :auto-grow="true"
            :rows="1"
            :maxlength="pendingMedia.length ? CAPTION_MAX : undefined"
            autocapitalize="sentences"
            autocorrect="on"
            :spellcheck="true"
            enterkeyhint="enter"
            @ion-input="onComposerInput"
            @ion-focus="onComposerFocus"
            @ion-blur="onComposerBlur"
            @keydown.enter="onComposerEnter"
            @paste="onComposerPaste"
          />
          <ion-buttons slot="end">
            <!-- Per-message disappearing timer (sticky until changed): green when messages you send
                 will disappear (an override, or the chat's default), grey when they won't. -->
            <ion-button
              :aria-label="`Disappearing timer: ${msgTtlLabel}`"
              :color="effectiveTtlMs ? 'primary' : 'medium'"
              class="ttl-btn"
              :class="{ 'has-badge': !!effectiveTtlMs }"
              @click="openMsgTtl"
            >
              <!-- Icon + duration stacked vertically so the badge sits cleanly under the clock. -->
              <span class="ttl-stack">
                <ion-icon :icon="timerOutline" aria-hidden="true" />
                <span v-if="effectiveTtlMs" class="ttl-badge">{{ msgTtlShort }}</span>
              </span>
            </ion-button>
            <!-- @mousedown.prevent (NOT pointerdown): keeps the tap from stealing focus
                 (keyboard stays open) without cancelling the click. Cancelling pointerdown
                 suppresses the synthesized click entirely on iPadOS — dead button (spec 2032). -->
            <ion-button
              v-if="draft.trim() || pendingMedia.length"
              color="primary"
              aria-label="Send"
              @click="send"
              @mousedown.prevent
            >
              <ion-icon slot="icon-only" :icon="sendOutline" />
            </ion-button>
            <template v-else>
              <!-- Tap = camera; hold ~0.6s = round video note. -->
              <ion-button
                color="primary"
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

    <!-- Per-item caption editor. A standard full ion-modal (header toolbar + ion-content) rather than
         a partial sheet: ion-content handles the keyboard inset itself, so the field stays put instead
         of being shoved off-screen the way the alert (and a breakpoint sheet) were on iOS. -->
    <ion-modal
      :is-open="captionSheet.open"
      class="caption-modal"
      @did-dismiss="captionSheet.open = false"
      @did-present="focusCaptionInput"
    >
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="captionSheet.open = false">Cancel</ion-button>
          </ion-buttons>
          <ion-title>Caption</ion-title>
          <ion-buttons slot="end">
            <ion-button strong @click="saveItemCaption">Save</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <!-- Preview of exactly what's being captioned. For a video it's the generated poster —
             the same frame that rides in the message — so it doubles as a quality check. -->
        <div v-if="captionItem" class="caption-preview">
          <img v-if="captionItem.kind === 'image' && captionItem.url" :src="captionItem.url" alt="Attachment preview" />
          <template v-else-if="captionItem.kind === 'video'">
            <img v-if="captionItem.poster" :src="captionItem.poster" alt="Video preview" />
            <div v-else class="caption-preview-video"><ion-spinner name="crescent" /></div>
            <ion-icon v-if="captionItem.poster" class="caption-preview-play" :icon="playCircle" />
          </template>
          <div v-else class="caption-preview-file">
            <ion-icon :icon="documentOutline" />
            <span>{{ captionItem.blob.name || 'File' }}</span>
          </div>
        </div>
        <ion-item lines="none" class="caption-input-item">
          <ion-textarea
            ref="captionInputEl"
            :value="captionSheet.text"
            placeholder="Add a caption…"
            :maxlength="CAPTION_MAX"
            :auto-grow="true"
            :rows="2"
            autocapitalize="sentences"
            autocorrect="on"
            @ion-input="onCaptionInput"
          />
        </ion-item>
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
      @save="onViewerSave"
      @caption="onViewerCaption"
      @goto="onViewerGoto"
      @allmedia="onViewerAllMedia"
      @index="onViewerIndex"
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
    <game-picker :open="gamePickerOpen" @pick="onGamePick" @close="gamePickerOpen = false" />
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
import UserAvatar from '@/components/UserAvatar.vue';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonBackButton, IonIcon, IonSearchbar, IonContent, IonFooter, IonTextarea,
  IonAvatar, IonNote, IonModal, IonSpinner, IonDatetime, actionSheetController, alertController, popoverController,
  IonInfiniteScroll, IonInfiniteScrollContent, IonFab, IonFabButton,
  IonSegment, IonSegmentButton, IonLabel,
  onIonViewWillEnter, onIonViewDidEnter, onIonViewWillLeave,
} from '@ionic/vue';
import type { InfiniteScrollCustomEvent } from '@ionic/vue';
import {
  callOutline, videocamOutline, documentOutline, playCircle, play, sendOutline,
  timeOutline, checkmark, checkmarkDone, addOutline, happyOutline, cameraOutline, megaphoneOutline, atOutline,
  micOutline, trashOutline, closeOutline, pause, banOutline, arrowRedoOutline, arrowUndoOutline, globeOutline,
  locationOutline, barChartOutline, personOutline, refreshOutline, downloadOutline,
  imageOutline, musicalNotesOutline, calendarOutline, checkmarkCircle, ellipseOutline,
  chevronDownOutline, chatbubbleEllipses, albumsOutline, imagesOutline, createOutline, timerOutline,
} from 'ionicons/icons';
import {
  getChat, getContact, listAllContacts, markChatRead, sendMediaMessage, sendMessage,
  reactToMessage, deleteMessage, softDeleteMessage, deleteMessageForEveryone, editMessage,
  toggleFavorite, setCaption, forwardMessage,
  quickReactEmojis,
  MAX_REACTIONS_PER_USER, MAX_DISTINCT_REACTIONS,
  retryMediaMessage, resumePendingMediaJobs, downloadMessageMedia,
  sendLocation, sendPoll, sendContact, votePoll, messageSharedContact,
  sendGame, playGameMove, resignGame, hasOngoingGame,
  sendGameChallenge, acceptGameChallenge, cancelGameChallenge,
  unblockContact, detectTerminated, firstMessageOnOrAfter, countUnread,
  CAPTION_MAX, getSetting, listChatMediaAll, getMessage, listMessagesOlder,
  backfillThumbTiers, getDraft, saveDraft, clearDraft, getDraftMedia, saveDraftMedia, clearDraftMedia,
} from '@/db/queries';
import { appToast } from '@/services/toast';
import { describeMediaError } from '@/services/media-errors';
import { hasRoomFor } from '@/services/storage-estimate';
import { groupProgress } from '@/services/message-status';
import { getSelfUserId, getSelfUsername } from '@/services/auth';
import MessageActions from '@/components/MessageActions.vue';
import QuickReactBar from '@/components/QuickReactBar.vue';
import ReactionDetails from '@/components/ReactionDetails.vue';
import VoicePlayer from '@/components/VoicePlayer.vue';
import VideoNote from '@/components/VideoNote.vue';
import AnimatedImage from '@/components/AnimatedImage.vue';
import VideoNoteRecorder from '@/components/VideoNoteRecorder.vue';
import MediaViewer from '@/components/MediaViewer.vue';
import { saveMessagesMedia } from '@/services/media-save';
import ForwardPicker from '@/components/ForwardPicker.vue';
import LocationBubble from '@/components/LocationBubble.vue';
import PollBubble from '@/components/PollBubble.vue';
import ContactBubble from '@/components/ContactBubble.vue';
import GameBubble from '@/components/GameBubble.vue';
import { GAMES } from '@/games/registry';
import { deriveStatus as deriveGameStatus } from '@/games/session';
import { challengePhase } from '@/games/challenge';
import { openGame } from '@/composables/useGameOverlay';
import ChallengeBubble from '@/components/ChallengeBubble.vue';
import GamePicker from '@/components/GamePicker.vue';
import PollComposer from '@/components/PollComposer.vue';
import ContactPicker from '@/components/ContactPicker.vue';
import LocationComposer from '@/components/LocationComposer.vue';
import AudioCard from '@/components/AudioCard.vue';
import SpeedPill from '@/components/SpeedPill.vue';
import { nextRate, playWhenReady } from '@/utils/playback';
import AudioReview from '@/components/AudioReview.vue';
import Emoji from '@/components/Emoji.vue';
import AnimatedEmoji from '@/components/AnimatedEmoji.vue';
import { segmentEmoji, emojiOnlyCount } from '@/utils/emoji';
import { userColorBright } from '@/utils/user-color';
import { useAnimationPrefs } from '@/composables/useAnimationPrefs';
import { jobProgress } from '@/services/media-jobs';
import { generateVideoPoster, generateImageThumb, isAnimatedImage } from '@/utils/media-meta';
import { type Quality } from '@/services/media-encode';
import { openExternal } from '@/utils/external';
import { segmentContacts, telHref, mailtoHref } from '@/utils/linkify';
import { presentEntityActions, type ContactEntity } from '@/services/entity-actions';
import { selectEvictions } from '@/utils/lru';
import { normalizeOutgoing } from '@/utils/text';
import { vEnterSend } from '@/directives/enter-send';
import { formatBytes } from '@/utils/bytes';
import { readAudioTags, readAudioDuration } from '@/utils/id3';
import { get, put } from '@/db/idb';
import type { Chat, Contact, Media, Message, MessageStatus, Reaction, ReplyRef, SharedContact, DraftMediaItem } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useChatHistory } from '@/composables/useChatHistory';
import { LOOK_AHEAD_PX } from '@/utils/chat-window';
import { pickAnchor, resolveAnchorDelta, shouldDeferScrollWrite, isSelfEcho } from '@/utils/scroll-anchor';
import { isRunStart as isRunStartEdge, showDay as showDayEdge } from '@/utils/chat-grouping';
import { jumpButtonVisible, unreadSince, seenFrontier } from '@/utils/chat-unread';
import {
  audioCurId, audioPlaying, audioProgress, audioRate,
  playAudio, seekAudioFrac, cycleAudioRate, stopAudio, detachAudioEnded,
  type AudioTrackMeta,
} from '@/composables/useAudioPlayer';
import { isUnlocked, isUnlockedNow } from '@/services/crypto/identity';
import { reportSeenUpTo, sendDownloadedReceipts, sendActivity, sendGroupActivity, useSync } from '@/composables/useSync';
import { peerPresence, presenceLabel } from '@/composables/usePresence';
import { activityFor, activityKindLabel, coalescedActivityLabel } from '@/composables/useTyping';
import { ACTIVITY, type ActivityKind, type ActivityState } from '@/services/transport';
import { startDirectCall, startGroupCall } from '@/composables/useCall';
import { VIDEO_MAX, AUDIO_MAX } from '@/services/call/types';
import { ensureProfile } from '@/composables/useProfileGate';
import { setActiveChat } from '@/services/notify';
import { formatClock, dayLabel, formatStamp, formatFull } from '@/utils/time';

const route = useRoute();
const router = useRouter();
const chatId = route.params.id as string;

// Online / last-seen line under the contact name (1:1 only; '' when unknown).
// While the peer is composing, a transient activity indicator ("typing…",
// "recording audio…", "recording video…") OVERRIDES the presence line (spec 1009).
const statusLine = computed(() => {
  const c = chat.value;
  if (!c) return '';
  if (c.isGroup) {
    // Groups have no presence line; show per-sender activity only while someone's
    // composing — "Alice is typing…" / "Alice, Bob…" / "several people…" (US5).
    return coalescedActivityLabel(c.id, (id) => contactsMap.value.get(id)?.name ?? 'Someone');
  }
  const peer = c.participantIds[0];
  if (!peer) return '';
  const active = activityFor(peer); // reactive: peer's current activity (1:1 keyed by peer id)
  if (active.length) return activityKindLabel(active[0].kind);
  return presenceLabel(peerPresence(peer));
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
// Tapping a call-log row calls back, in the same mode (voice/video) as the logged call.
function onCallRow(m: Message): void {
  void startCall(m.callLog?.video ? 'Video' : 'Voice');
}

async function startCall(kind: 'Voice' | 'Video') {
  const c = chat.value;
  if (!c) return;
  const k = kind === 'Video' ? 'video' : 'audio';
  if (c.isGroup) {
    // Participant cap (spec 0004 US3): the call includes us, so members + 1 must fit the
    // kind's cap (4 video / 8 audio). The server enforces this authoritatively at join too.
    const cap = k === 'video' ? VIDEO_MAX : AUDIO_MAX;
    if (c.participantIds.length + 1 > cap) {
      await appToast({ message: `A ${k} call is limited to ${cap} people`, duration: 2200 });
      return;
    }
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
    await appToast({ message: 'Could not unblock. Try again.', duration: 1500, color: 'danger' });
  }
}

// Jump-to-date: pick a day → scroll to the first message on/after it, then close search.
const datePickerOpen = ref(false);
async function onPickDate(ev: CustomEvent): Promise<void> {
  const val = (ev.detail as { value?: string | string[] | null }).value;
  datePickerOpen.value = false;
  const iso = Array.isArray(val) ? val[0] : val;
  if (!iso) return;
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  const id = await firstMessageOnOrAfter(chatId, day.getTime());
  if (!id) {
    await appToast({ message: 'No messages on or after that date', duration: 1500 });
    return;
  }
  showSearch.value = false;
  search.value = '';
  // scrollToMessage now seeks (loads intervening history) when the target is older than
  // the loaded window, so a jump-to-date far above the window lands correctly (D7).
  await nextTick();
  await scrollToMessage(id);
}

function closeSearch() {
  showSearch.value = false;
  search.value = '';
}

// Fetch a deferred (not-yet-downloaded) video's full clip on tap.
// Per-message download progress (0..1) while a deferred attachment is being fetched; presence in the
// map means "downloading now" and drives the circular progress ring on the download button.
const downloadProgress = reactive<Record<string, number>>({});
async function downloadPendingMedia(id: string): Promise<void> {
  if (id in downloadProgress) return;
  downloadProgress[id] = 0;
  try {
    await downloadMessageMedia(id, (f) => (downloadProgress[id] = f));
  } catch {
    /* leave it pending so the user can tap again */
  } finally {
    delete downloadProgress[id];
  }
}
// The size label on a not-yet-downloaded attachment: just the total when idle, or a live
// "downloaded / total" counter (e.g. "45.2 MB / 127.8 MB") that climbs while it downloads.
function dlSizeLabel(m: Message): string {
  const total = m.mediaSize || 0;
  if (!total) return '';
  const p = downloadProgress[m.id];
  return p === undefined ? formatBytes(total) : `${formatBytes(p * total)} / ${formatBytes(total)}`;
}


// Encode / upload progress as a "42%" string for the in-flight bars.
function jobPct(id: string, phase: 'compress' | 'upload'): string {
  return `${Math.round((jobProgress[id]?.[phase] ?? 0) * 100)}%`;
}

function statusIcon(status: MessageStatus) {
  if (status === 'compressing' || status === 'pending') return timeOutline;
  if (status === 'sent') return checkmark;
  return checkmarkDone; // delivered & seen
}

// The "Seen receipts" privacy preference (default on), reactive. Drives the
// reciprocity DISPLAY gate (spec 1010 FR-009): when off we don't render the seen
// tier on our own sent messages (it caps at delivered), mirroring the emit gate in
// useSync.
const seenReceiptsOn = useLiveQuery(
  () => getSetting<boolean>('privacy.seenReceipts', true),
  ['settings'],
  true,
);

// Compact per-bubble status for an outgoing message: the tick icon, whether to
// tint it "seen-blue", and the optional GROUP "X/N" fraction (spec 1010 FR-004/005).
// Groups derive complete-the-tier progress from receipts[] (N = recipients); 1:1
// shows the plain tick. The fraction appears only while a tier is partial — so a
// fully-seen group, an N=1 group, and every 1:1 render with no fraction.
function tickInfo(m: Message): { icon: string; seen: boolean; fraction: string | null } {
  if (m.status === 'compressing' || m.status === 'pending') {
    return { icon: timeOutline, seen: false, fraction: null };
  }
  if (chat.value?.isGroup && m.receipts?.length) {
    const p = groupProgress(m, seenReceiptsOn.value);
    return {
      icon: p && p.tier === 'sent' ? checkmark : checkmarkDone,
      seen: p?.tier === 'seen',
      fraction: p?.label ?? null,
    };
  }
  return { icon: statusIcon(m.status), seen: seenReceiptsOn.value && m.status === 'seen', fraction: null };
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
// The user's own reactions on a message (up to 3), to highlight them in the picker.
const myEmojisFor = (m: Message) =>
  (m.reactions ?? []).filter((r) => r.userId === selfId).map((r) => r.emoji);

// React, surfacing the 3-reaction cap if it's hit (tapping a chip or a quick emoji).
async function onReact(messageId: string, emoji: string): Promise<void> {
  const result = await reactToMessage(messageId, emoji);
  if (result === 'limit' || result === 'limit-emojis') {
    await appToast({
      message:
        result === 'limit-emojis'
          ? `This message already has ${MAX_DISTINCT_REACTIONS} different reactions — tap one of those instead.`
          : `You can add up to ${MAX_REACTIONS_PER_USER} reactions.`,
      duration: 1600,
    });
  }
}

// The true predecessor message of render-item i: the previous rendered item's last message.
// The whole loaded run is rendered, so for i > 0 the predecessor is always present; the very
// first rendered item is the oldest loaded row (its day-divider/avatar is correct for the
// top of the loaded run, and recomputes naturally when older rows prepend).
function prevMsgFor(i: number): Message | null {
  if (i <= 0) return null;
  const prev = renderItems.value[i - 1];
  if (!prev) return null;
  return prev.kind === 'msg' ? prev.message : prev.messages[prev.messages.length - 1];
}

// Whether an item starts a new day (the divider renders above it). True for the
// oldest loaded item too.
function showDay(i: number): boolean {
  const cur = renderItems.value[i];
  if (!cur) return false;
  const prev = prevMsgFor(i);
  return showDayEdge(prev ? { timestamp: prev.timestamp } : null, { timestamp: itemTime(cur) });
}

/* ---- media viewer (over ALL the chat's media) ---- */
// Every image/video in the chat, chronological. The viewer shows them all and
// starts at whichever one was tapped (in a bubble or an album).
// ALL the chat's image/video media (not gated on being resolved), so the viewer can
// span the whole chat. Memory is bounded by resolving/rendering only a small window
// around the current item (resolveViewerWindow), never the whole set at once — that
// all-at-once decode was crashing the web view (OOM) on media-heavy chats.
const chatMediaMsgs = computed(() =>
  allMedia.value.filter((m) => (m.kind === 'image' || (m.kind === 'video' && !m.videoNote)) && m.mediaId),
);
const viewer = ref<{ open: boolean; start: number }>({ open: false, start: 0 });
const viewerItems = computed(() => {
  // Only build the (whole-chat) viewer list while the viewer is open. Otherwise this
  // O(all-media) map + formatFull + groupedReactions would re-run on every mediaInfo
  // mutation as thumbnails decode during scroll — pure waste on the scroll hot path.
  if (!viewer.value.open) return [];
  return chatMediaMsgs.value.map((m) => {
    const mi = mediaInfo.value[m.mediaId!];
    return {
      id: m.id,
      url: mi?.url ?? '', // '' until this item's window is resolved
      thumb: mi?.posterUrl || m.posterData || mi?.stripUrl || mi?.url || '', // large poster tier for the full-screen viewer (spec 1025 US4)
      kind: m.kind === 'video' ? 'video' : 'image',
      caption: m.body,
      senderName: m.outgoing ? 'You' : chat.value?.isGroup ? m.senderName : chat.value?.name ?? m.senderName,
      when: formatFull(m.timestamp),
      outgoing: m.outgoing,
      favorite: !!m.favorite,
      reactions: groupedReactions(m.reactions).map((g) => ({ emoji: g.emoji, count: g.count })),
    };
  });
});
// Resolve (+ pin against eviction) only the current viewer item and its neighbours, so
// at most ~3 full-res media are ever decoded at once.
async function resolveViewerWindow(i: number): Promise<void> {
  const list = chatMediaMsgs.value;
  const near = [list[i - 1], list[i], list[i + 1]].filter((m): m is Message => !!m);
  await resolveMediaFor(near);
  viewerPins.value = new Set(near.map((m) => m.mediaId!).filter(Boolean));
}
// Tapping any media opens the viewer at that item; the viewer can swipe across the
// whole chat's media, resolving each window on demand as you go.
async function openMediaViewer(msgId: string): Promise<void> {
  const start = Math.max(0, chatMediaMsgs.value.findIndex((m) => m.id === msgId));
  await resolveViewerWindow(start);
  await nextTick();
  viewer.value = { open: true, start };
}
// As the viewer moves, resolve the window around the new index and evict the rest.
function onViewerIndex(i: number): void {
  void resolveViewerWindow(i).then(() => evictMedia());
}
function onViewerDismiss(id: string): void {
  viewer.value.open = false;
  // Unpin the chat's media so the bounded cache can reclaim what's off-screen.
  viewerPins.value = new Set();
  evictMedia();
  // scrollToMessage maps album members to the album's first id (centralized), so pass the raw id.
  void nextTick(() => scrollToMessage(id));
}

const viewerMsg = (id: string) => allMedia.value.find((m) => m.id === id);
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
function onViewerSave(id: string): void {
  void saveMediaForMessages([id]);
}

// All message ids in an album (oldest first), for "Save all".
function albumMessageIds(m: Message): string[] {
  if (!m.albumId) return [m.id];
  return allMedia.value
    .filter((x) => x.albumId === m.albumId && !x.deleted)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((x) => x.id);
}

// Save one or more messages' media to the device, with a brief confirmation. The
// share sheet ('shared') and a user-cancelled sheet ('cancelled') need no toast;
// a direct download does, and an empty/failed set warns.
async function saveMediaForMessages(ids: string[]): Promise<void> {
  let result: Awaited<ReturnType<typeof saveMessagesMedia>>;
  try {
    result = await saveMessagesMedia(ids);
  } catch {
    result = 'empty';
  }
  const msg = result === 'downloaded' ? 'Saved to your device' : result === 'empty' ? 'Nothing to save' : '';
  if (!msg) return;
  await appToast({
    message: msg,
    duration: 1500,
    color: result === 'empty' ? 'danger' : undefined,
  });
}
async function onViewerCaption(id: string): Promise<void> {
  const m = viewerMsg(id);
  const alert = await alertController.create({
    header: 'Caption',
    inputs: [{ name: 'cap', type: 'textarea', value: m?.body ?? '', placeholder: 'Add a caption', attributes: { maxlength: CAPTION_MAX } }],
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

// The two per-message popups (quick-react + full menu) are mutually exclusive and must
// never linger over another view. We track the open one and dismiss it before opening
// either, and on leaving the chat (covers the back button AND the swipe-back gesture).
let openPopover: HTMLIonPopoverElement | null = null;
async function dismissOpenPopovers(): Promise<void> {
  const p = openPopover;
  openPopover = null;
  if (p) {
    try {
      await p.dismiss();
    } catch {
      /* already dismissing */
    }
  }
}

// Pick the popover side so it stays on screen: open downward in the top half of the
// viewport, upward in the bottom half.
const popoverSide = (ev: Event): 'top' | 'bottom' =>
  ((ev as MouseEvent).clientY ?? window.innerHeight) < window.innerHeight / 2 ? 'bottom' : 'top';

// Tap on the reaction button → a transient popover of the 7 most-used emoji + "+".
async function openQuickReact(m: Message, ev: Event): Promise<void> {
  await dismissOpenPopovers();
  // When the message is at the distinct-emoji cap, offer ONLY its existing emojis
  // (and drop the "+ more" picker) — you can react with what's there but can't add a
  // new one (spec: max MAX_DISTINCT_REACTIONS different emojis per message).
  const existing = [...new Set((m.reactions ?? []).map((r) => r.emoji))];
  const atEmojiCap = existing.length >= MAX_DISTINCT_REACTIONS;
  const popover = await popoverController.create({
    component: QuickReactBar,
    cssClass: 'reaction-popover quick-react-popover',
    componentProps: { myEmojis: myEmojisFor(m), quick: await quickReactEmojis(5), existing, atEmojiCap },
    event: ev,
    reference: 'event',
    side: popoverSide(ev),
    alignment: 'center',
    showBackdrop: false, // don't dim the chat behind the popover
    keyboardClose: false, // reacting must NOT dismiss the keyboard if the composer is focused
  });
  openPopover = popover;
  await popover.present();
  const { data } = await popover.onWillDismiss();
  if (openPopover === popover) openPopover = null;
  if (!data) return;
  if (data.action === 'react') await onReact(m.id, data.emoji);
  else if (data.action === 'more') await openEmojiPicker(m);
}

// Long-press a bubble → the full action menu (reply/forward/edit/…); reactions now live
// in the bottom-row quick-react button, so the menu no longer carries the emoji row.
async function openMenu(m: Message, ev: Event) {
  await dismissOpenPopovers();
  // A single image/video/file/audio offers "Save"; an album bubble offers "Save all".
  const SAVE_KINDS = ['image', 'video', 'file', 'audio', 'voice'];
  const canSaveAll = !!m.albumId;
  const canSave = !canSaveAll && SAVE_KINDS.includes(m.kind) && (!!m.mediaId || !!m.pendingMedia);
  // Media is reachable by tapping it, but "View" stays in the menu as a fallback.
  const canView = (m.kind === 'image' || m.kind === 'video') && !m.videoNote && !!m.mediaId;
  // Message info is offered for every outgoing message (receipts) AND for any media
  // message in either direction (so the metadata — quality/resolution/size — is
  // reachable on received media too, not just your own).
  const hasMedia = !!m.mediaId && ['image', 'video', 'file', 'audio', 'voice'].includes(m.kind);
  const popover = await popoverController.create({
    component: MessageActions,
    cssClass: 'reaction-popover',
    componentProps: {
      isOutgoing: m.outgoing,
      // Games get info in BOTH directions: the stats (FR-024) are as much the
      // receiver's story as the sender's.
      canInfo: m.outgoing || hasMedia || m.kind === 'game',
      canCopy: !!m.body,
      canView,
      canForward: m.kind !== 'game' && m.kind !== 'gamechallenge', // a game belongs to its conversation (spec 0008 FR-014)
      canReply: m.kind !== 'game' && m.kind !== 'gamechallenge', // a shared board isn't a quotable line
      canDelete: !gameLocked(m), // a live board can't be ripped out from under the players
      canEdit: m.outgoing && m.kind === 'text' && !m.deleted,
      canSave,
      canSaveAll,
      reactionCount: m.reactions?.length ?? 0,
    },
    event: ev,
    reference: 'event',
    side: popoverSide(ev),
    alignment: 'center',
    showBackdrop: false, // don't dim the chat behind the popover
  });
  openPopover = popover;
  await popover.present();
  const { data } = await popover.onWillDismiss();
  if (openPopover === popover) openPopover = null;
  if (!data) return;
  if (data.action === 'view') openMediaViewer(m.id);
  else if (data.action === 'details') await openReactionDetails(m);
  else if (data.action === 'reply') void startReply(m);
  else if (data.action === 'forward') openForward(m.id);
  else if (data.action === 'save') void saveMediaForMessages([m.id]);
  else if (data.action === 'saveAll') void saveMediaForMessages(albumMessageIds(m));
  else if (data.action === 'info') router.push(`/chat/${chatId}/info/${m.id}`);
  else if (data.action === 'copy') navigator.clipboard?.writeText(m.body).catch(() => {});
  else if (data.action === 'edit') startEdit(m);
  else if (data.action === 'select') enterSelect(m);
  else if (data.action === 'delete') void confirmDelete(m);
}

// A tap on the bubble itself — the whole text message, or the empty/footer area of a
// media bubble — opens the action menu. Media elements stop propagation and open the
// viewer instead; the react button opens the quick-react popover. No long-press.
function onBubbleTap(m: Message, ev: Event): void {
  if (m.deleted) return;
  // Game boards are dense interactive surfaces — a stray tap between cells must
  // not summon the message menu. For games, only the footer strip (timestamp +
  // reactions) opens it.
  if (
    (m.kind === 'game' || m.kind === 'gamechallenge') &&
    !(ev.target as HTMLElement | null)?.closest?.('.msg-foot')
  ) {
    return;
  }
  void openMenu(m, ev);
}

/* ---- forwarding ---- */
const LINK_RE = /\bhttps?:\/\/[^\s]+/i;
const hasLink = (s: string) => LINK_RE.test(s);
const linkOf = (s: string) => s.match(LINK_RE)?.[0] ?? '';
// (spec 2035) A preview whose image is favicon-class (tiny natural width) renders
// as a compact icon card — the hero slot would upscale it into a blurry smear.
// Previews without a recorded width (older senders) keep the hero presentation.
const isIconPreview = (lp: { image?: string; imageWidth?: number }): boolean =>
  !!lp.image && lp.imageWidth !== undefined && lp.imageWidth < 200;
const linkDomain = (s: string) => {
  try {
    return new URL(linkOf(s)).hostname.replace(/^www\./, '');
  } catch {
    return linkOf(s);
  }
};
// Split body text into plain runs and clickable URL runs (to linkify messages).
// Split a body into render segments: links, emoji (Noto-animated), and text.
// A group's members by @username → { id, current display name } (spec 1020), so a
// mention token in a body resolves to a member and renders with their CURRENT name.
// Includes self (so "@myhandle" highlights as me). Empty for 1:1 chats.
const mentionByUsername = computed(() => {
  const map = new Map<string, { id: string; name: string }>();
  if (!chat.value?.isGroup) return map;
  const ids = new Set([selfId, ...(chat.value.participantIds ?? [])]);
  for (const c of contacts.value) {
    if (ids.has(c.id) && c.username) map.set(c.username.toLowerCase(), { id: c.id, name: c.name });
  }
  const su = getSelfUsername();
  if (su) map.set(su.toLowerCase(), { id: selfId, name: 'You' });
  return map;
});

interface BodySeg {
  text?: string;
  url?: string;
  emoji?: string;
  mention?: { id: string; name: string; me: boolean };
  everyone?: boolean;
  contact?: ContactEntity; // spec 1029: a tappable phone number / email address
}
const MENTION_RE = /@([a-zA-Z0-9_]+)/g;

// Split a message body into render segments. @mentions (spec 1020): an "@handle" token
// becomes a mention chip ONLY when it resolves to a member this message actually mentions
// (m.mentions by id), and "@everyone" when m.mentionsEveryone was honored — otherwise the
// "@word" stays plain text. Mentions interleave with the existing link/emoji segmentation.
function bodyParts(m: Message): BodySeg[] {
  const out: BodySeg[] = [];
  const mentioned = new Set(m.mentions ?? []);
  const members = mentionByUsername.value;
  const emit = (t: string): void => {
    // Detect phone/email first (spec 1029), then emoji-segment the plain runs
    // between them. Contacts sit between @mention and emoji handling: URLs and
    // @mentions are already resolved by the outer loop, so a detected entity can
    // never eat a link or a handle.
    for (const cs of segmentContacts(t)) {
      if ('kind' in cs) {
        out.push({ contact: cs });
        continue;
      }
      for (const seg of segmentEmoji(cs.text)) {
        if (seg.emoji) out.push({ emoji: seg.emoji });
        else if (seg.text) out.push({ text: seg.text });
      }
    }
  };
  for (const p of linkParts(m.body)) {
    if (p.url) {
      out.push({ text: p.text, url: p.url });
      continue;
    }
    const text = p.text ?? '';
    let last = 0;
    let mm: RegExpExecArray | null;
    MENTION_RE.lastIndex = 0;
    while ((mm = MENTION_RE.exec(text))) {
      const handle = mm[1].toLowerCase();
      const isEveryone = handle === 'everyone' && !!m.mentionsEveryone;
      const member = members.get(handle);
      const isMember = !!member && mentioned.has(member.id);
      if (!isEveryone && !isMember) continue; // plain "@word", leave in text
      if (mm.index > last) emit(text.slice(last, mm.index));
      if (isEveryone) out.push({ everyone: true });
      else out.push({ mention: { id: member!.id, name: member!.name, me: member!.id === selfId } });
      last = mm.index + mm[0].length;
    }
    if (last < text.length) emit(text.slice(last));
  }
  return out;
}
function openMentionedContact(id: string): void {
  if (id && id !== selfId) router.push(`/contact/${id}`);
}

// ---- composer @-mention autocomplete (spec 1020) ----
const mentionQuery = ref<string | null>(null); // the @query being typed, or null when inactive
const isGroupOwner = computed(() => chat.value?.isGroup === true && chat.value.createdBy === selfId);
// Group members (id/name/username) for the picker — excludes self.
const groupMembers = computed(() => {
  if (!chat.value?.isGroup) return [] as Array<{ id: string; name: string; username: string }>;
  const ids = new Set(chat.value.participantIds ?? []);
  return contacts.value
    .filter((c) => ids.has(c.id) && c.id !== selfId && c.username)
    .map((c) => ({ id: c.id, name: c.name, username: c.username as string }));
});
interface MentionCandidate { id?: string; name: string; username: string; everyone?: boolean }
const mentionCandidates = computed<MentionCandidate[]>(() => {
  const q = mentionQuery.value;
  if (q === null) return [];
  const ql = q.toLowerCase();
  const list: MentionCandidate[] = groupMembers.value
    .filter((m) => m.name.toLowerCase().includes(ql) || m.username.toLowerCase().includes(ql))
    .map((m) => ({ ...m }));
  // Owner-only @everyone broadcast (spec 1020), offered when it matches the query.
  if (isGroupOwner.value && 'everyone'.startsWith(ql)) list.unshift({ name: 'Everyone', username: 'everyone', everyone: true });
  return list.slice(0, 8);
});
// An "@token" at the end of the draft (assumed cursor position) starts an autocomplete.
function updateMentionQuery(): void {
  if (!chat.value?.isGroup) { mentionQuery.value = null; return; }
  const m = /(?:^|\s)@([a-zA-Z0-9_]*)$/.exec(draft.value);
  mentionQuery.value = m ? m[1] : null;
}
function pickMention(c: MentionCandidate): void {
  draft.value = draft.value.replace(/(^|\s)@([a-zA-Z0-9_]*)$/, `$1@${c.username} `);
  mentionQuery.value = null;
  void composerEl.value?.$el?.setFocus?.();
}
// Resolve a body's @tokens to mentioned member ids + an honored (owner-only) @everyone.
function resolveMentions(text: string): { mentions: string[]; everyone: boolean } {
  const byU = new Map(groupMembers.value.map((m) => [m.username.toLowerCase(), m.id]));
  const ids = new Set<string>();
  let everyone = false;
  for (const mm of text.matchAll(/(?:^|\s)@([a-zA-Z0-9_]+)/g)) {
    const h = mm[1].toLowerCase();
    if (h === 'everyone' && isGroupOwner.value) everyone = true;
    else {
      const id = byU.get(h);
      if (id) ids.add(id);
    }
  }
  return { mentions: [...ids], everyone };
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
// A photo/video bubble uses the tight edge-to-edge media frame — whether it's downloaded (mediaId)
// OR still pending (not-yet-downloaded), so the not-downloaded placeholder is framed identically.
const mediaBubble = (m: Message) =>
  !m.deleted && (!!m.mediaId || !!m.pendingMedia) && (m.kind === 'image' || (m.kind === 'video' && !m.videoNote));

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
  // Forwarding re-sends the original, so require it to still be on device — an original freed to
  // save space (spec 1014 FR-018) keeps its mediaId + preview but has no `url`, so it isn't
  // forwardable (otherwise the forward would silently send nothing).
  (((m.kind === 'image' || m.kind === 'video' || m.kind === 'file') && !!m.mediaId && !!mediaInfo.value[m.mediaId]?.url) ||
    (m.kind === 'text' && hasLink(m.body)));

const forwardOpen = ref(false);
const forwardIds = ref<string[]>([]); // one id from the menu, several from selection mode
function openForward(id: string): void {
  forwardIds.value = [id];
  forwardOpen.value = true;
}
async function onForwardSend(chatIds: string[]): Promise<void> {
  forwardOpen.value = false;
  if (chatIds.length) {
    for (const id of forwardIds.value) await forwardMessage(id, chatIds);
  }
  forwardIds.value = [];
  exitSelect();
  await appToast({ message: 'Forwarded', duration: 1200 });
}

/* ---- multi-select (bulk forward / delete) ----
   Entered via "Select" in a message's menu. While selecting, the header becomes
   a count + forward/delete bar, every bubble row toggles on tap (its innards go
   pointer-inert in CSS), and swipe gestures are suspended. Albums toggle as one
   unit, so a bulk action never splits an album. */
const selecting = ref(false);
const selected = ref<string[]>([]);
const isSelected = (id: string) => selected.value.includes(id);
function toggleSelect(ids: string[]): void {
  if (isSelected(ids[0])) selected.value = selected.value.filter((x) => !ids.includes(x));
  else selected.value = [...selected.value, ...ids.filter((x) => !selected.value.includes(x))];
}
function enterSelect(m: Message): void {
  selecting.value = true;
  selected.value = m.albumId ? albumMessageIds(m) : [m.id];
}
function exitSelect(): void {
  selecting.value = false;
  selected.value = [];
}
// The selected messages in conversation order, so bulk forwards arrive in order. Selection
// happens on rendered bubbles, so the chosen ids live within the loaded run (`rows`).
const selectedMessages = computed(() =>
  rows.value
    .filter((m) => selected.value.includes(m.id))
    .sort((a, b) => a.timestamp - b.timestamp),
);
function forwardSelected(): void {
  if (!selected.value.length) return;
  forwardIds.value = selectedMessages.value.filter((m) => !m.deleted).map((m) => m.id);
  forwardOpen.value = true;
}
function confirmDeleteSelected(): void {
  const targets = selectedMessages.value.filter((m) => !gameLocked(m));
  if (targets.length < selectedMessages.value.length) {
    void appToast({ message: 'Games still being played were left out.', duration: 2200 });
  }
  if (targets.length) void presentDeleteSheet(targets);
}

/* ---- reply ---- */
// Resolve co-member identity (sender name/avatar/colour, @-mentions, game seats)
// from the UNFILTERED contact set: a group member is that person regardless of
// whether your 1:1 with them is accepted, so listContacts()'s pending/ghosted
// filter must not hide them here (that filter is for the address book) — doing so
// made a pending/ghosted member render as a raw id with a blank avatar.
const contacts = useLiveQuery(() => listAllContacts(), ['contacts'], [] as Contact[]);
const contactsMap = computed(() => new Map(contacts.value.map((c) => [c.id, c])));
const replyingTo = ref<ReplyRef | null>(null);
const composerEl = ref<{ $el: HTMLIonTextareaElement } | null>(null);
// Bumped after a media send to remount the composer textarea (spec 2019) — see send().
const composerKey = ref(0);

// Make the composer bidi-aware: dir="auto" on the NATIVE <textarea> (Ionic doesn't forward
// it from the host) so the editor flips per content — a Persian/Arabic/Hebrew message flows
// right-to-left with the caret on the right, an English one left-to-right, and a mix takes
// its base direction from the first strong character. The browser re-evaluates live as you
// type. Watched (not one-shot) so it re-applies if the composer remounts (e.g. a pending
// chat being accepted). getInputElement exists on ion-textarea but isn't in our minimal type.
watch(composerEl, (el) => {
  const ta = el?.$el as (HTMLIonTextareaElement & { getInputElement?: () => Promise<HTMLTextAreaElement> }) | undefined;
  void ta?.getInputElement?.().then((native) => native?.setAttribute('dir', 'auto')).catch(() => {});
});

// ---- composer draft: keep your place across leaving the chat or closing the app ----
// An unsent message (text + caret + any reply-in-progress) is restored when you re-open this chat,
// saved as you type (debounced), flushed on leave / background, and cleared once you send.
let draftSaveTimer: ReturnType<typeof setTimeout> | undefined;
let draftLoaded = false;

async function nativeComposer(): Promise<HTMLTextAreaElement | undefined> {
  const ta = composerEl.value?.$el as
    | (HTMLIonTextareaElement & { getInputElement?: () => Promise<HTMLTextAreaElement> })
    | undefined;
  return ta?.getInputElement?.().catch(() => undefined);
}

async function loadDraft(): Promise<void> {
  if (draftLoaded) return; // once per mount; returning from a sub-page keeps the live draft as-is
  draftLoaded = true;
  const [d, dm] = await Promise.all([getDraft(chatId), getDraftMedia(chatId)]);
  // Nothing saved, or the user already started composing before the (async) load resolved.
  if ((!d && !dm) || draft.value.trim() || pendingMedia.value.length) return;
  if (d) {
    draft.value = d.text ?? '';
    if (d.reply && !replyingTo.value) replyingTo.value = d.reply;
  }
  // Rebuild the staged attachments from their inline bytes as fresh in-memory files (always readable,
  // unlike a Blob read back from IDB after a reload). Seed the bytes cache so the next save is free.
  if (dm?.items.length) {
    for (const it of dm.items) {
      const file = new File([it.bytes], it.name || 'attachment', it.mime ? { type: it.mime } : undefined);
      const id = crypto.randomUUID();
      draftMediaBytes.set(id, it.bytes);
      const url = it.kind === 'image' || it.kind === 'video' ? URL.createObjectURL(file) : undefined;
      pendingMedia.value.push({ id, blob: file, kind: it.kind, url, caption: it.caption });
      if (it.kind === 'video') queueVideoPoster(id); // rebuild the tile thumbnail
    }
  }
  if (d?.text) {
    await nextTick();
    const native = await nativeComposer();
    if (native) {
      const end = d.selEnd ?? d.text.length;
      try {
        native.setSelectionRange(d.selStart ?? end, end); // drop the caret back where it was
      } catch {
        /* selection unsupported on this element state — ignore */
      }
      native.focus();
    }
  }
}

function scheduleDraftSave(): void {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => void persistDraft(), 400);
}

async function persistDraft(): Promise<void> {
  clearTimeout(draftSaveTimer);
  if (editingMsg.value) return; // an in-progress edit rewrites a sent message, it isn't a draft
  const text = draft.value;
  const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
  const media = pendingMedia.value;
  if (!text.trim() && !reply && !media.length) {
    await clearDraft(chatId);
    return;
  }
  const native = await nativeComposer();
  await saveDraft({
    chatId,
    text,
    selStart: native?.selectionStart ?? undefined,
    selEnd: native?.selectionEnd ?? undefined,
    reply,
    mediaCount: media.length || undefined,
    mediaLabel: mediaLabelFor(media),
  });
}

// The Chats-list preview for a media-only draft (no typed text).
function mediaLabelFor(media: PendingMedia[]): string | undefined {
  if (!media.length) return undefined;
  if (media.length > 1) return `${media.length} attachments`;
  const k = media[0].kind;
  return k === 'image' ? 'Photo' : k === 'video' ? 'Video' : 'File';
}

// ---- staged attachments in the draft: keep the photos/videos/files you added but didn't send ----
// Their bytes are stored inline (ArrayBuffer), NOT as Blobs — an IDB Blob can read back broken on iOS
// after a reload. The heavy bytes write is NOT done on every add/remove (serializing megabytes of
// video into IndexedDB on each edit janked the composer, which made rapid removals misfire). Instead
// it runs once when you LEAVE or background the chat — the only moments it needs to survive — while
// the lightweight drafts record (mediaCount/label) is kept current per edit. Bytes are cached by
// item id so the leave-time write doesn't re-read a (possibly large) clip.
const draftMediaBytes = new Map<string, ArrayBuffer>();

async function persistDraftMedia(): Promise<void> {
  const media = pendingMedia.value;
  if (!media.length) {
    await clearDraftMedia(chatId);
    draftMediaBytes.clear();
    return;
  }
  const items: DraftMediaItem[] = [];
  for (const it of media) {
    let bytes = draftMediaBytes.get(it.id);
    if (!bytes) {
      bytes = await it.blob.arrayBuffer();
      draftMediaBytes.set(it.id, bytes);
    }
    items.push({
      bytes,
      kind: it.kind,
      name: it.blob.name || 'attachment',
      mime: it.blob.type || '',
      caption: it.caption,
    });
  }
  await saveDraftMedia(chatId, items);
}

// Sent → the draft is spent; drop the pending saves and the stored copies (text + attachments).
function clearComposerDraft(): void {
  clearTimeout(draftSaveTimer);
  draftMediaBytes.clear();
  void clearDraft(chatId);
  void clearDraftMedia(chatId);
}

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

// A group sender's display NAME, resolved LIVE from the contact record — the
// single source of truth for names — so renaming a contact updates their name on
// past messages too (it already did for the avatar). Falls back to the message's
// stored snapshot for a sender who is no longer a contact (left/removed).
function senderName(senderId: string, fallback: string): string {
  return contactsMap.value.get(senderId)?.name || fallback;
}

// Whether render-item i begins a new run from its sender, i.e. the previous
// message was from someone else (or was outgoing). The avatar + colored name show
// only on a run's first bubble; continuation bubbles get a spacer for alignment.
function groupRunStart(i: number): boolean {
  if (!chat.value?.isGroup) return false;
  const cur = renderItems.value[i];
  if (cur?.kind !== 'msg' || cur.message.outgoing) return false;
  // Predecessor-included (the prior rendered row) so the avatar/name doesn't
  // toggle as the window's leading row changes on load (D8/INV-7).
  return isRunStartEdge(prevMsgFor(i), cur.message, true);
}

/* ---- edit one of your own messages ----
   "Edit" in the message menu loads the text into the composer behind an
   "Edit message" bar; Send then rewrites the message in place (both sides,
   via the E2EE edit signal) instead of sending a new one. */
const editingMsg = ref<Message | null>(null);
function startEdit(m: Message): void {
  replyingTo.value = null; // editing and replying are mutually exclusive
  editingMsg.value = m;
  draft.value = m.body;
  void nextTick(() => (composerEl.value?.$el as HTMLIonTextareaElement | undefined)?.setFocus());
}
function cancelEdit(): void {
  editingMsg.value = null;
  draft.value = '';
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

function notAvailableToast(): void {
  // The quoted message isn't on this device, e.g. a reply to a message sent before we
  // joined this group. The quote bubble still renders from its embedded snapshot; there's
  // just nothing to scroll to.
  void appToast({ message: 'Original message not available', duration: 1400 });
}
// Poll briefly for the target row to mount, then center it (it may need a tick after a
// window change). Returns true once it scrolled to it.
async function centerWhenRendered(id: string, tries: number, instant = false): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const el = document.querySelector(`[data-mid="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: instant || i > 0 ? 'auto' : 'smooth', block: 'center' });
      return true;
    }
    await new Promise((r) => setTimeout(r, 80));
    await nextTick();
  }
  return false;
}
// Seek to a message and center it (INV-6 / US3, research D7). If it's already rendered we
// just center it. Otherwise, for an on-device message older/newer than the loaded window,
// load batches toward it (bounded loop) until it falls within the run, move the render
// window to include it, and center it — instead of the old "not available" dead end.
// True while a seek is loading/centering its target, so the rows-watch's auto-follow doesn't yank
// back to the newest when seekTo swaps the window (the seek and a stickBottom scrollToNewest would
// otherwise race). Read in the rows-watch below.
let seeking = false;
async function scrollToMessage(id: string, opts: { instant?: boolean; silent?: boolean } = {}): Promise<boolean> {
  // Album photos render under ONE bubble keyed by the album's first message id, so a non-first
  // member has no row/DOM node of its own. Map any album member to that first id — otherwise
  // "Go to message"/jump on photo 2+ dead-ends with "Original message not available". Centralized
  // here so every caller (viewer goto, swipe-dismiss, ?jump from all-media, replies) is covered.
  const am = allMedia.value.find((x) => x.id === id);
  if (am?.albumId) {
    const first = allMedia.value
      .filter((x) => x.albumId === am.albumId)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    if (first) id = first.id;
  }
  seeking = true;
  try {
    if (document.querySelector(`[data-mid="${id}"]`)) {
      await centerWhenRendered(id, 1, opts.instant);
      return true;
    }
    const target = await getMessage(id);
    if (!target || target.chatId !== chatId) {
      // `silent` (automatic positioning, e.g. open-at-first-unseen) must not error-toast —
      // the user didn't ask to jump anywhere; only an EXPLICIT jump (reply/quote/go-to) does.
      if (!opts.silent) notAvailableToast();
      return false;
    }
    // Load a window centered on the target in one read-pair (fast even for a target 5,000
    // messages back — vs paging batch-by-batch, which is O(n²) reads and janky). D7. A concurrent
    // `messages` change (e.g. the just-sent reply's sent→delivered status, or a receipt) makes
    // useChatHistory.reconcile bump the shared token and supersede the in-flight seek (it returns
    // false, window unchanged). Retry a few times so a transient supersede doesn't dead-end it.
    for (let attempt = 0; attempt < 5 && rows.value.findIndex((r) => r.id === id) < 0; attempt++) {
      await history.seekTo(target.timestamp);
      if (rows.value.findIndex((r) => r.id === id) >= 0) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    if (rows.value.findIndex((r) => r.id === id) < 0) {
      if (!opts.silent) notAvailableToast();
      return false;
    }
    // The whole loaded run is rendered, so the target now mounts; re-seed the spacers for the
    // new window and center it on screen (a tap-driven scroll, not a fling, so scrollIntoView
    // is fine here). `instant` (open-at-first-unseen) jumps straight there so the visibility scan
    // doesn't mark every message it would smooth-scroll past (spec 1013).
    await nextTick();
    reseedTopPad();
    if (!(await centerWhenRendered(id, 20, opts.instant))) {
      if (!opts.silent) notAvailableToast();
      return false;
    }
    return true;
  } finally {
    seeking = false;
  }
}

// Drag-to-swipe a bubble (touch only): drag right past the threshold to reply,
// left to delete, revealing an icon underneath. Releasing short of the threshold
// snaps back and does nothing.
const SWIPE_MAX = 110; // how far the bubble can travel
const SWIPE_TRIGGER = 70; // release past this fires the action
// The native standalone-PWA back gesture (iOS swipes the browser history back
// when the app runs full-screen; Ionic's own swipe-back is off — see main.ts)
// owns the left of the screen, and iOS fires it from well INSIDE the edge, not
// just the first few pixels — so a fixed screen-edge guard can't reliably tell a
// back-swipe from a reply. Instead we make the LEFT PART OF EACH INCOMING BUBBLE
// inert to the reply drag: a right-swipe that begins on the left of an incoming
// bubble is almost always "go back", so it must not also arm a reply (which would
// drop a stray draft as the page navigates away). Only the bubble's right portion
// starts a reply. Outgoing bubbles hug the right edge, clear of the back-swipe
// lane, so they stay fully swipeable.
const REPLY_DEAD_ZONE_FRAC = 0.55; // left 55% of an incoming bubble ignores swipe-right
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
  if (m.deleted || selecting.value) return;
  if (m.kind === 'game' || m.kind === 'gamechallenge') return; // boards aren't reply-swipeable
  const startX = e.touches[0].clientX;
  // Incoming bubbles: the left part is inert to the reply drag — a right-swipe
  // starting there is the OS back gesture, not a reply (see REPLY_DEAD_ZONE_FRAC).
  // Measure against the bubble the touch actually landed on, so it scales with
  // every bubble width and never depends on guessing iOS's back-swipe hot-zone.
  if (!m.outgoing) {
    const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    if (rect && startX - rect.left < rect.width * REPLY_DEAD_ZONE_FRAC) return;
  }
  swipeStartX = startX;
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
    // No preventDefault needed: the bubble's `touch-action: pan-y` already stops the
    // browser acting on a horizontal drag, so this listener can stay passive (no
    // main-thread round-trip at the start of every vertical scroll).
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
/** An unfinished game is not deletable: pulling a live board out from under
 *  both players breaks placement and play alike. Cancelled challenges and any
 *  terminal result delete like ordinary messages. */
function gameLocked(m: Message): boolean {
  if ((m.kind !== 'game' && m.kind !== 'gamechallenge') || !m.game || m.deleted) return false;
  if (m.game.challenge && challengePhase(m.game) === 'cancelled') return false;
  return deriveGameStatus(GAMES[m.game.gameType] ?? null, m.game).state === 'ongoing';
}

async function confirmDelete(m: Message): Promise<void> {
  if (gameLocked(m)) {
    await appToast({ message: 'Finish or resign the game first.', duration: 2200 });
    return;
  }
  const targets = m.albumId ? allMedia.value.filter((x) => x.albumId === m.albumId) : [m];
  await presentDeleteSheet(targets);
}
/* Delete options (single message, album, or a whole selection):
   - own messages additionally offer "for everyone": traced (the default — both
     sides keep a "This message was deleted" placeholder) or traceless (the
     message vanishes outright from the conversation on both sides);
   - "for me" variants are always available: traced placeholder, or remove the
     row locally without leaving anything behind. */
async function presentDeleteSheet(targets: Message[]): Promise<void> {
  if (!targets.length) return;
  const live = targets.filter((m) => !m.deleted);
  const canEveryone = live.length > 0 && live.every((m) => m.outgoing);
  const apply = (fn: (m: Message) => Promise<void>) => {
    void (async () => {
      for (const m of targets) await fn(m);
    })();
    exitSelect();
  };
  const buttons: Array<{ text: string; role?: 'destructive' | 'cancel'; handler?: () => void }> = [];
  if (canEveryone) {
    buttons.push(
      {
        text: 'Delete for everyone',
        role: 'destructive',
        handler: () => apply((m) => deleteMessageForEveryone(m.id, true)),
      },
      {
        text: 'Delete for everyone, no trace',
        role: 'destructive',
        handler: () => apply((m) => deleteMessageForEveryone(m.id, false)),
      },
    );
  }
  buttons.push(
    { text: 'Delete for me', role: 'destructive', handler: () => apply((m) => softDeleteMessage(m.id)) },
    { text: 'Delete for me, no trace', role: 'destructive', handler: () => apply((m) => deleteMessage(m.id)) },
    { text: 'Cancel', role: 'cancel' },
  );
  const sheet = await actionSheetController.create({
    header: targets.length > 1 ? `Delete ${targets.length} messages?` : 'Delete message?',
    buttons,
  });
  await sheet.present();
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

// ---- per-message disappearing timer (composer) ----
// Sticky override applied to messages you send from now on, on top of the chat/group default:
//   undefined = follow the chat default · null = off (don't disappear) · >0 = this many ms.
// It stays until you change it (this session), and is passed as ttlOverrideMs on send.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const TTL_DAY = 24 * HOUR;
const msgTtl = ref<number | null | undefined>(undefined);
const effectiveTtlMs = computed(() => (msgTtl.value !== undefined ? msgTtl.value : chat.value?.defaultTtlMs ?? null));
function fmtTtl(ms: number): string {
  if (ms >= TTL_DAY) return `${Math.round(ms / TTL_DAY)}d`;
  if (ms >= HOUR) return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / MIN)}m`;
}

// A slowly-ticking clock so each disappearing message's "left" indicator stays current without a
// per-second timer (windows are minutes-to-days). Reads drive template re-render every 30s.
const nowMs = ref(Date.now());
let ttlTick: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  ttlTick = setInterval(() => (nowMs.value = Date.now()), 30_000);
});
onUnmounted(() => clearInterval(ttlTick));

// Compact "time left before this disappears" for a message's expiresAt (e.g. "1d", "3h", "5m", "9s").
function ttlLeft(expiresAt: number): string {
  const s = Math.max(0, Math.floor((expiresAt - nowMs.value) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
const msgTtlShort = computed(() => (effectiveTtlMs.value ? fmtTtl(effectiveTtlMs.value) : ''));
const msgTtlLabel = computed(() => {
  if (msgTtl.value === undefined) return effectiveTtlMs.value ? `chat default (${fmtTtl(effectiveTtlMs.value)})` : 'off (chat default)';
  if (!msgTtl.value) return 'off';
  return fmtTtl(msgTtl.value);
});
async function openMsgTtl(): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Disappearing timer',
    subHeader: 'Messages you send disappear after (until you change it):',
    buttons: [
      { text: 'Use chat default', handler: () => { msgTtl.value = undefined; } },
      { text: 'Off', handler: () => { msgTtl.value = null; } },
      { text: '5 minutes', handler: () => { msgTtl.value = 5 * MIN; } },
      { text: '1 hour', handler: () => { msgTtl.value = HOUR; } },
      { text: '24 hours', handler: () => { msgTtl.value = TTL_DAY; } },
      { text: '7 days', handler: () => { msgTtl.value = 7 * TTL_DAY; } },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

// Keep the line you're typing visible. Once the composer hits its max height it
// scrolls, but the scroll container is the ion-textarea HOST (its inner native
// textarea grows to fit, so it never scrolls itself), and the browser only keeps
// the caret in view within that native element, not the host. So a fresh bottom
// line ends up clipped just below the fold until you nudge it up. Pin the host to
// the bottom on input so the newest line stays fully visible.
// --- activity indicator emit (spec 1009): typing + recording (1:1 only here; groups are US5) ---
// One emitter for all kinds: emit `active` plus a ~3s keepalive (so a long compose
// or recording stays shown without a per-event storm), and `stopped` when it ends.
// Switching kind (typing → recording) just replaces — the recipient keys by sender,
// so a fresh `active` of a new kind overwrites the old one. sendActivity is a no-op
// when the privacy toggle is off (reciprocity) or it can't be sealed (fail-closed).
let activeKind: ActivityKind | null = null;
let activityKeepalive: ReturnType<typeof setInterval> | null = null;

function emitActivitySignal(kind: ActivityKind, state: ActivityState): void {
  const c = chat.value;
  if (!c) return;
  if (c.isGroup) {
    const members = (c.participantIds ?? []).filter((id) => id && id !== selfId);
    if (members.length) void sendGroupActivity({ members, conversationId: c.id, kind, state });
  } else {
    const peer = c.participantIds?.[0];
    if (peer) void sendActivity({ peerUserId: peer, kind, state });
  }
}

function startActivity(kind: ActivityKind): void {
  if (!chat.value || activeKind === kind) return;
  activeKind = kind;
  emitActivitySignal(kind, 'active');
  if (activityKeepalive) clearInterval(activityKeepalive);
  activityKeepalive = setInterval(() => emitActivitySignal(kind, 'active'), ACTIVITY.KEEPALIVE_MS);
}

// `only` guards against stopping a different in-progress activity (e.g. a composer
// blur must not cancel an ongoing recording indicator).
function stopActivity(only?: ActivityKind): void {
  if (!activeKind || (only && activeKind !== only)) return;
  const kind = activeKind;
  activeKind = null;
  if (activityKeepalive) {
    clearInterval(activityKeepalive);
    activityKeepalive = null;
  }
  emitActivitySignal(kind, 'stopped');
}

function onComposerInput(e: CustomEvent): void {
  draft.value = (e.detail as { value?: string | null }).value ?? '';
  if (draft.value.trim()) startActivity('typing');
  else stopActivity('typing'); // cleared the draft → no longer typing
  scheduleDraftSave(); // persist the unsent text so leaving/closing keeps your place
  updateMentionQuery(); // spec 1020: open/refresh the @-mention autocomplete
  const host = composerEl.value?.$el;
  if (host) requestAnimationFrame(() => { host.scrollTop = host.scrollHeight; });
}

function onComposerBlur(): void {
  stopActivity('typing'); // blurring the field ends typing (not a recording)
}

// Focusing the composer raises the keyboard. The ResizeObserver re-pins to newest on
// the viewport shrink, but on Android the keyboard-resize settles in steps and that
// single observation can fire before the layout is final, leaving the last message
// partially behind the composer. Re-assert scroll-to-newest a few times after focus —
// but only while the user is already at the bottom (stickBottom), so it never yanks
// someone out of reading history.
function onComposerFocus(): void {
  if (!stickBottom) return;
  void scrollToNewest();
  for (const ms of [150, 350, 600]) setTimeout(() => { if (stickBottom) void scrollToNewest(); }, ms);
}

// Block Return while the composer is empty (or only whitespace) so a message can't
// start with blank lines / be opened with nothing typed.
function onComposerEnter(e: KeyboardEvent): void {
  if (!draft.value.trim() && !pendingMedia.value.length) e.preventDefault();
}

/* ---- staged media attachments (spec 1023) ----
   Media added to the composer — whether PICKED from the library/files or PASTED
   (iOS long-press → Paste, or Ctrl/Cmd+V) — doesn't send immediately: it parks here
   as removable thumbnails above the textarea, the placeholder flips to "Add a caption",
   and Send ships the media + typed caption together (see send()). Routing picked media
   through here too (not just paste) is what lets you caption library photos as well.
   For several photos/videos you choose Album (one swipeable post) or Individual; the
   caption applies to the album once, or to each individual message. Object URLs back the
   image/video thumbnails and are revoked on remove/send/unmount. */
interface PendingMedia {
  id: string;
  blob: File;
  kind: 'image' | 'video' | 'file';
  url?: string; // object URL for an image/video preview; files show a chip instead
  caption?: string; // optional per-item caption (overrides the shared one for this item)
  poster?: string; // a video's first-frame thumbnail (data URL); a <video> tile paints black on iOS
  ready?: boolean; // a video's poster generation has settled (succeeded or gave up) — stop the spinner
}
// Cap on staged attachments per message (photos + videos + files). The iOS library picker itself
// can't be limited, so onPick trims the overflow to this.
const MAX_STAGED_MEDIA = 10;
const pendingMedia = ref<PendingMedia[]>([]);
// Multiple photos/videos: send as one album (default) or as separate messages.
const sendAsAlbum = ref(true);

// Caption a single staged item (tap its thumbnail). Per-item captions override the shared caption
// typed in the composer for that one item (spec 1023). We use a bottom-sheet ion-modal with a real
// ion-textarea (not an alert input) so the field rides ABOVE the keyboard instead of being shoved
// off-screen the way the alert was on iOS.
const captionSheet = ref<{ open: boolean; index: number; text: string }>({ open: false, index: -1, text: '' });
const captionInputEl = ref<{ $el: HTMLIonTextareaElement } | null>(null);
// The item being captioned — drives the preview shown above the input (a video's is the very poster
// that gets embedded in the message, so it doubles as a quality check).
const captionItem = computed(() => pendingMedia.value[captionSheet.value.index]);
function editItemCaption(i: number): void {
  const item = pendingMedia.value[i];
  if (!item) return;
  captionSheet.value = { open: true, index: i, text: item.caption ?? '' };
}
function focusCaptionInput(): void {
  void (captionInputEl.value?.$el as HTMLIonTextareaElement | undefined)?.setFocus?.();
}
function onCaptionInput(e: CustomEvent): void {
  captionSheet.value.text = ((e.detail as { value?: string | null }).value ?? '').slice(0, CAPTION_MAX);
}
function saveItemCaption(): void {
  const { index, text } = captionSheet.value;
  const next = pendingMedia.value[index];
  if (next) next.caption = text.trim() || undefined;
  captionSheet.value.open = false;
  scheduleDraftSave(); // caption bytes are re-saved on leave; just touch the light drafts record now
}
// The Album/Individual choice only makes sense with 2+ image/video items.
const albumChoiceVisible = computed(
  () => pendingMedia.value.filter((p) => p.kind === 'image' || p.kind === 'video').length > 1,
);

// Classify a file by mime (the universal picker returns docs/music alongside media).
// `forceFile` is the explicit "Choose Files" path, which keeps everything as a file.
function mediaKindOf(f: File, forceFile = false): 'image' | 'video' | 'audio' | 'file' {
  if (forceFile) return 'file';
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('image/')) return 'image';
  if (f.type.startsWith('audio/')) return 'audio';
  return 'file';
}

// Stage one picked/pasted file for captioning + sending. Audio takes its own title/artist
// review path, so this returns 'audio' to let the caller route it to the audio queue;
// everything else parks in pendingMedia and returns 'staged'.
function stageMedia(f: File, forceFile = false): 'audio' | 'staged' {
  const k = mediaKindOf(f, forceFile);
  if (k === 'audio') return 'audio';
  const kind: 'image' | 'video' | 'file' = k === 'image' || k === 'video' ? k : 'file';
  const url = kind === 'image' || kind === 'video' ? URL.createObjectURL(f) : undefined;
  const id = crypto.randomUUID();
  pendingMedia.value.push({ id, blob: f, kind, url });
  if (kind === 'video') queueVideoPoster(id); // decode a first-frame thumbnail (serialized + retried)
  scheduleDraftSave(); // update the light drafts record; the media bytes are saved on leave (below)
  return 'staged';
}

// Video poster generation is SERIALIZED through this queue. Decoding a frame right after a big
// multi-select is flaky on iOS (why the tile stayed black until you left + came back, once the page
// had settled); doing several at once made it worse. One at a time — with a breath between — mimics
// the calm re-open that always works. Each item still retries a few times before giving up.
const posterQueue: Array<() => Promise<void>> = [];
let posterQueueRunning = false;
function queueVideoPoster(id: string, attempt = 0): void {
  posterQueue.push(() => attemptVideoPoster(id, attempt));
  if (!posterQueueRunning) void runPosterQueue();
}
async function runPosterQueue(): Promise<void> {
  posterQueueRunning = true;
  try {
    while (posterQueue.length) {
      const task = posterQueue.shift();
      if (task) await task();
      await new Promise((r) => window.setTimeout(r, 150)); // let the decoder settle between clips
    }
  } finally {
    posterQueueRunning = false;
  }
}

// One decode attempt for a staged video's first-frame poster. On failure it RE-QUEUES itself (after a
// backoff) rather than looping in place, so a stubborn clip doesn't hold up the others' turns — each
// clip's later retries interleave with the rest. Gives up to a plain black tile after a few tries.
// The item is updated by REPLACING it (not mutating in place) so the tile repaints reliably.
async function attemptVideoPoster(id: string, attempt: number): Promise<void> {
  const item = pendingMedia.value.find((m) => m.id === id);
  if (!item || item.kind !== 'video') return; // removed while queued
  let poster: string | undefined;
  try {
    poster = await generateVideoPoster(item.blob);
  } catch {
    /* no frame yet */
  }
  const idx = pendingMedia.value.findIndex((m) => m.id === id);
  if (idx < 0) return; // item removed while we were decoding
  if (poster) {
    pendingMedia.value[idx] = { ...pendingMedia.value[idx], poster, ready: true };
    return;
  }
  if (attempt < 5) {
    window.setTimeout(() => queueVideoPoster(id, attempt + 1), 600 * (attempt + 1)); // retry later
    return;
  }
  pendingMedia.value[idx] = { ...pendingMedia.value[idx], ready: true }; // give up: black tile + play
}

// Route a picked/pasted audio file into the title/artist review queue (its own flow).
function queueAudioFile(f: File, reply?: ReplyRef): void {
  audioQueue.value.push({ blob: f, name: f.name || 'audio', reply });
  if (!audioReview.value.open) void processNextAudio();
}

// A bare image URL (single token, ends in a known image extension, query/hash allowed).
const IMAGE_URL_RE = /^https?:\/\/[^\s]+\.(?:gif|webp|png|jpe?g|jfif|avif|bmp|svg)(?:[?#][^\s]*)?$/i;
function isImageUrl(s: string): boolean {
  return !!s && !/\s/.test(s) && IMAGE_URL_RE.test(s);
}

function onComposerPaste(e: ClipboardEvent): void {
  // Any pasted file (image, video, audio, document) stages as an attachment — not just
  // images (spec 1023). Audio routes to its own review queue.
  const files = Array.from(e.clipboardData?.items ?? [])
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f);
  if (files.length) {
    // Don't also insert the file name/uri as text.
    e.preventDefault();
    for (const f of files) {
      if (stageMedia(f) === 'audio') queueAudioFile(f);
    }
    return;
  }
  // No image file on the clipboard, but the pasted text is a bare image URL → fetch it
  // on THIS client and attach it as a normal media message. Fetching here (not on the
  // server) keeps the zero-knowledge boundary intact: the bytes are encrypted client-side
  // like any attachment; the server only ever relays the sealed blob.
  const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
  if (isImageUrl(text)) {
    e.preventDefault();
    void attachImageFromUrl(text);
  }
  // else: ordinary text paste — let the textarea handle it.
}

// Best-effort fetch of a remote image URL into a pending attachment. Many third-party
// CDNs block cross-origin reads (CORS) or fail offline; in that case we can't read the
// bytes, so we fall back to pasting the link as text rather than losing the paste.
async function attachImageFromUrl(url: string): Promise<void> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`not an image (${blob.type || 'unknown'})`);
    const name = imageNameFromUrl(url, blob.type);
    stageMedia(new File([blob], name, { type: blob.type }));
  } catch {
    // CORS-blocked / offline / not an image: don't swallow the paste — put the link in
    // the draft and tell the user why it wasn't attached.
    draft.value = draft.value ? `${draft.value} ${url}` : url;
    void appToast({ message: 'Couldn’t fetch that image (the site blocks it) — pasted the link instead.', duration: 2600 });
  }
}

// Derive a filename (with a sane extension) from the URL + actual MIME.
function imageNameFromUrl(url: string, mime: string): string {
  let base = 'image';
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').pop() || '';
    base = decodeURIComponent(last.split('.').slice(0, -1).join('.') || last) || 'image';
  } catch {
    /* keep default */
  }
  const ext = (mime.split('/')[1] || 'img').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  return /\.[a-z0-9]+$/i.test(base) ? base : `${base}.${ext}`;
}

// Remove by ID, not by v-for index: if the row re-renders slowly, repeated taps on one × would
// otherwise reuse a stale index and delete whatever slid into that position (the reported "removes
// the next ones too" bug). By id, a second tap on an already-removed item is simply a no-op.
function removePendingMedia(id: string): void {
  const idx = pendingMedia.value.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const [gone] = pendingMedia.value.splice(idx, 1);
  if (gone?.url) URL.revokeObjectURL(gone.url);
  if (gone) draftMediaBytes.delete(gone.id);
  scheduleDraftSave(); // update the light drafts record now; heavy media bytes save on leave (below)
}

function clearPendingMedia(): void {
  for (const p of pendingMedia.value) if (p.url) URL.revokeObjectURL(p.url);
  pendingMedia.value = [];
  sendAsAlbum.value = true;
}
onUnmounted(clearPendingMedia);

const cameraInput = ref<HTMLInputElement | null>(null);
const photoInput = ref<HTMLInputElement | null>(null);

const chat = useLiveQuery<Chat | undefined>(
  () => getChat(chatId),
  ['chats'],
  undefined,
);

// Back button doubles as an unread badge for the REST of the app. This chat is marked
// read on open, so the total minus this chat's unread is "everything else".
const totalUnread = useLiveQuery(() => countUnread(), ['chats'], 0);
const backText = computed(() => {
  const other = Math.max(0, totalUnread.value - (chat.value?.unread ?? 0));
  return other > 0 ? (other > 99 ? '99+' : String(other)) : '';
});

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

// Call-type availability by group size (spec 0004 US3): the call includes us, so total =
// other participants + 1. No video past VIDEO_MAX, no group call at all past AUDIO_MAX.
// 1:1 chats (1 other) always allow both.
const callMemberCount = computed(() => (chat.value?.participantIds.length ?? 0) + 1);
const canVideoCall = computed(() => callMemberCount.value <= VIDEO_MAX);
const canAudioCall = computed(() => callMemberCount.value <= AUDIO_MAX);

// Opening the conversation clears its unread count (and the Chats badge) and
// sends 'seen' receipts to the sender (the blue "seen" checks on their side).
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
      // Re-pin to newest as media grows / the keyboard opens — but never mid-fling
      // (that fights iOS momentum). Wait until the user's scroll has settled (this is the
      // ONE path that legitimately defers on momentum; the prepend anchor corrects live).
      if (stickBottom && !shouldDeferScrollWrite(Date.now(), lastScrollAt, MOMENTUM_QUIET_MS))
        void scrollToNewest();
    });
  }
  if (resizeObs && listEl.value) resizeObs.observe(listEl.value); // content height (media)
  void ensureScrollEl().then((el) => {
    if (el && resizeObs) resizeObs.observe(el); // viewport height (keyboard)
    setupWindowSentinels(el);
    setupBubbleObserver(el); // spec 1013: per-bubble ≥50% visibility → Seen
  });
}

// Look-ahead prefetch: an IntersectionObserver rooted on the scroll element with
// rootMargin = LOOK_AHEAD_PX fires loadOlder/loadNewer well before the top/bottom edge is
// reached, so the next page is in the DOM ahead of need (page-before-top, INV-2; D5). The
// ion-infinite-scroll above is the backstop.
let windowObs: IntersectionObserver | null = null;
function setupWindowSentinels(root: HTMLElement | null): void {
  if (!root || !('IntersectionObserver' in window)) return;
  windowObs?.disconnect();
  windowObs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        // Honor only the sentinel in the CURRENT scroll direction. On a bounded window both
        // sentinels can sit inside their LOOK_AHEAD margins at once; letting the bottom
        // sentinel fire loadNewer during an up-fling would tug the window back toward newer
        // content (the spec-1011 "lands on newer content" symptom). Direction gates it.
        if (e.target === topSentinel.value && scrollDir !== 'down') void loadOlder();
        else if (e.target === bottomSentinel.value && scrollDir !== 'up') void loadNewer();
      }
    },
    { root, rootMargin: `${LOOK_AHEAD_PX}px 0px ${LOOK_AHEAD_PX}px 0px`, threshold: 0 },
  );
  if (topSentinel.value) windowObs.observe(topSentinel.value);
  if (bottomSentinel.value) windowObs.observe(bottomSentinel.value);
}

// ---- visibility-driven "Seen" (spec 1013) ----
// A second IntersectionObserver over the message bubbles: a bubble crossing ≥50% visible is
// "seen". The NEWEST visible incoming message advances the Seen frontier (reportSeenUpTo marks it
// AND all older not-yet-Seen — uniform catch-up). Acts only while the chat is genuinely
// foregrounded (route active + document visible); off-screen messages are never reported. The
// observer is bounded by the rendered window (spec 1011 MAX_ROWS).
let bubbleVisObs: IntersectionObserver | null = null;
let markSeenTimer: ReturnType<typeof setTimeout> | undefined;
// Don't auto-report Seen until the initial open position is decided (the first-load watch seeks to
// the first unseen message, or pins to the bottom, then flips this on). Otherwise the observer
// would mark the bottom screenful — and, via catch-up, the whole backlog — Seen on open.
let seenSettled = false;
function setupBubbleObserver(root: HTMLElement | null): void {
  if (!root || !('IntersectionObserver' in window)) return;
  bubbleVisObs?.disconnect();
  // The observer is just a cheap TRIGGER: any bubble crossing in/out re-runs the authoritative
  // geometry scan in markVisibleSeen. (We don't trust the observer's own ratio bookkeeping, which
  // can lag a programmatic jump.)
  bubbleVisObs = new IntersectionObserver(() => markVisibleSeen(), { root, threshold: [0, 0.5, 1] });
  observeBubbles();
}
function observeBubbles(): void {
  if (!bubbleVisObs) return;
  // observe() is idempotent; bubbles removed by the window slide simply stop reporting.
  listEl.value?.querySelectorAll<HTMLElement>('.bubble[data-mid]').forEach((n) => bubbleVisObs!.observe(n));
}
// Report Seen up to the newest incoming message that is currently ≥50% within the scroll viewport
// (catch-up handles everything older). Measures live geometry rather than cached observer state, so
// it's correct right after a programmatic jump. DEBOUNCED to the scroll settling (~220ms quiet):
// during a fling/seek the observer fires constantly, but we only read the store + send once the
// view comes to rest — so it adds no per-frame cost to scrolling (spec 1013 perf, T020) and won't
// mark messages merely flung past.
function markVisibleSeen(): void {
  clearTimeout(markSeenTimer);
  markSeenTimer = setTimeout(() => void runMarkVisibleSeen(), 220);
}
async function runMarkVisibleSeen(): Promise<void> {
  if (!seenSettled) return; // wait until the initial open position (first-unseen vs bottom) settles
  if (seeking) return; // don't let a Seen write supersede an in-flight seek (token race)
  if (!viewActive.value || document.visibilityState !== 'visible') return;
  const el = scrollEl;
  if (!el) return;
  const vTop = el.getBoundingClientRect().top;
  const vBot = vTop + el.clientHeight;
  let newestTs = -Infinity;
  let newestId: string | null = null;
  for (const n of Array.from(listEl.value?.querySelectorAll<HTMLElement>('.bubble[data-mid]') ?? [])) {
    const r = n.getBoundingClientRect();
    if (r.height <= 0) continue;
    const visible = Math.min(r.bottom, vBot) - Math.max(r.top, vTop);
    if (visible / r.height < 0.5) continue; // <50% on screen → not "seen"
    const mid = n.dataset.mid;
    const m = mid ? rows.value.find((x) => x.id === mid) : undefined;
    if (!m || m.outgoing || m.deleted) continue; // incoming, non-deleted only
    if (m.timestamp > newestTs || (m.timestamp === newestTs && newestId !== null && m.id > newestId)) {
      newestTs = m.timestamp;
      newestId = m.id;
    }
  }
  if (!newestId) return;
  await reportSeenUpTo(chatId, newestId);
  await recomputeUnread(); // the marks dropped the not-yet-Seen count → shrink the pill
}
// Re-attempt Seen for what's on screen when the transport reconnects (offline sends are retried).
const { syncState } = useSync();
watch(syncState, (s) => {
  if (s === 'online') markVisibleSeen();
});

onMounted(() => {
  void markChatRead(chatId);
  void resumePendingMediaJobs(); // restart any compressions interrupted by a reload
  void loadDraft(); // restore an unsent message (text + caret + reply) if you left one here
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
  void persistDraft(); // leaving the chat → keep the unsent message for next time
  document.removeEventListener('visibilitychange', onVisibilityChange);
  clearTimeout(headerReadyFallback);
  clearTimeout(listReadyFallback);
  resizeObs?.disconnect();
  windowObs?.disconnect();
  bubbleVisObs?.disconnect();
  clearTimeout(markSeenTimer);
});
// Report Seen ONLY when the user is genuinely looking at this chat: its view is the active one AND
// the app is foregrounded (document visible). Spec 1013: this no longer bulk-marks the whole chat —
// it asks the visibility observer to report Seen for the messages actually on screen (and older,
// via catch-up). A message that arrived via push while backgrounded is NOT marked until the chat
// is foregrounded and the message is on screen. markVisibleSeen is itself foreground-gated and the
// send is a no-op when the "Seen receipts" privacy toggle is off.
function markChatSeenIfVisible(): void {
  if (viewActive.value && document.visibilityState === 'visible') {
    markVisibleSeen();
    void sendDownloadedReceipts(chatId); // free server blobs once we hold the media
  }
}

onIonViewDidEnter(() => {
  viewActive.value = true;
  headerReady.value = true; // transition done → fade the header in at rest
  observeScroll(); // resolve + observe the scroll element (re-pin on keyboard/resize)
  setActiveChat(chatId); // suppress in-app banners for the chat we're viewing
  void markChatRead(chatId);
  markChatSeenIfVisible(); // the initial open-at-first-unseen is owned by the first-load watch
  scheduleShareHint();
  // Spec 1014: at idle (after the chat has painted), upgrade this chat's existing media to the
  // grid/strip thumbnail tiers in small bounded batches, so legacy photos shared before tiers
  // existed render right-sized in the album grid + viewer strip without a re-download.
  scheduleThumbBackfill();
  // Entered with ?search=1 (from the contact-info "Search" action) → open search.
  if (route.query.search) showSearch.value = true;
  // Entered with ?jump=<id> (e.g. from the Starred list) → seek to that message; for a
  // starred message older than the loaded window, scrollToMessage loads the intervening
  // history and centers it (INV-6 / US3) rather than failing.
  if (route.query.jump) {
    void nextTick(() => void scrollToMessage(String(route.query.jump)));
  }
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
    // Backgrounded (incl. an iOS app close that starts here): flush the unsent message AND its staged
    // attachments now, while we still can, so they survive a full termination.
    void persistDraft();
    void persistDraftMedia();
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
  void persistDraft(); // navigating away within the app → save the unsent message …
  void persistDraftMedia(); // … and its staged attachments (fires before unmount clears them)
  stopActivity(); // leaving the chat ends any outgoing activity indicator (spec 1009)
  clearTimeout(shareHintTimer);
  dismissShareHintToast(); // don't let the hint linger on other pages
  void dismissOpenPopovers(); // a quick-react/menu popover must not linger after leaving
});

// ---- bounded, incrementally-updated history (spec 1011) ----
// The rendered list is sourced from a bounded run (useChatHistory bounds it to MAX_ROWS)
// instead of the whole chat, keeping the mounted DOM bounded however far you scroll
// (FR-012/013). Older/newer pages are read in batches; the read position is held by the
// top/bottom spacers (NOT scrollTop) so native momentum is never interrupted. The whole-chat
// media viewer + audio playlist keep their own whole-chat source (allMedia) — they span the
// entire chat by design (spec 1005/1007).
const history = useChatHistory(chatId, search);
const rows = history.rows;
const hasOlder = history.hasOlder;
const olderUnloaded = history.olderUnloaded;
const newerUnloaded = history.newerUnloaded;
// Whole-chat media subset (image/video/voice/audio) for the viewer + audio playlist; the
// list spans the loaded run, but those features span the whole chat.
const allMedia = useLiveQuery(() => listChatMediaAll(chatId), ['messages'], [] as Message[]);

// The list renders the WHOLE loaded run — useChatHistory already bounds it to MAX_ROWS, so
// no separate render-window is needed. Messages older/newer than the run are represented by
// top/bottom SPACERS so the scroll range reflects the whole chat without holding it.
//
// CRUCIAL (spec 1011): a prepend/eviction is compensated by changing the TOP SPACER's height
// (a layout change applied imperatively BEFORE paint), NEVER by writing scrollTop. Writing
// scrollTop mid-fling stops iOS momentum dead (the fling halts at the load point); iOS also
// has no `overflow-anchor`, so the spacer is the only way to keep the read position stable
// without fighting the native scroller. The bottom spacer is purely cosmetic (it's below the
// viewport, so its size never shifts what the user sees).
const visibleMessages = computed(() => rows.value);
const topSpacer = ref<HTMLElement | null>(null);
const topPadPx = ref(0); // older-unloaded headroom; withScrollAnchor adjusts it live
const avgRowH = ref(64); // measured average rendered row height (for spacer sizing)
const botPadPx = computed(() => Math.round(newerUnloaded.value * avgRowH.value));

// Set the top spacer height. We write the DOM imperatively (synchronous, before the next
// paint) so a prepend + its compensation land in the same frame — no flash — while the ref
// keeps Vue's binding in sync. Clamped ≥ 0.
function setTopPad(px: number): void {
  const v = Math.max(0, Math.round(px));
  topPadPx.value = v;
  if (topSpacer.value) topSpacer.value.style.height = `${v}px`;
}
// Average rendered bubble height — drives spacer sizing (an estimate; positions are kept
// exact by the measured spacer correction, this only affects the scrollbar proportion).
function measureAvgRowH(): void {
  const r = renderedRows();
  if (r.length < 2) return;
  const span = r[r.length - 1].top - r[0].top;
  if (span > 0) avgRowH.value = Math.max(24, span / (r.length - 1));
}
// Re-seed the top spacer from the older-unloaded estimate (first load / chat / search switch).
// During scrolling, withScrollAnchor owns topPadPx precisely.
function reseedTopPad(): void {
  measureAvgRowH();
  setTopPad(olderUnloaded.value * avgRowH.value);
}

// A new bottom message marks the chat seen + auto-follows to the newest — but only when
// already pinned there (stickBottom) or it's our own send, never while reading history. The
// first populated load reveals the list once scrolled to newest (no flash of the oldest).
let didInitialLoad = false;
watch(
  () => rows.value[rows.value.length - 1]?.id,
  async (newestId, prevId) => {
    markChatSeenIfVisible();
    if (!didInitialLoad) {
      didInitialLoad = true;
      if (!search.value && rows.value.length) {
        // Spec 1013: open at the first not-yet-Seen message (unread-divider style) so reading down
        // advances Seen; only fall back to the newest when caught up. This is the authoritative
        // initial-position decision, so it must own the pin (onIonViewDidEnter would race it).
        await recomputeUnread();
        // Automatic open position — never error-toast if the first-unseen target can't be
        // landed (deleted/tombstoned row, virtualization race); fall back to the newest.
        const landed =
          unreadCount.value > 0 && firstUnreadId.value
            ? await scrollToMessage(firstUnreadId.value, { instant: true, silent: true })
            : false;
        if (!landed) {
          stickBottom = true;
          await scrollToNewest();
        }
        reseedTopPad();
      }
      seenSettled = true; // initial position decided → the observer may now report Seen
      listReady.value = true;
      markChatSeenIfVisible(); // mark what's actually on screen (landed first-unseen, or bottom)
      return;
    }
    if (search.value || !newestId || newestId === prevId) return; // not a new bottom message
    if (seeking) return; // a seek is swapping the window — don't yank back to the newest
    const newest = rows.value[rows.value.length - 1];
    if (newest?.outgoing || stickBottom) await scrollToNewest();
  },
);
// Search reloads the run; re-seed the spacer for the fresh result set.
watch(search, () => void nextTick(reseedTopPad));

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

// spec 1020: the most recent loaded message that @mentions me (for the header
// jump-to-mention button). Incoming only — you don't "jump to" your own message.
const lastMentionId = computed<string | null>(() => {
  if (!chat.value?.isGroup) return null;
  const list = visibleMessages.value;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m.outgoing && (m.mentions?.includes(selfId) || m.mentionsEveryone)) return m.id;
  }
  return null;
});
function jumpToMention(): void {
  if (lastMentionId.value) void scrollToMessage(lastMentionId.value);
}

// First 4 cells of an album, plus the "+N more" overlay count on the 4th.
const albumCells = (msgs: Message[]) => msgs.slice(0, 4);
const albumOverlay = (msgs: Message[]) => (msgs.length > 4 ? msgs.length - 3 : 0);

// ---- spacer-anchored loading (keeps the read position WITHOUT touching scrollTop) ----
// The list's [data-mid] bubbles, top→bottom, as {id, top} for the anchor math.
function renderedRows(): { id: string; top: number }[] {
  const nodes = listEl.value?.querySelectorAll<HTMLElement>('.bubble[data-mid]');
  if (!nodes) return [];
  return Array.from(nodes).map((n) => ({ id: n.dataset.mid!, top: n.getBoundingClientRect().top }));
}
// Run a rows mutation (prepend older / append newer / trim) while keeping the message under
// the user's eye stationary — by adjusting the TOP SPACER's height, never scrollTop. Capture
// the topmost rendered bubble, mutate, re-measure: the anchor moved by exactly the height
// added/removed above it (the mutation happened in one task, so the user's fling didn't move
// it in between). Shrinking/growing the spacer by that delta cancels the shift. Because it's a
// layout change (not a scroll write) applied imperatively BEFORE the next paint, the native
// fling is never interrupted (no iOS momentum stall) and there's no visible jump. If the
// spacer can't absorb it all (at the very top, where momentum is ending anyway), the small
// remainder falls back to scrollTop. Gated on the view being active/foregrounded (FR-014).
async function withScrollAnchor(mutate: () => void | Promise<void>): Promise<void> {
  const el = await ensureScrollEl();
  const active = () => viewActive.value && document.visibilityState === 'visible';
  const anchor = el && active() ? pickAnchor(renderedRows()) : null;
  await mutate();
  await nextTick();
  measureAvgRowH();
  if (!el || !anchor || !active()) return;
  const delta = resolveAnchorDelta(anchor, renderedRows()); // how far the anchor moved
  if (delta == null || delta === 0) return;
  const target = topPadPx.value - delta; // shrink spacer when content was added above, etc.
  if (target < 0) {
    el.scrollTop += -target; // spacer exhausted (very top): take the remainder on scrollTop
    setTopPad(0);
  } else {
    setTopPad(target);
  }
}

let loadingOlder = false;
let loadingNewer = false;
// Page older content before the top edge is reached (look-ahead). Prepend a batch via
// useChatHistory; the spacer absorbs the height it adds so the read position holds and the
// fling keeps going. When there's no more older, snap the spacer to 0 (we're at the top).
async function loadOlder(ev?: InfiniteScrollCustomEvent): Promise<void> {
  if (loadingOlder || !history.hasOlder.value) {
    void ev?.target.complete();
    return;
  }
  loadingOlder = true;
  try {
    await withScrollAnchor(async () => {
      await history.loadOlder();
    });
    if (!history.hasOlder.value) setTopPad(0); // reached the oldest message → no headroom left
  } finally {
    loadingOlder = false;
    void ev?.target.complete();
  }
}
// Downward re-entry: re-append newer rows that were trimmed while scrolling up. The head-trim
// removes rows above the viewport; withScrollAnchor grows the spacer to compensate.
async function loadNewer(): Promise<void> {
  if (loadingNewer || !history.hasNewer.value) return;
  loadingNewer = true;
  try {
    await withScrollAnchor(async () => {
      await history.loadNewer();
    });
  } finally {
    loadingNewer = false;
  }
}

// Resolve on-device media (Blobs) to object URLs for rendering.
interface MediaInfo {
  url?: string; // full-resolution original; undefined once freed to save space (spec 1014 FR-018)
  posterUrl?: string; // bubble tier (≤512) — chat bubble + viewer main fallback
  gridUrl?: string; // grid tier (≤320) — album grid cells (spec 1014)
  stripUrl?: string; // strip tier (≤128) — viewer bottom thumbnail strip (spec 1014)
  animated?: boolean; // GIF / animated WebP → bubble plays the moving original while visible
  mime: string;
  name: string;
}

const mediaInfo = ref<Record<string, MediaInfo>>({});
// Resolved object URLs are bounded so a very long, media-heavy chat doesn't keep
// every poster/cover decoded and every blob URL alive at once. We keep at most
// MAX_MEDIA live, evicting the least-recently-used items that are neither on screen
// nor pinned by an open viewer, and revoking their URLs. Far-scrolled media is
// re-resolved lazily when it scrolls back (spec 1005 FR-003/004/005).
const MAX_MEDIA = 60;
const mediaLru: string[] = []; // mediaIds, least-recently-used first
function touchMedia(id: string): void {
  const i = mediaLru.indexOf(id);
  if (i !== -1) mediaLru.splice(i, 1);
  mediaLru.push(id);
}
// Media ids the full-screen viewer is currently showing — never evict these while
// it's open (it can swipe across all of the chat's media).
const viewerPins = ref<Set<string>>(new Set());

// The on-screen window (plus viewer pins) that eviction must never touch.
function currentMediaKeep(): Set<string> {
  const keep = new Set<string>(viewerPins.value);
  for (const m of visibleMessages.value) if (m.mediaId) keep.add(m.mediaId);
  return keep;
}

// Resolve on-device media (Blobs) → object URLs for the GIVEN messages only — the
// rendered window, or all chat media when the viewer opens — so opening a long
// media chat doesn't eagerly decode every poster/cover up front. Already-resolved
// items are just marked recently-used (reused, never recreated per render).
async function resolveMediaFor(list: Message[]): Promise<void> {
  for (const m of list) {
    if (!m.mediaId) continue;
    if (mediaInfo.value[m.mediaId]) {
      touchMedia(m.mediaId);
      continue;
    }
    const media = await get<Media>('media', m.mediaId);
    if (!media) continue;
    const info: MediaInfo = {
      // undefined when the original was freed to save space (spec 1014 FR-018) — the bubble/grid
      // still render from the tiers below, and the viewer falls back to the thumb / placeholder.
      url: media.blob ? URL.createObjectURL(media.blob) : undefined,
      // Poster precedence: a persisted posterBlob, else the sender-embedded
      // posterData (a stable data URL). Feeding posterData into posterUrl means the
      // viewer, bottom slider and Media grid (which read posterUrl, not the message)
      // show a video's thumbnail too — not just the chat bubble (spec 1007 FR-001).
      posterUrl: media.posterBlob
        ? URL.createObjectURL(media.posterBlob)
        : m.kind === 'video'
          ? m.posterData
          : undefined,
      // Right-sized tiers for the grid (320) and strip (128); fall back to the bubble
      // tier (then resolved below for legacy media that predates the tiers). Spec 1014.
      gridUrl: media.posterGrid ? URL.createObjectURL(media.posterGrid) : undefined,
      stripUrl: media.posterStrip ? URL.createObjectURL(media.posterStrip) : undefined,
      mime: media.mime,
      name: media.name,
    };
    mediaInfo.value[m.mediaId] = info;
    touchMedia(m.mediaId);
    // Videos: prefer the sent thumbnail (m.posterData, a stable data URL).
    // Otherwise derive one from the first frame and PERSIST it (posterBlob) so it
    // isn't regenerated/lost on every remount.
    if (m.kind === 'video' && !info.posterUrl && !m.posterData && media.blob) {
      const blob = media.blob;
      const mid = m.mediaId;
      void generateVideoPoster(blob).then(async (poster) => {
        if (!poster || !mediaInfo.value[mid]) return; // evicted before it resolved
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
    // Images: derive a small thumbnail (stored as posterBlob) the bubble/grid/strip
    // render instead of the full image, so scroll-back doesn't re-decode full-res
    // photos. The full image is still used in the viewer. Persist so it's one-time.
    if (m.kind === 'image' && !info.posterUrl && media.blob) {
      const blob = media.blob;
      const mid = m.mediaId;
      void generateImageThumb(blob).then(async (thumb) => {
        const info2 = mediaInfo.value[mid];
        if (!info2) return; // evicted before it resolved
        if (!thumb) {
          // Small image (or decode failed): the original IS the thumbnail — so the
          // bubble (which renders posterUrl) still has something light to show.
          mediaInfo.value[mid] = { ...info2, posterUrl: info2.url };
          return;
        }
        mediaInfo.value[mid] = { ...info2, posterUrl: URL.createObjectURL(thumb) };
        try {
          const md = await get<Media>('media', mid);
          if (md && !md.posterBlob) {
            md.posterBlob = thumb;
            md.updatedAt = Date.now();
            await put('media', md);
          }
        } catch {
          /* best-effort cache */
        }
      });
    }
    // Images: flag animated GIF / animated WebP so the bubble renders the moving
    // original (autoplaying while visible) instead of a static poster (spec: GIFs
    // autoplay in chat). Static images/photos keep the lightweight poster path.
    if (m.kind === 'image' && media.blob) {
      const blob = media.blob;
      const mid = m.mediaId;
      const mime = media.mime;
      void isAnimatedImage(mime, blob).then((animated) => {
        if (animated && mediaInfo.value[mid]) mediaInfo.value[mid] = { ...mediaInfo.value[mid], animated: true };
      });
    }
    // Audio (shared music): pull embedded cover art for the track card.
    if (m.kind === 'audio' && !info.posterUrl && media.blob) {
      const blob = media.blob;
      const mid = m.mediaId;
      void readAudioTags(blob).then((tags) => {
        if (tags.cover && mediaInfo.value[mid]) {
          mediaInfo.value[mid] = { ...mediaInfo.value[mid], posterUrl: URL.createObjectURL(tags.cover) };
        }
      });
    }
  }
}

// Spec 1014: idle, bounded backfill of this chat's media to the grid/strip tiers. Each slice
// upgrades a handful of records and reschedules until the chat's media is fully tiered or we leave
// the view, so it never competes with scroll/decoding on the hot path. Idempotent (already-tiered
// records are skipped), so re-entering the chat just resumes where it left off.
let thumbBackfillRunning = false;
function scheduleThumbBackfill(): void {
  if (thumbBackfillRunning) return;
  thumbBackfillRunning = true;
  const idle = (cb: () => void): void => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (ric) ric(cb);
    else window.setTimeout(cb, 400);
  };
  const tick = (): void => {
    if (!viewActive.value) {
      thumbBackfillRunning = false;
      return;
    }
    const ids = chatMediaMsgs.value.map((m) => m.mediaId).filter((id): id is string => !!id);
    void backfillThumbTiers(ids, 8).then((n) => {
      if (n > 0 && viewActive.value) idle(tick); // upgraded a batch — more may remain, keep nibbling
      else thumbBackfillRunning = false;
    });
  };
  idle(tick);
}

// Release least-recently-used media that's neither on screen nor pinned, revoking
// its URLs so memory stays bounded in very long chats.
function evictMedia(): void {
  if (mediaLru.length <= MAX_MEDIA) return; // nothing over the cap — skip the Set + scan
  const keep = currentMediaKeep();
  for (const id of selectEvictions(mediaLru, keep, MAX_MEDIA)) {
    const mi = mediaInfo.value[id];
    if (mi) {
      if (mi.url) URL.revokeObjectURL(mi.url);
      if (mi.posterUrl) URL.revokeObjectURL(mi.posterUrl);
      if (mi.gridUrl) URL.revokeObjectURL(mi.gridUrl);
      if (mi.stripUrl) URL.revokeObjectURL(mi.stripUrl);
      delete mediaInfo.value[id];
    }
    const i = mediaLru.indexOf(id);
    if (i !== -1) mediaLru.splice(i, 1);
  }
}

// Resolve media for the rendered window as it grows/changes (look-ahead paging
// extends `visibleMessages` before the user reaches the top), then evict far LRU.
// Keyed on the visible MEDIA SET (mediaIds), not the array identity — so a status
// tick or reaction (which patches a row in place via useChatHistory) does NOT re-run
// IndexedDB reads + URL allocation + eviction on the scroll hot path.
watch(
  () => visibleMessages.value.map((m) => m.mediaId ?? '').join('|'),
  async () => {
    await resolveMediaFor(visibleMessages.value);
    evictMedia();
  },
  { immediate: true },
);

// Revoke every resolved object URL when leaving the chat so they don't leak across
// chat opens (the cache only lives for this view).
onUnmounted(() => {
  for (const mi of Object.values(mediaInfo.value)) {
    if (mi.url) URL.revokeObjectURL(mi.url);
    if (mi.posterUrl) URL.revokeObjectURL(mi.posterUrl);
    if (mi.gridUrl) URL.revokeObjectURL(mi.gridUrl);
    if (mi.stripUrl) URL.revokeObjectURL(mi.stripUrl);
  }
});

// Keep the open viewer consistent when its item set changes under it — a message
// deleted or its media cleared while the viewer is open (spec 1014 FR-007). Empty →
// close and release the media pins (so eviction can reclaim the just-freed window);
// otherwise reconcile the opener index so it never points past the end. (Defined here,
// after `messages`, because watch() evaluates its source once at setup.)
watch(viewerItems, (items, prev) => {
  if (!viewer.value.open) return;
  if (items.length === 0) {
    viewer.value.open = false;
    viewerPins.value = new Set();
    evictMedia();
    return;
  }
  if (viewer.value.start > items.length - 1) viewer.value.start = items.length - 1;
  // Item set shrank (a message deleted / its media cleared while the viewer is open): drop
  // pins for the now-gone media and reclaim its blob URLs immediately, instead of waiting
  // for the next swipe to rebuild the window. Gated on an actual shrink so this never runs
  // on the resolve hot path (viewerItems also recomputes as thumbnails decode). FR-007/009.
  if (prev && items.length < prev.length) {
    const liveIds = new Set(chatMediaMsgs.value.map((m) => m.mediaId).filter((id): id is string => !!id));
    viewerPins.value = new Set([...viewerPins.value].filter((id) => liveIds.has(id)));
    evictMedia();
  }
});

// Jump to the newest message (the bottom of the natural-order list), e.g. after
// sending, including a reply when scrolled up to the quoted message.
const contentEl = ref<{ $el: HTMLElement } | null>(null);
const listEl = ref<HTMLElement | null>(null);
// Look-ahead sentinels (spec 1011 D5): observed by an IntersectionObserver rooted on the
// scroll element with rootMargin = LOOK_AHEAD_PX, so older/newer pages load before an edge.
const topSentinel = ref<HTMLElement | null>(null);
const bottomSentinel = ref<HTMLElement | null>(null);
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
// When the user last scrolled (genuine, non-echo). The ResizeObserver re-pin must NOT
// fire while a fling is still in flight — a programmatic scrollTop write mid-inertia
// fights iOS WebKit's native momentum and stutters/teleports. We only re-pin once the
// fling has settled (no user scroll for a beat).
let lastScrollAt = 0;
const MOMENTUM_QUIET_MS = 220;
// Scroll direction of the last genuine user scroll — gates the look-ahead sentinels so the
// opposite-direction one can't fire mid-fling (spec 1011: prevents the bottom sentinel from
// tugging the window toward newer content during an up-fling). -1 = not yet measured.
let lastScrollTop = -1;
let scrollDir: 'up' | 'down' = 'up';
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
// ---- "scroll to latest" floating control (spec 1012) ----
// Fades in when scrolled up from the newest message; tapping jumps to the first unread
// (earliest incoming since the user left the bottom) or, with none, the newest. The badge
// counts incoming-only messages received while scrolled up. Pure logic in chat-unread.ts.
const JUMP_SHOW_PX = 600; // ≈ one screen: appear once scrolled this far from the bottom
const JUMP_HIDE_PX = 120; // hide within the same band the pin uses (nearBottom)
const jumpVisible = ref(false);
// Not-yet-Seen pill state (spec 1013): how many incoming messages this device hasn't reported
// Seen yet, and the first such message (the open-at / tap target). Derived from the persisted
// per-message `seenReportedAt` via recomputeUnread() — this replaces spec 1012's scroll-boundary
// count, so the pill reflects what's actually unseen (and the sender hasn't been told you've seen).
const unreadCount = ref(0);
const firstUnreadId = ref<string | null>(null);
const jumpBadge = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)));
// Pill width (px): a plain 40px circle at rest, growing with the digit count when expanded
// (ion-fab-button's native is absolutely positioned, so the host can't auto-size to content — we
// set the width explicitly and animate it). The native's fixed 20px radius keeps stadium caps.
const pillWidth = computed(() => (unreadCount.value > 0 ? 44 + jumpBadge.value.length * 11 : 40));
const jumpLabel = computed(() =>
  unreadCount.value > 0
    ? `${unreadCount.value} new message${unreadCount.value === 1 ? '' : 's'}, scroll to latest`
    : 'Scroll to latest',
);
// Count the not-yet-Seen incoming messages (those without `seenReportedAt`) and the first such
// message — everything after the seen frontier. Reads the chat's messages so the count is correct
// even for a backlog larger than the loaded window; recomputed on message change and right after
// marking Seen (the persisted flag is the source of truth, so this stays accurate across restarts).
async function recomputeUnread(): Promise<void> {
  // The not-yet-Seen messages are the newest block (everything after the seen frontier), so a
  // BOUNDED read of the newest rows is enough — and essential: a full read of a 5k-message chat on
  // every change would starve scrolling/seeks (the count is display-capped at 99+ anyway).
  const recent = await listMessagesOlder(chatId, null, 200);
  // When NOTHING has been reported yet the frontier is null — which for unreadSince means "pinned
  // to bottom → 0" (the spec-1012 sense), the OPPOSITE of what we want (all incoming are unseen).
  // Coalesce to a before-everything boundary so a fresh/unseen backlog counts in full.
  const frontier = seenFrontier(recent, selfId) ?? { ts: -Infinity, id: '' };
  const { count, firstId } = unreadSince(recent, frontier, selfId);
  unreadCount.value = count;
  firstUnreadId.value = firstId;
}
// New / removed messages → recount (the change bus bumps history.total). Marking Seen recomputes
// explicitly in markVisibleSeen, since a field update doesn't change the total.
watch(
  () => history.total.value,
  () => void recomputeUnread(),
);
// Re-observe bubbles whenever the rendered window changes (slide / new message) so the freshly
// rendered bubbles get visibility callbacks (observe() is idempotent for ones already tracked).
watch(
  () => [rows.value.length, rows.value[0]?.id, rows.value[rows.value.length - 1]?.id].join('|'),
  () => void nextTick(observeBubbles),
);
// Tap: jump to the first not-yet-Seen message when there is one, else the newest. The count
// clears itself as those messages scroll into view and get reported Seen (no manual reset).
async function onJumpToLatest(): Promise<void> {
  const target = unreadCount.value > 0 ? firstUnreadId.value : null;
  if (target) await scrollToMessage(target);
  else await scrollToNewest();
}

async function scrollToNewest(): Promise<void> {
  // If we trimmed the newest rows while scrolling up (hasNewer), `rows` no longer holds the
  // bottom of the chat — reload the newest batch so the newest message is actually rendered
  // before we pin to it.
  if (history.hasNewer.value) await history.reload();
  setTopPad(olderUnloaded.value * avgRowH.value); // older content sits above; bottom spacer is 0
  await nextTick();
  const el = await ensureScrollEl();
  if (!el) return;
  el.scrollTop = el.scrollHeight; // now lands on the newest row (botPad is 0 at the bottom)
  stickBottom = true;
  suppressStickUntil = Date.now() + 250;
  // We're at the newest now → hide the control (the count clears itself as the now-visible bottom
  // messages get reported Seen by the visibility observer).
  jumpVisible.value = false;
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
  if (isSelfEcho(Date.now(), suppressStickUntil)) return; // our own pin/correction echo
  lastScrollAt = Date.now(); // genuine user scroll (the pin echo is suppressed above)
  const top = scrollEl?.scrollTop ?? 0;
  if (lastScrollTop >= 0 && top !== lastScrollTop) scrollDir = top < lastScrollTop ? 'up' : 'down';
  lastScrollTop = top;
  stickBottom = nearBottom();
  // Scroll-to-latest control: show/hide with hysteresis off the distance to the bottom. The
  // not-yet-Seen count is driven by the visibility observer + recomputeUnread, not by the scroll
  // boundary (spec 1013), so there's nothing to set here.
  const dist = scrollEl ? scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight : 0;
  jumpVisible.value = jumpButtonVisible(dist, jumpVisible.value, JUMP_SHOW_PX, JUMP_HIDE_PX);
}

async function send() {
  const text = normalizeOutgoing(draft.value);
  if (!text && !pendingMedia.value.length) return;
  if (peerGhosted.value || peerBlocked.value) return; // composer is hidden anyway; backstop
  stopActivity(); // the message is going out → end any activity indicator (spec 1009)

  // Editing: Send rewrites the original message instead of creating a new one.
  if (editingMsg.value && text) {
    const target = editingMsg.value;
    editingMsg.value = null;
    draft.value = '';
    clearComposerDraft();
    await editMessage(target.id, text);
    return;
  }

  // Staged media (picked OR pasted) go out with the typed text as the caption. With 2+
  // photos/videos the user picks Album (one swipeable post, default) or Individual. Either
  // way the composer caption reaches EVERY item without a per-item caption of its own
  // (spec 2019) — in an album the viewer shows a per-slide caption, so captioning only the
  // first slide left the rest blank. Files are never part of an album.
  if (pendingMedia.value.length) {
    // Quality is applied silently PER KIND from the resolved settings (photo vs video, per-chat
    // override else the global Upload-quality) — no prompt. A source below the tier is never
    // upscaled, so a high setting is safe; GIF/WebP images send untouched regardless.
    const photoQ = await resolveSendQuality('image');
    const videoQ = await resolveSendQuality('video');
    const items = pendingMedia.value.slice();
    pendingMedia.value = [];
    const caption = text;
    draft.value = '';
    clearComposerDraft();
    // Re-mint the composer (spec 2019): clearing the staged media reverts the
    // textarea's :maxlength from the caption cap back to undefined, and on iOS
    // WebKit toggling maxlength rebuilds ion-textarea's inner native <textarea> —
    // the rebuilt element loses its value/input wiring, so after sending, keystrokes
    // reached a dead field and NOTHING typed showed up until the user left and
    // re-entered the chat (which remounts the composer). Bumping :key remounts just
    // this element in place — the same clean instance leaving-and-returning gives —
    // then we re-focus the fresh textarea so the keyboard stays usable.
    composerKey.value++;
    await nextTick();
    void nativeComposer().then((ta) => ta?.focus());
    // Plain copy, replyingTo.value is a reactive Proxy, which IndexedDB can't clone.
    const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
    replyingTo.value = null;
    const mediaCount = items.filter((it) => it.kind === 'image' || it.kind === 'video').length;
    const asAlbum = mediaCount > 1 && sendAsAlbum.value;
    const albumId = asAlbum ? crypto.randomUUID() : undefined;
    sendAsAlbum.value = true; // reset the choice for next time
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const inAlbum = !!albumId && (it.kind === 'image' || it.kind === 'video');
      // A per-item caption (set by tapping the thumbnail) wins for that item; otherwise
      // the shared composer caption applies to EVERY item that has no caption of its
      // own (spec 2019) — album or individual alike, so no attachment in the batch
      // goes out silently uncaptioned just because it wasn't first.
      const cap = it.caption || caption || undefined;
      const quality = it.kind === 'image' ? photoQ : it.kind === 'video' ? videoQ : 'original';
      await sendMediaMessage(
        chatId,
        it.kind,
        it.blob,
        it.blob.name || (it.kind === 'file' ? 'file' : 'photo'),
        undefined,
        { replyTo: i === 0 ? reply : undefined, caption: cap, albumId: inAlbum ? albumId : undefined, quality, ttlOverrideMs: msgTtl.value },
      );
      if (it.url) URL.revokeObjectURL(it.url);
    }
    await scrollToNewest();
    return;
  }

  draft.value = '';
  clearComposerDraft();
  mentionQuery.value = null; // close the autocomplete
  // @mentions (spec 1020): resolve the body's @tokens to member ids + an honored @everyone.
  const { mentions, everyone } = resolveMentions(text);
  // Plain copy, replyingTo.value is a reactive Proxy, which IndexedDB can't clone.
  const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
  replyingTo.value = null;
  await sendMessage(chatId, text, reply, mentions, everyone, msgTtl.value);
  await scrollToNewest();
}

/* ---- attachments ---- */

async function openAttach() {
  // One game at a time per chat (spec 0008 FR-001a, groups included per spec
  // 0009): resolve the gate up front so the sheet can present the entry as
  // unavailable with a brief explanation. In groups the entry throws an OPEN
  // CHALLENGE — the first member to accept becomes the opponent.
  const gameBlocked = await hasOngoingGame(chatId);
  const sheet = await actionSheetController.create({
    header: 'Share',
    buttons: [
      { text: 'Media & File', handler: () => photoInput.value?.click() },
      { text: 'Camera', handler: () => cameraInput.value?.click() },
      { text: 'Location', handler: () => void shareLocation() },
      { text: 'Contact', handler: () => void openContactPicker() },
      { text: 'Poll', handler: () => void openPollComposer() },
      // Games live in 1:1 chats and on the Wall (spec 1036): group chats no
      // longer offer starting one. Existing group games still render and play
      // out — only the entry point is gone.
      ...(chat.value?.isGroup
        ? []
        : [
            {
              text: gameBlocked ? 'Game (one game at a time)' : 'Game',
              cssClass: gameBlocked ? 'attach-game-blocked' : undefined,
              handler: gameBlocked
                ? () => void appToast({ message: 'Finish the game in this chat first.', duration: 2200 })
                : () => void openGamePicker(),
            },
          ]),
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

/* ---- in-chat games (spec 0008) ---- */

const gamePickerOpen = ref(false);
// Which game messages still get the full-width NEUTRAL card row (spec 1033:
// "a game belongs to both players")? Only the legacy INLINE games, whose board
// lives in the bubble. Fullscreen games (chess, armada) show just a compact
// challenge card — that renders as a normal SIDED bubble, so it's obvious who
// threw the challenge, like any other message.
function isInlineGameRow(m: Message): boolean {
  if ((m.kind !== 'game' && m.kind !== 'gamechallenge') || m.deleted || !m.game) return false;
  return GAMES[m.game.gameType]?.presentation !== 'fullscreen';
}

const openGamePicker = () => (gamePickerOpen.value = true);

async function onGamePick(gameType: string, theme?: string): Promise<void> {
  gamePickerOpen.value = false;
  // Re-check the gate at send time — the sheet's answer may be stale by now.
  if (await hasOngoingGame(chatId)) {
    await appToast({ message: 'Finish the game in this chat first.', duration: 2200 });
    return;
  }
  // Groups throw an open challenge (spec 0009); 1:1 starts the game directly.
  if (chat.value?.isGroup) {
    await sendGameChallenge(chatId, gameType, theme);
  } else {
    const messageId = await sendGame(chatId, gameType, theme);
    // Fullscreen-presentation games (spec 1038): the starter lands straight in
    // deployment — the chat only carries the challenge card.
    if (GAMES[gameType]?.presentation === 'fullscreen') {
      openGame({ surface: 'chat', chatId, messageId, gameType });
    }
  }
  void scrollToNewest();
}

/** A challenge card was tapped (spec 1038): into the fullscreen overlay. */
function openFullscreenGame(messageId: string, gameType: string): void {
  openGame({ surface: 'chat', chatId, messageId, gameType });
}

// Seat names for challenge bubbles (spec 0009): every contact by id, plus me.
const gameNames = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const c of contacts.value) map[c.id] = c.name;
  return map;
});

// "Play again" on a finished bubble reopens the style picker — half the fun of
// a rematch is picking a fresh look. Same gate as the picker.
const onGameRematch = (_gameType: string) => openGamePicker();

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
// The video-note recorder being open is the "recording video" activity window
// (spec 1009): emit on open, stop on close (send / cancel / dismiss).
watch(videoNoteOpen, (open) => {
  if (open) startActivity('recording-video');
  else stopActivity('recording-video');
});
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
async function onVideoNoteSend(blob: Blob, dur: number, poster?: string): Promise<void> {
  videoNoteOpen.value = false;
  // Plain copy, replyingTo.value is a reactive Proxy, which IndexedDB can't clone.
  const reply = replyingTo.value ? { ...replyingTo.value } : undefined;
  replyingTo.value = null;
  await sendMediaMessage(chatId, 'video', blob, 'video-note', dur, { videoNote: true, replyTo: reply, poster, ttlOverrideMs: msgTtl.value });
}

// Ask the send quality for photos/videos (WhatsApp-style), offering ONLY the tiers a
// source of this resolution can actually produce — no upscaling, no "4K" on a 720p clip
// (spec 2007). `longEdge` is the largest source's longest pixel edge. When the source is
// below the smallest tier it simply lists Original alone. Returns null on cancel.
// Resolve the send quality for a kind: the chat's per-kind override, else the global Upload-quality
// setting for that kind (photos vs videos). Applied silently at send time — no prompt. A source
// below the tier is never upscaled by the compressor, so a high setting is safe.
async function resolveSendQuality(kind: 'image' | 'video'): Promise<Quality> {
  if (kind === 'image') return chat.value?.sendQualityPhoto ?? (await getSetting<Quality>('storage.uploadQuality.photos', 'hd'));
  return chat.value?.sendQualityVideo ?? (await getSetting<Quality>('storage.uploadQuality.videos', 'hd'));
}

async function onPick(e: Event, mode: 'auto' | 'file') {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ''; // allow re-picking the same file
  if (!files.length) return;
  // Spec 1024 (US3): staging caches the picked blobs on-device until send confirms. Bail up front
  // if there's clearly no room, rather than failing partway through encode/upload.
  const incoming = files.reduce((n, f) => n + f.size, 0);
  if (!(await hasRoomFor(incoming))) {
    void appToast({ message: 'Not enough storage on this device. Free up space and try again.', duration: 2600 });
    return;
  }
  // Picked media now STAGES like a paste (spec 1023) so it can be captioned before
  // sending, and several photos/videos can go as an album or individually — see send().
  // Audio keeps its own title/artist review path.
  // The iOS picker can't be capped (no `max` on a file input), so enforce the limit here: stage up to
  // MAX_STAGED_MEDIA attachments and tell the user if the pick went over. Audio routes to its own
  // queue and isn't counted against this.
  const audioFiles: File[] = [];
  let overCap = false;
  for (const f of files) {
    const isAudio = mediaKindOf(f, mode === 'file') === 'audio';
    if (!isAudio && pendingMedia.value.length >= MAX_STAGED_MEDIA) {
      overCap = true;
      continue;
    }
    if (stageMedia(f, mode === 'file') === 'audio') audioFiles.push(f);
  }
  if (overCap) {
    // A blocking alert (not a toast) so it's read and acknowledged — the extra picks were dropped.
    const a = await alertController.create({
      header: 'Up to 10 at once',
      message: `You can attach up to ${MAX_STAGED_MEDIA} items to one message. The first ${MAX_STAGED_MEDIA} were added; the rest weren’t.`,
      buttons: ['Got it'],
    });
    await a.present();
  }
  if (audioFiles.length) {
    // The pending reply (if any) rides the first audio only when nothing else was staged
    // to consume it — staged media takes the reply on send(). Plain copy: the reactive
    // Proxy can't be cloned into IndexedDB.
    let replyLeft: ReplyRef | undefined =
      pendingMedia.value.length || !replyingTo.value ? undefined : { ...replyingTo.value };
    if (replyLeft) replyingTo.value = null;
    for (const f of audioFiles) {
      queueAudioFile(f, replyLeft);
      replyLeft = undefined;
    }
  }
}

/* ---- audio playback: voice + music via the global single-source player ---- */
// Audio (voice + music) plays through the global single-source player so it keeps
// going when you leave the chat and a hovering controller can drive it (spec 1007).
// Leaving the chat only detaches the playlist auto-advance — it does NOT stop audio.
onUnmounted(detachAudioEnded);

// Audio messages in chronological order, the implicit playlist.
const audioOrder = computed(() =>
  [...allMedia.value]
    .filter((m) => m.kind === 'audio' && !m.deleted && m.mediaId)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((m) => m.id),
);
// Build the now-playing metadata (for the hovering controller) from a message.
function audioMetaFor(id: string): AudioTrackMeta | undefined {
  const m = allMedia.value.find((x) => x.id === id);
  if (!m?.mediaId) return undefined;
  const url = mediaInfo.value[m.mediaId]?.url;
  if (!url) return undefined;
  const who = m.outgoing ? 'You' : chat.value?.isGroup ? m.senderName : chat.value?.name ?? m.senderName;
  if (m.kind === 'audio') {
    return {
      id,
      url,
      title: m.audio?.title || mediaInfo.value[m.mediaId]?.name || 'Audio',
      subtitle: m.audio?.artist,
      coverUrl: mediaInfo.value[m.mediaId]?.posterUrl,
      isVoice: false,
      chatId, // so the hovering controller hides while we're in this chat
    };
  }
  return { id, url, title: 'Voice message', subtitle: who, isVoice: true, chatId };
}
function toggleAudio(id: string): void {
  const meta = audioMetaFor(id);
  if (!meta) return;
  playAudio(meta, playNextAudio);
}
function seekAudio(id: string, frac: number): void {
  if (audioCurId.value === id) seekAudioFrac(frac);
}
function playNextAudio(): void {
  const ids = audioOrder.value;
  const i = audioCurId.value ? ids.indexOf(audioCurId.value) : -1;
  const next = i >= 0 && i + 1 < ids.length ? ids[i + 1] : null;
  if (next) toggleAudio(next);
  else stopAudio();
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
      ttlOverrideMs: msgTtl.value,
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
const recPaused = ref(false); // paused = preview mode (hear it back before sending)
const recElapsed = ref('0:00');
const recBars = ref<number[]>([]); // live amplitude history, scrolling
const recPlaying = ref(false); // preview playback state (while paused)
const recRate = ref(1); // preview playback speed
let recorder: MediaRecorder | null = null;
let recChunks: BlobPart[] = [];
let recTimer: number | undefined; // elapsed display
let recSampler: number | undefined; // waveform sampler
let recAudioCtx: AudioContext | null = null;
let recAnalyser: AnalyserNode | null = null;
let recAccumMs = 0; // active recording time across pauses
let recSegStart = 0; // current segment start
let recPreviewEl: HTMLAudioElement | null = null; // plays the recorded-so-far on pause
let recPreviewUrl: string | null = null;
let recWantPreview = false; // a requestData() flush is pending → (re)build the preview

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

// Build (or rebuild) the preview player from the audio captured so far, so the user
// can hear what they've recorded while paused. A partial webm/fragmented-mp4 stream
// (the chunks emitted by the timeslice + requestData flush) is itself playable.
function buildPreview(): void {
  stopPreview();
  const mime = recorder?.mimeType || 'audio/webm';
  recPreviewUrl = URL.createObjectURL(new Blob(recChunks, { type: mime }));
  if (!recPreviewEl) {
    recPreviewEl = new Audio();
    recPreviewEl.preload = 'auto';
    recPreviewEl.addEventListener('play', () => (recPlaying.value = true));
    recPreviewEl.addEventListener('pause', () => (recPlaying.value = false));
    recPreviewEl.addEventListener('ended', () => (recPlaying.value = false));
  }
  recPreviewEl.src = recPreviewUrl;
  recPreviewEl.playbackRate = recRate.value;
}
function stopPreview(): void {
  recPreviewEl?.pause();
  recPlaying.value = false;
  if (recPreviewUrl) {
    URL.revokeObjectURL(recPreviewUrl);
    recPreviewUrl = null;
  }
}
function togglePreview(): void {
  if (!recPreviewEl) return;
  if (recPlaying.value) recPreviewEl.pause();
  else void playWhenReady(recPreviewEl);
}
function cycleRecRate(): void {
  recRate.value = nextRate(recRate.value);
  if (recPreviewEl) recPreviewEl.playbackRate = recRate.value;
}

function teardownRec(): void {
  if (recTimer) clearInterval(recTimer);
  recTimer = undefined;
  stopSampler();
  stopPreview();
  recPreviewEl = null;
  recWantPreview = false;
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
    recorder.ondataavailable = (ev) => {
      if (ev.data.size) recChunks.push(ev.data);
      // A pause requested a flush so we could preview the recording-so-far.
      if (recWantPreview) {
        recWantPreview = false;
        buildPreview();
      }
    };
    // Timeslice so chunks land continuously — that's what lets us assemble a playable
    // preview blob mid-recording (and keeps "continue from the end" one stream).
    recorder.start(500);
    // Tap the mic stream for a live waveform.
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    recAudioCtx = new AC();
    // A freshly created AudioContext often starts SUSPENDED (autoplay policy), and a
    // suspended context feeds the analyser nothing → getByteTimeDomainData stays at the
    // 128 midline → the waveform reads flat even while you speak. We start recording from
    // a tap, so resuming here is allowed and reliable.
    void recAudioCtx.resume().catch(() => {});
    recAnalyser = recAudioCtx.createAnalyser();
    recAnalyser.fftSize = 512;
    recAudioCtx.createMediaStreamSource(stream).connect(recAnalyser);
    recBars.value = [];
    recPaused.value = false;
    recPlaying.value = false;
    recRate.value = 1;
    recWantPreview = false;
    recAccumMs = 0;
    recSegStart = Date.now();
    recording.value = true;
    recElapsed.value = '0:00';
    recTimer = window.setInterval(tickElapsed, 200);
    startSampler();
    startActivity('recording-audio'); // tell the peer we're recording a voice message (spec 1009)
  } catch (err) {
    // Say WHY (permission blocked vs. no mic vs. in use) instead of a dead-end "unavailable",
    // and give it long enough to read the fix — the usual cause on Android is the app's mic
    // permission being off at the OS level, which only the user can turn back on.
    await appToast({ message: describeMediaError(err, 'microphone'), duration: 4000 });
  }
}

function togglePause(): void {
  if (!recorder) return;
  if (recPaused.value) {
    // Resume = continue the SAME recording from where it left off (mic button).
    stopPreview();
    recorder.resume();
    recPaused.value = false;
    recSegStart = Date.now();
    startSampler();
  } else {
    // Pause = stop capturing and offer a preview (play button + speed). Flush the
    // recorder first so the preview includes audio right up to the pause point.
    recAccumMs += Date.now() - recSegStart;
    recPaused.value = true;
    stopSampler();
    recWantPreview = true;
    try {
      recorder.requestData(); // → ondataavailable → buildPreview()
    } catch {
      recWantPreview = false;
    }
    recorder.pause();
    // Fallback if requestData didn't deliver a chunk (older browsers): build anyway.
    setTimeout(() => {
      if (recWantPreview) {
        recWantPreview = false;
        buildPreview();
      }
    }, 150);
  }
}

async function stopAndSendRecording() {
  if (!recorder) return;
  stopActivity('recording-audio'); // recording done → clear the peer's indicator (spec 1009)
  const durationSec = Math.max(1, Math.round(recActiveMs() / 1000));
  const rec = recorder;
  const mime = rec.mimeType || 'audio/webm';
  stopPreview();
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
  await sendMediaMessage(chatId, 'voice', blob, 'voice-message', durationSec, { replyTo: reply, ttlOverrideMs: msgTtl.value });
}

function cancelRecording() {
  stopActivity('recording-audio'); // cancelled → clear the peer's indicator (spec 1009)
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
/* Preview play/pause button shown while a recording is paused. */
.rec-preview {
  flex: none;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--ion-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: pointer;
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
/* Pasted-image staging row above the textarea: small square thumbnails (the
   picture itself is reviewed full-size after sending / in the viewer), each
   with a corner × to drop it before sending. Scrolls sideways if several. */
.paste-bar {
  --min-height: 0;
}
.paste-row {
  display: flex;
  gap: 8px;
  padding: 6px 12px 2px;
  overflow-x: auto;
}
.paste-thumb {
  position: relative;
  flex: 0 0 auto;
  /* breathing room so the overhanging × isn't clipped by the scroll row */
  padding: 6px 6px 0 0;
}
.paste-thumb img,
.paste-thumb video,
.paste-thumb .paste-vid {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 10px;
  display: block;
}
/* Black box behind a staged video while its poster is being generated (or if it couldn't be). */
.paste-thumb .paste-vid {
  background: #000;
}
/* Play glyph over a staged video's poster frame. Dead-centered so it lands exactly where the
   loading spinner was (no jump when the poster arrives). */
.paste-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 26px;
  color: #fff;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  pointer-events: none;
}
/* Spinner over a staged video whose first frame hasn't decoded yet (large clips take a moment). */
.paste-loading {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  color: #fff;
}
/* A staged non-media file shows a labelled chip instead of a thumbnail. */
.paste-file {
  width: 132px;
  height: 64px;
  border-radius: 10px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  box-sizing: border-box;
}
.paste-file ion-icon {
  font-size: 22px;
  color: var(--ion-color-primary);
}
.paste-file-name {
  font-size: 11px;
  line-height: 1.2;
  max-width: 100%;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-text-muted);
}
/* The whole staged item is a button: tapping it captions that one item. */
.paste-tap {
  display: block;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  position: relative;
  border-radius: 10px;
}
/* An item with its own caption gets a brand-green ring + a caption badge. */
.paste-thumb.has-cap .paste-tap {
  outline: 2px solid var(--ion-color-primary);
  outline-offset: 1px;
}
.paste-cap-badge {
  position: absolute;
  left: 3px;
  bottom: 3px;
  font-size: 15px;
  color: #fff;
  background: var(--ion-color-primary);
  border-radius: 50%;
  padding: 2px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
/* Preview of the item being captioned, above the input. */
.caption-preview {
  position: relative;
  display: flex;
  justify-content: center;
  margin: 0 auto;
  max-width: 100%;
}
.caption-preview img {
  display: block;
  max-width: 100%;
  max-height: 200px;
  border-radius: 12px;
  object-fit: contain;
  background: #000;
}
.caption-preview-video {
  width: 160px;
  height: 120px;
  border-radius: 12px;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.caption-preview-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 40px;
  color: #fff;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6));
  pointer-events: none;
}
.caption-preview-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--app-surface);
  max-width: 100%;
}
.caption-preview-file ion-icon {
  font-size: 22px;
  flex: none;
}
.caption-preview-file span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.caption-input-item {
  --background: var(--app-surface);
  --padding-start: 12px;
  --padding-end: 12px;
  --border-radius: 12px;
  border-radius: 12px;
  margin-top: 16px;
  font-size: 16px;
}
/* Pen hint in the top-left corner: tap the thumbnail to add a caption (until one exists, then the
   filled badge above takes over at the bottom-left). */
.paste-cap-hint {
  position: absolute;
  left: 3px;
  top: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}
/* Album vs Individual choice for a multi-photo/video send. */
/* Column so the send-as choice sits on its OWN row under the thumbnails (ion-toolbar would otherwise
   flex the two side by side and squeeze the segment). */
.paste-stack {
  display: flex;
  flex-direction: column;
}
.send-mode {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px 8px;
}
.send-mode-label {
  font-size: 13px;
  color: var(--app-text-muted);
  flex: 0 0 auto;
}
.send-mode ion-segment {
  flex: 1 1 auto;
  max-width: 320px;
}
.send-mode ion-segment-button {
  min-height: 30px;
}
.send-mode ion-segment-button ion-icon {
  font-size: 15px;
  margin-right: 5px;
}
/* Icon + label on one line inside each segment button. */
.send-mode ion-segment-button::part(native) {
  flex-direction: row;
}
.paste-x {
  position: absolute;
  top: 0;
  right: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ion-color-medium);
  color: var(--ion-color-medium-contrast);
  font-size: 16px;
}
.rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ion-color-danger);
}
.chat-content {
  /* Personal backdrop: Ring's shield mark scattered/rotated and tiled over the
     theme background. The tile lives in variables.css as --app-chat-doodle,
     with a per-theme stroke (darker on light, brighter on dark). */
  --background:
    var(--app-chat-doodle) repeat,
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
  /* This list owns its scroll anchoring in JS (withScrollAnchor adjusts the spacers). Disable
     the browser's native scroll anchoring so it can't ALSO compensate for the same prepend
     and double-correct against the spacer change — that two-engine fight is what makes scrollTop
     jitter back-and-forth as older pages load on iOS (spec 1011). One anchor source only. */
  overflow-anchor: none;
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
/* Selection mode: a check circle pinned to the row's LEFT edge for every row
   (margin-right:auto pushes outgoing bubbles back to the right), the whole row
   is the tap target, and everything inside the bubble goes pointer-inert so
   media viewers / polls / the message menu can't fire mid-selection. */
.bubble-row.sel-mode {
  cursor: pointer;
}
.bubble-row.sel-mode .bubble-col,
.bubble-row.sel-mode .fwd-float,
.bubble-row.sel-mode .msg-avatar,
.bubble-row.sel-mode .retry-btn {
  pointer-events: none;
}
.sel-check {
  flex: none;
  align-self: center;
  font-size: 22px;
  color: var(--ion-color-primary);
  margin-right: 4px;
}
.bubble-row.sel-mode.out .sel-check {
  margin-right: auto;
}
.bubble-row.sel-on .bubble {
  outline: 2px solid var(--ion-color-primary);
}
/* "edited" tag in the time row of a rewritten message (both sides). */
.edited {
  font-style: italic;
  opacity: 0.85;
  margin-right: 2px;
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
/* Spec 1051: the column already sizes to its WIDEST child (the reaction row is
   the swipe-wrap's sibling), so stretching the wrapper and filling the bubble
   makes a short message grow to hold a wide chip row — the chips straddle the
   bubble's edge instead of spilling over the wallpaper. Gated by the template's
   with-reactions class (a :has() version silently failed under scoped-CSS
   compilation), and scoped away from media/video-note bubbles: a captioned
   photo must keep wrapping its caption at the photo's own edge (spec 2027) —
   an unconditional width:100% regressed exactly that (CI caught it, PR #995).
   The 78% cap and chip wrapping are unchanged. */
.bubble-col.with-reactions > .swipe-wrap {
  align-self: stretch;
}
.bubble-col.with-reactions > .swipe-wrap > .bubble:not(.bubble-media):not(.bubble-plain) {
  width: 100%;
}
.bubble {
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 16px;
  background: var(--app-bubble-in);
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* Let the browser own vertical scroll natively; only horizontal drags reach JS
     (swipe-to-reply), so the touchmove listener can be passive — no input-latency
     round-trip at the start of every vertical flick. */
  touch-action: pan-y;
  box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.08);
  /* A thin, theme-contrasting outline (dark in light theme, light in dark theme) so
     each bubble's boundary reads clearly against the chat background. Uses --app-text
     (reliably defined in BOTH themes; Ionic's --ion-text-color isn't, in this setup). */
  border: 1px solid color-mix(in srgb, var(--app-text) 18%, transparent);
}
.bubble.out {
  background: var(--app-bubble-out);
}
/* LEGACY inline game cards (spec 1033): when the BOARD lives in the bubble
   (tic-tac-toe/connect4/battleship replays) the game is a SHARED surface, not
   one side's message — full message-column width and a neutral card either
   direction. Fullscreen games (chess, armada) do NOT get this class: their
   compact challenge card rides a normal sided bubble (see isInlineGameRow). */
.bubble-row.game-row .bubble-col {
  max-width: 100%;
  width: 100%;
}
.bubble-row.game-row .swipe-wrap {
  width: 100%;
  align-items: stretch;
}
.bubble-row.game-row .bubble,
.bubble-row.game-row .bubble.out {
  width: 100%;
  background: var(--app-game-card-bg);
  border: 1px solid var(--app-game-card-border);
  border-radius: 18px;
  padding: 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 10px 26px -14px rgba(0, 0, 0, 0.28);
}
/* Reserve a minimum bubble width that fits ~3 reaction pills side by side, so a
   short message NEVER (a) shrinks when the react button hides at the 3-reaction cap,
   nor (b) ends up narrower than its own reactions row (which would overhang to the
   side). Applies to every text bubble regardless of content length; media / video-
   note bubbles size to their media and are excluded. Logical prop → RTL-correct. A
   long message exceeds this floor, so it's unaffected. */
.bubble:not(.bubble-media):not(.bubble-plain) {
  min-inline-size: 9.75rem;
}
/* A round video note has no chat bubble behind it; instead the circle gets a
   thin frame ring and its timestamp sits in a small pill, both matching the
   in/out bubble colour. */
.bubble-plain,
.bubble-plain.out {
  background: transparent;
  box-shadow: none;
  border: none; /* round video note has no rectangular bubble to outline */
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
   timestamp keep a small inset so they don't touch the edge. Capped at the media
   frame's width (240px + the 2×3px inset — spec 2027): the bubble is a column
   flexbox sized shrink-to-fit, so without the cap a LONG caption's unwrapped
   line — not the photo — set the bubble width (up to the 78% column cap),
   leaving the photo floating against dead bubble background. With it, captions,
   sender lines, quotes, and the footer all wrap at the photo's edge.
   A definite `width: 246px` (NOT max-width, NOT min(100%, 246px)) on purpose:
   only a definite width caps the bubble's INTRINSIC max-content contribution.
   max-width caps just the used width, and any percentage (even inside min())
   counts as auto during intrinsic sizing — either way the long caption's
   unwrapped line inflated the ancestors' shrink-to-fit widths (.swipe-wrap /
   .bubble-col grew toward the 78% cap), an invisible dead zone that pushed the
   floating quick-forward button ~100px off the bubble (spec 2028). The separate
   max-width keeps narrow viewports working: media and bubble shrink together. */
.bubble-media {
  padding: 3px;
  gap: 0;
  width: 246px;
  max-width: 100%;
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
  /* Bidi: dir="auto" on the element resolves RTL/LTR from the content; `start` then hugs
     the matching edge, so a Persian/Arabic/Hebrew message right-aligns and an English one
     left-aligns within the bubble. plaintext isolates a mixed message's runs so an embedded
     opposite-direction word/URL can't reorder the rest. */
  text-align: start;
  unicode-bidi: plaintext;
}
/* An all-emoji message (≤3) renders larger and roomier. */
.text.emoji-only {
  line-height: 1.15;
  padding: 2px 0;
}
/* Bidi for the quote previews (reply bar, edit bar, in-bubble reply) and the header /
   in-bubble sender names: detect each one's direction from its own content and hug the
   matching edge, so RTL names and RTL quoted text read correctly. */
.reply-ref-text,
.reply-ref-author,
.chat-header-name,
.sender {
  unicode-bidi: plaintext;
  text-align: start;
}
/* Floating quick-forward button beside incoming media/files/links. Anchored to
   the message column's BOTTOM edge (next to the caption/footer line) — centered
   looked fine on short file/link bubbles but floated mid-image beside tall
   portrait media, visually detached from the message (spec 2028). */
.fwd-float {
  align-self: flex-end;
  margin-block-end: 2px;
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
/* Fixed media frame: image/video bubbles are a constant square, so every media row
   has a predictable height — the thumbnail fills it (cover) and a placeholder icon
   shows until it loads. No reflow → fluid history scrolling. The full media opens in
   the viewer on tap. */
.media-wrap,
.video-poster {
  position: relative;
  width: 240px;
  max-width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.15);
  cursor: pointer;
}
/* Ionic skeleton loader filling a media frame / album cell until the thumbnail
   resolves. Override its default text-line margin + pill radius so it covers the
   whole frame (which already clips to the rounded corners via overflow: hidden). */
.media-skel {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  --border-radius: 0;
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
/* Circular download-progress ring around the download glyph (SVG, pathLength=100 so the fill
   dasharray is a direct percentage). */
.dl-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg); /* start the fill at 12 o'clock */
}
.dl-ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 3;
}
.dl-ring-fill {
  fill: none;
  stroke: #fff;
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dasharray 0.2s linear;
}
/* The attachment size badge on a not-yet-downloaded photo/video. */
.dl-size {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
/* Icon + progress ring wrapper inside a pending audio/file chip. */
.chip-ico {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
}
.chip-ico .dl-ring-track {
  stroke: var(--app-border);
}
.chip-ico .dl-ring-fill {
  stroke: var(--ion-color-primary);
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
/* Rich preview: vertical card with a top image, title, description, and domain. */
.link-card.rich {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 0;
  overflow: hidden;
}
.lp-thumb {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  display: block;
}
/* (spec 2035) Favicon-class preview image: a compact icon row instead of a hero —
   the image sits at a fixed small size beside the meta, never upscaled. */
.link-card.lp-iconic {
  display: flex;
  align-items: center;
}
.link-card.lp-iconic .lp-thumb {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  margin-left: 10px;
  border-radius: 8px;
  object-fit: contain;
}
.lp-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
}
.lp-title {
  font-size: 14px;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lp-desc {
  font-size: 12px;
  color: var(--app-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lp-domain {
  font-size: 11px;
  color: var(--app-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.msg-link {
  color: var(--ion-color-primary);
  text-decoration: underline;
  word-break: break-all;
}
/* @mention chip (spec 1020): a highlighted, tappable name. A mention of ME is
   emphasized (filled pill) so "this is about me" pops at a glance. */
.mention {
  color: var(--ion-color-primary);
  font-weight: 600;
  cursor: pointer;
}
.mention.me {
  background: var(--ion-color-primary);
  color: #fff;
  border-radius: 6px;
  padding: 0 4px;
}
.mention.everyone {
  cursor: default;
}
/* @-mention autocomplete popover above the composer. */
.mention-pop {
  max-height: 40vh;
  overflow-y: auto;
  background: var(--ion-background-color);
  border-top: 1px solid var(--app-hairline, rgba(128, 128, 128, 0.25));
}
.mention-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--app-hairline, rgba(128, 128, 128, 0.12));
  text-align: start;
  font-size: 15px;
  color: var(--ion-text-color);
}
.mention-row:active {
  background: var(--ion-color-step-100, rgba(128, 128, 128, 0.12));
}
.mention-row-ico {
  font-size: 20px;
  color: var(--ion-color-primary);
}
.mention-row-name {
  font-weight: 600;
}
.mention-row-handle {
  color: var(--app-text-muted);
  font-size: 13px;
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
/* Disappearing message: a small clock + remaining time, tinted so it reads as an active countdown. */
.ttl-left {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  color: var(--ion-color-primary);
  font-variant-numeric: tabular-nums;
}
.ttl-left ion-icon {
  font-size: 13px;
}
/* Spec 1025 US5: give the disappearing countdown clear separation from the timestamp. Outgoing keeps
   it to the LEFT of the timestamp; incoming moves it to the RIGHT (order:1 places it after the
   bare timestamp text node inside .time). */
.msg-foot.out .ttl-left {
  margin-right: 6px;
}
.msg-foot.in .ttl-left {
  order: 1;
  margin-left: 6px;
}
/* Direction-aware bottom row (spec 1008): the react button sits opposite the
   timestamp — sent → time+tick right / react left; received → time left / react
   right. Logical layout so it mirrors correctly in RTL. */
.msg-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  /* A tall, comfortable footer row on EVERY message (text + all media kinds), so the
     react button has a generous tap target and the timestamp has room to breathe. */
  min-height: 40px;
  margin-top: 2px;
  padding-top: 4px;
}
/* React button and timestamp sit at opposite ends. The timestamp is pinned to its
   side with an auto margin so it STAYS there even when the react button is hidden
   (once the 3-reaction cap is reached). Sent: react left, time right. Received: time
   left, react right (via order). */
.msg-foot.out .time {
  margin-left: auto;
}
.msg-foot.in .time {
  order: 1;
  margin-right: auto;
}
.msg-foot.in .react-btn {
  order: 2;
}
.msg-foot .time {
  align-self: center;
}
.react-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  /* Fill the taller row for an easy, finger-sized hit target. */
  width: 36px;
  height: 36px;
  margin: 0;
  font-size: 22px;
  line-height: 1;
  color: var(--app-text-muted, #8e8e93);
  cursor: pointer;
}
.react-btn:active {
  transform: scale(0.85);
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
  padding: 1px 9px;
  height: 30px;
  border: 1px solid var(--ion-color-step-150, rgba(0, 0, 0, 0.1));
  border-radius: 15px;
  background: var(--ion-background-color, #fff);
  cursor: pointer;
  line-height: 1;
}
.reaction.mine {
  border-color: var(--ion-color-primary);
  background: color-mix(in srgb, var(--ion-color-primary) 14%, var(--ion-background-color, #fff));
}
.r-emoji {
  font-size: 19px;
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
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 28px;
  background: rgba(0, 0, 0, 0.42); /* scrim disc → legible on any thumbnail (FR-003) */
  border-radius: 50%;
  pointer-events: none;
}
.album-bubble .time {
  padding-inline: 4px;
}
/* Zero-height look-ahead sentinels (spec 1011): real boxes the IntersectionObserver can
   watch, but they take no layout space and are invisible. */
.scroll-sentinel {
  height: 1px;
  margin: 0;
  padding: 0;
  pointer-events: none;
  visibility: hidden;
  overflow-anchor: none;
}
/* Virtual-scroll spacers (spec 1011): reserve the height of older/newer messages not held
   in the rendered run. flex-shrink:0 so the flex column keeps their exact height. */
.vscroll-pad {
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  pointer-events: none;
  overflow-anchor: none;
}
/* Floating "scroll to latest" control (spec 1012). ion-fab is position:fixed within
   ion-content, so toggling opacity fades it with no layout shift; pointer-events:none while
   hidden so it's non-interactive. The disc is theme-inverted and translucent — a bright
   frosted disc with a solid dark arrow in light mode, a dark frosted disc with a solid bright
   arrow in dark mode — so the chat scrolls visibly behind it (backdrop blur) while the icon
   stays crisp. When behind, it expands into a stadium/pill with the count inline (spec 1013). */
.jump-fab {
  /* Pin explicitly to the bottom-trailing corner, just above the composer. Don't rely on
     ion-fab's vertical/horizontal attribute classes alone — on some builds they don't take
     effect and the fab falls back to ion-fab's default TOP-START position. These !important
     rules guarantee the bottom-trailing placement everywhere (spec 1012). */
  position: absolute !important;
  top: auto !important;
  bottom: 14px !important;
  inset-inline-start: auto !important;
  inset-inline-end: 14px !important;
  margin: 0;
  transition: opacity 0.2s ease;
}
.jump-fab.jump-hidden {
  opacity: 0;
  pointer-events: none;
}
.jump-fab ion-fab-button {
  /* Light theme: bright, translucent disc + solid dark arrow. */
  --background: rgba(255, 255, 255, 0.6);
  --background-hover: rgba(255, 255, 255, 0.72);
  --background-activated: rgba(255, 255, 255, 0.82);
  --color: #1c1c1e;
  --box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
}
/* Frost the disc so the chat is visible (softened) behind it as it scrolls. Applied to the
   native button surface; the slotted arrow renders on top and stays fully opaque/solid. */
.jump-fab ion-fab-button::part(native) {
  backdrop-filter: blur(8px) saturate(1.1);
  -webkit-backdrop-filter: blur(8px) saturate(1.1);
}
/* Dark theme: the inverse — dark translucent disc + solid bright arrow. */
:root.ion-palette-dark .jump-fab ion-fab-button {
  --background: rgba(28, 28, 30, 0.55);
  --background-hover: rgba(40, 40, 44, 0.66);
  --background-activated: rgba(48, 48, 52, 0.74);
  --color: #ffffff;
  --box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
/* Expanding pill (spec 1013): chevron + inline count, centered. The host WIDTH is bound inline
   (pillWidth: 40px circle → wider as the digit count grows) and animated here for a smooth
   grow/shrink; the count just fades in. Logical margin so the count sits correctly in RTL. The
   count inherits the button's solid theme-inverted color (bright on the dark disc, dark on the
   bright disc). The native's fixed 20px radius keeps both caps fully rounded — a circle at 40px,
   a stadium when wider. */
.jump-fab ion-fab-button.jump-btn {
  transition: width 0.24s ease, opacity 0.2s ease;
}
.jump-fab ion-fab-button.jump-btn::part(native) {
  border-radius: 20px;
}
.jump-btn .jump-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.jump-btn .jump-count {
  display: inline-block;
  opacity: 0;
  margin-inline-start: 0;
  /* Green count — the theme green, same as the composer mic/camera buttons (spec 1013). */
  color: var(--ion-color-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  transition: opacity 0.2s ease, margin-inline-start 0.2s ease;
}
.jump-btn.jump-btn-pill .jump-count {
  opacity: 1;
  margin-inline-start: 5px;
}
/* A new (not-yet-Seen) incoming message wears a green ring in the theme green — same as the pill
   count and the composer buttons — until it's reported Seen (spec 1013). box-shadow (not border)
   so it follows the rounded corners and adds/removes with no layout shift. */
.bubble.bubble-unseen {
  box-shadow: 0 0 0 1.5px var(--ion-color-primary);
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
/* Centered call-log row (not a bubble). */
.call-row {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 86%;
  margin: 6px auto;
  padding: 6px 14px;
  border-radius: 14px;
  background: var(--app-surface);
  color: var(--app-text-muted);
  font-size: 13px;
  cursor: pointer;
}
.call-row ion-icon {
  font-size: 17px;
}
.call-row .call-missed {
  color: var(--ion-color-danger, #eb445a);
}
.call-row-text {
  font-weight: 600;
}
.call-row-parts {
  opacity: 0.8;
  font-size: 12px;
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
.tick.seen {
  color: #34b7f1;
}
/* Compact group progress count ("3/5") (spec 1010). Rendered just to the inline-start
   of the timestamp (not between clock and tick): the clock + tick form a stable
   right-anchored unit, and the count — like the "edited" tag — grows into the footer's
   floating edge, so it can appear/disappear without ever shifting the timestamp.

   The slot is RESERVED (min-inline-size) on every group-with-≥2-recipients outgoing
   message for its whole lifecycle, even when the fraction is absent (sent / all-
   delivered / all-seen). That keeps the footer — and therefore a short bubble whose
   width the footer drives — a CONSTANT width, so the bubble doesn't resize as the
   count toggles. text-align:end keeps the digits hugging the timestamp; the reserved
   blank sits to their inline-start. tabular-nums steadies a given count's width;
   logical properties mirror in RTL. */
.tick-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  margin-inline-end: 2px;
  min-inline-size: 2.6em; /* fits up to ~2-digit "NN/NN" so the bubble never jumps */
  text-align: end;
}
.bubble-image {
  /* Fills the fixed media frame (cropped to cover). */
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* Play affordance over a video thumbnail. A translucent dark scrim disc behind the
   white glyph guarantees legibility on ANY thumbnail — dark or bright (spec 1007
   FR-003) — without baking pixels into the JPEG. */
.play-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  color: #fff;
  background: rgba(0, 0, 0, 0.42);
  border-radius: 50%;
  filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.5));
  /* Visual only — the whole poster is the tap target (handled on the bubble). */
  pointer-events: none;
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
/* Not-yet-downloaded audio/file: a tappable chip with a download glyph and the size. */
.pending-chip {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 0;
  max-width: 100%;
}
.pending-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pending-chip .chip-size {
  flex: none;
  opacity: 0.7;
  font-size: 12px;
}
.pending-chip ion-spinner {
  width: 18px;
  height: 18px;
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
/* Disappearing-timer button: the duration badge tucks under the timer glyph. */
/* Keep the button compact even without the icon-only slot (which we drop to stack icon + badge). */
.ttl-btn {
  --padding-start: 6px;
  --padding-end: 6px;
}
.ttl-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
  gap: 1px;
}
/* A hair smaller than a plain icon-only button so the icon + duration together fit the toolbar row. */
.ttl-stack ion-icon {
  font-size: 21px;
}
.ttl-btn.has-badge .ttl-stack ion-icon {
  font-size: 19px;
}
.ttl-badge {
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.3px;
  pointer-events: none;
}
</style>
