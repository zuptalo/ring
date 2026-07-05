# Animated emoji: inventory & design language

**Purpose**: the single source of truth for which emoji have Noto Lottie animations
in Ring, and how we use them as a design language (games first, but any surface).
Whenever a design conversation needs "an animated emoji that feels like X", start
here instead of rediscovering the set.

**How animation works in Ring** (spec 1017): `AnimatedEmoji.vue` renders any emoji;
it fetches `/v1/emoji/{codepoints}/lottie.json` from ringd's self-hosted proxy
(cached in Postgres server-side, in-memory + SW-cache client-side), plays the Lottie
in a loop WHILE visible, and pauses off-screen. An emoji with no animation (404)
falls back to the native glyph automatically, so using a non-animated emoji is safe,
just static.

**Source**: `https://googlefonts.github.io/noto-emoji-animation/data/api.json`
(the manifest of Google's Noto animated set, which is exactly what the proxy
serves). Regenerate the inventory below by re-fetching that JSON; this file was
generated on 2026-07-05 from a manifest of 881 animated emoji.

---

## Game design genres (curated)

The palette we draw from for game surfaces (spec 0008+). Every emoji listed here is
VERIFIED to have an animation. Keep usage consistent: the same concept should use
the same emoji across bubbles, notifications, previews, and stats.

### Winner / celebration

*the player who won, streaks, big moments*

| | Emoji | Codepoints |
|---|-------|------------|
| 🎉 | `party-popper` | `1f389` |
| 🥳 | `partying-face` | `1f973` |
| 🏆 | `trophy` | `1f3c6` |
| 🎊 | `confetti-ball` | `1f38a` |
| ✨ | `sparkles` | `2728` |
| 🥇 | `gold-medal` | `1f947` |
| 👑 | `crown` | `1f451` |
| 💪 | `muscle` | `1f4aa` |
| 😎 | `sunglasses-face` | `1f60e` |
| 🙌 | `raising-hands` | `1f64c` |
| 🤩 | `star-struck` | `1f929` |

### Loser / defeat (gentle)

*losing between friends stays warm, never mocking*

| | Emoji | Codepoints |
|---|-------|------------|
| 😅 | `grin-sweat` | `1f605` |
| 😢 | `cry` | `1f622` |
| 😭 | `loudly-crying` | `1f62d` |
| 💔 | `broken-heart` | `1f494` |
| 🫠 | `melting` | `1fae0` |
| 😬 | `grimacing` | `1f62c` |
| 🙈 | `see-no-evil-monkey` | `1f648` |
| 🥺 | `pleading` | `1f97a` |
| ☹️ | `big-frown` | `2639_fe0f` |

### Tie / draw

*an even outcome*

| | Emoji | Codepoints |
|---|-------|------------|
| 🤝 | `handshake` | `1f91d` |
| 😐 | `neutral-face` | `1f610` |
| ⚖️ | `balance-scale` | `2696_fe0f` |
| 😌 | `relieved` | `1f60c` |

### Pending / waiting

*it is the other player's move*

| | Emoji | Codepoints |
|---|-------|------------|
| ⏳ | `hourglass-not-done` | `23f3` |
| ⌛ | `hourglass-done` | `231b` |
| 😴 | `sleep` | `1f634` |
| 🥱 | `yawn` | `1f971` |
| 👀 | `eyes` | `1f440` |
| 🐌 | `snail` | `1f40c` |

### Call to action / your turn

*nudge the player to act*

| | Emoji | Codepoints |
|---|-------|------------|
| 🎲 | `die` | `1f3b2` |
| 👉 | `point-right` | `1f449` |
| ⚡ | `electricity` | `26a1` |
| 🔥 | `fire` | `1f525` |
| 🫵 | `pointing` | `1faf5` |
| ⏰ | `alarm-clock` | `23f0` |
| 🔔 | `bell` | `1f514` |
| 💥 | `collision` | `1f4a5` |

### Thinking / strategy

*someone is pondering a move*

| | Emoji | Codepoints |
|---|-------|------------|
| 🤔 | `thinking-face` | `1f914` |
| 🧐 | `monocle` | `1f9d0` |
| 🤨 | `raised-eyebrow` | `1f928` |
| 🧠 | `brain` | `1f9e0` |
| 🤓 | `nerd-face` | `1f913` |

### Taunt / playful banter

*friendly trash talk, reactions*

| | Emoji | Codepoints |
|---|-------|------------|
| 😏 | `smirk` | `1f60f` |
| 😜 | `winky-tongue` | `1f61c` |
| 🤪 | `zany-face` | `1f92a` |
| 😈 | `imp-smile` | `1f608` |
| 🥸 | `disguise` | `1f978` |
| 🤡 | `clown` | `1f921` |
| 💩 | `poop` | `1f4a9` |

### Love / friendly

*warmth between the two players*

| | Emoji | Codepoints |
|---|-------|------------|
| ❤️ | `red-heart` | `2764_fe0f` |
| 🥰 | `heart-face` | `1f970` |
| 😍 | `heart-eyes` | `1f60d` |
| 🤗 | `hug-face` | `1f917` |
| 💖 | `sparkling-heart` | `1f496` |

### Surprise / drama

*upsets, comebacks, blunders*

| | Emoji | Codepoints |
|---|-------|------------|
| 😱 | `screaming` | `1f631` |
| 🤯 | `mind-blown` | `1f92f` |
| 😮 | `mouth-open` | `1f62e` |
| 🙀 | `scream-cat` | `1f640` |
| 🤫 | `shushing-face` | `1f92b` |

### Game objects

*generic game iconography*

| | Emoji | Codepoints |
|---|-------|------------|
| 🎯 | `direct-hit` | `1f3af` |
| ♟️ | `chess-pawn` | `265f_fe0f` |
| 🎰 | `slot-machine` | `1f3b0` |
| 🎳 | `bowling` | `1f3b3` |
| 🎲 | `die` | `1f3b2` |

### Current game usage (keep in sync when it changes)

| Surface | Emoji | Meaning |
|---------|-------|---------|
| Game bubble, your turn | 🎲 `1f3b2` | your move (call to action) |
| Game bubble, waiting | ⏳ `23f3` | their move |
| Result, winner (overlay + info + previews) | 🏆 `1f3c6` | the gold cup, large on the finished board |
| Result, other player | 🥈 `1f948` | the silver medal — second place, never "loser" |
| Result, draw | 🤝 `1f91d` | even game |
| Rematch / Play again | 🐦‍🔥 `1f426_200d_1f525` | rise from the ashes |
| Game bubble, out of sync | 😵 `1f635` | broken game |
| Board, last move played | the theme's mark, animated | draws the eye to what just happened |
| Celebration accents (sparingly) | 🎉 `1f389` | moments, not results — results are the 🏆/🥈/🤝 set |
| Chat-list previews + in-app banners | any emoji in the line | render through EmojiText — animated when the set has it |
| Emoji profile pictures | user's pick | animated on every swept avatar surface, 2 loops then rest (`UserAvatar`) |
| Challenge announcement (groups + Wall, spec 0009) | 🫵 `1faf5` + 🎲 `1f3b2` | the call-to-arms hero on an open challenge |
| Accept button + "accepted" notices | 💪 `1f4aa` | someone takes the seat |
| Challenge withdrawn | 🫠 `1fae0` | the creator melted away |
| Race lost ("got there first") | 😅 `1f605` | a beat-to-the-seat accepter's gentle nod |
| Observer Follow toggle | 👀 `1f440` | privately watching a game |

## Tic-tac-toe themes (spec 0008)

Each theme is a pair of marks (player 0 vs player 1) plus a soft accent tint on the
board. Both marks are chosen from the ANIMATED set where possible so the last-move
pulse plays; a static mark still renders fine.

| Theme id | Name | P0 | P1 | Feel |
|----------|------|----|----|------|
| `classic` | Classic | ❌ `274c` | ⭕ `2b55` | the timeless duel (note: ⭕ has NO animation; it renders as the static glyph) |
| `fire-ice` | Fire & Ice | 🔥 `1f525` | ❄️ `2744_fe0f` | hot versus cold |
| `space` | Space | 🚀 `1f680` | 👽 `1f47d` | rockets versus aliens |
| `mythic` | Mythic | 🦄 `1f984` | 🐉 `1f409` | unicorns versus dragons |
| `arcade` | Arcade | 👾 `1f47e` | 🤖 `1f916` | invaders versus robots |
| `snacks` | Snacks | 🍕 `1f355` | 🍔 `1f354` | pizza versus burger |

Theme ids ride the sealed GameStart payload and are FROZEN once shipped (like game
ids, contracts/game-payload.md §3): an unknown theme id on an older client falls
back to `classic`.

---

## Full animated inventory (881 emoji)

Generated from the Noto manifest; grouped by its categories. Everything below has
a working Lottie via `/v1/emoji/{codepoints}/lottie.json`.

### Activities and events (58)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| 🎈 | `balloon` | `1f388` | 🎂 | `birthday-cake` | `1f382` |
| 🎁 | `wrapped-gift` | `1f381` | 🎆 | `fireworks` | `1f386` |
| 🪔 | `diya-lamp` | `1fa94` | 🪅 | `piñata` | `1fa85` |
| 🪩 | `mirror-ball` | `1faa9` | 🥇 | `gold-medal` | `1f947` |
| 🥈 | `silver-medal` | `1f948` | 🥉 | `bronze-medal` | `1f949` |
| 🏆 | `trophy` | `1f3c6` | ⚽ | `soccer-ball` | `26bd` |
| ⚾ | `baseball` | `26be` | 🥎 | `softball` | `1f94e` |
| 🏀 | `basketball` | `1f3c0` | 🏉 | `rugby-football` | `1f3c9` |
| 🎾 | `tennis` | `1f3be` | 🏸 | `badminton` | `1f3f8` |
| 🥍 | `lacrosse` | `1f94d` | 🏏 | `cricket-game` | `1f3cf` |
| 🏑 | `field-hockey` | `1f3d1` | 🏒 | `ice-hockey` | `1f3d2` |
| 🎿 | `skis` | `1f3bf` | ⛸️ | `ice-skate` | `26f8_fe0f` |
| 🛼 | `roller-skates` | `1f6fc` | 🩰 | `ballet-shoes` | `1fa70` |
| 🛹 | `skateboard` | `1f6f9` | ⛳ | `flag-in-hole` | `26f3` |
| 🎯 | `direct-hit` | `1f3af` | 🥏 | `flying-disc` | `1f94f` |
| 🪃 | `boomerang` | `1fa83` | 🪁 | `kite` | `1fa81` |
| 🎣 | `fishing-pole` | `1f3a3` | 🥋 | `martial-arts-uniform` | `1f94b` |
| 🎱 | `8-ball` | `1f3b1` | 🏓 | `ping-pong` | `1f3d3` |
| 🎳 | `bowling` | `1f3b3` | ♟️ | `chess-pawn` | `265f_fe0f` |
| 🎲 | `die` | `1f3b2` | 🎰 | `slot-machine` | `1f3b0` |
| 🪄 | `wand` | `1fa84` | 📷 | `camera` | `1f4f7` |
| 📸 | `camera-flash` | `1f4f8` | 🫟 | `splatter` | `1fadf` |
| 🎷 | `saxophone` | `1f3b7` | 🎺 | `trumpet` | `1f3ba` |
| 🪊 | `trombone` | `1fa8a` | 🎸 | `guitar` | `1f3b8` |
| 🪕 | `banjo` | `1fa95` | 🎻 | `violin` | `1f3bb` |
| 🪉 | `harp` | `1fa89` | 🥁 | `drum` | `1f941` |
| 🪇 | `maracas` | `1fa87` | 📺 | `television` | `1f4fa` |
| 🎞️ | `film` | `1f39e_fe0f` | 🎬 | `clapper` | `1f3ac` |
| 🎭 | `performing-arts` | `1f3ad` | 🎟️ | `admission-tickets` | `1f39f_fe0f` |

### Animals and nature (118)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| 💐 | `bouquet` | `1f490` | 🌹 | `rose` | `1f339` |
| 🥀 | `wilted-flower` | `1f940` | 🌷 | `tulip` | `1f337` |
| 🪷 | `lotus` | `1fab7` | 🌸 | `cherry-blossom` | `1f338` |
| 🪻 | `hyacinth` | `1fabb` | 🌼 | `blossom` | `1f33c` |
| 🍂 | `fallen-leaf` | `1f342` | 🍁 | `maple-leaf` | `1f341` |
| 🍄 | `mushroom` | `1f344` | 🌿 | `herb` | `1f33f` |
| 🌱 | `plant` | `1f331` | 🍃 | `leaves` | `1f343` |
| 🍀 | `luck` | `1f340` | 🌵 | `cactus` | `1f335` |
| 🪾 | `leafless-tree` | `1fabe` | 🌲 | `evergreen-tree` | `1f332` |
| 🪨 | `rock` | `1faa8` | 🛘 | `debris` | `1f6d8` |
| 🌋 | `volcano` | `1f30b` | 🏞️ | `national-park` | `1f3de_fe0f` |
| 🌅 | `sunrise` | `1f305` | 🌄 | `sunrise-over-mountains` | `1f304` |
| 🌊 | `ocean` | `1f30a` | 🌬️ | `wind-face` | `1f32c_fe0f` |
| ❄️ | `snowflake` | `2744_fe0f` | 🌀 | `cyclone` | `1f300` |
| 🌪️ | `tornado` | `1f32a_fe0f` | 🌈 | `rainbow` | `1f308` |
| 💧 | `droplet` | `1f4a7` | ☁️ | `cloud` | `2601_fe0f` |
| 🌧️ | `rain-cloud` | `1f327_fe0f` | 🌩️ | `cloud-with-lightning` | `1f329_fe0f` |
| ⛅ | `partly-sunny` | `26c5` | 🪐 | `ringed-planet` | `1fa90` |
| 🌍 | `globe-showing-Europe-Africa` | `1f30d` | 🌎 | `globe-showing-Americas` | `1f30e` |
| 🌏 | `globe-showing-Asia-Australia` | `1f30f` | 🌌 | `milky-way` | `1f30c` |
| ☄️ | `comet` | `2604_fe0f` | 🦁 | `lion-face` | `1f981` |
| 🐺 | `wolf` | `1f43a` | 🐻 | `bear-face` | `1f43b` |
| 🐼 | `panda` | `1f43c` | 🦊 | `fox-face` | `1f98a` |
| 🐮 | `cow-face` | `1f42e` | 🦄 | `unicorn` | `1f984` |
| 🦎 | `lizard` | `1f98e` | 🐉 | `dragon` | `1f409` |
| 🦖 | `t-rex` | `1f996` | 🦕 | `dinosaur` | `1f995` |
| 🐢 | `turtle` | `1f422` | 🐊 | `crocodile` | `1f40a` |
| 🐍 | `snake` | `1f40d` | 🐸 | `frog` | `1f438` |
| 🐇 | `rabbit` | `1f407` | 🐀 | `rat` | `1f400` |
| 🐩 | `poodle` | `1f429` | 🐕 | `dog` | `1f415` |
| 🦮 | `guide-dog` | `1f9ae` | 🐕‍🦺 | `service-dog` | `1f415_200d_1f9ba` |
| 🐖 | `pig` | `1f416` | 🐎 | `racehorse` | `1f40e` |
| 🫏 | `donkey` | `1facf` | 🐂 | `ox` | `1f402` |
| 🐐 | `goat` | `1f410` | 🦥 | `sloth` | `1f9a5` |
| 🦘 | `kangaroo` | `1f998` | 🐅 | `tiger` | `1f405` |
| 🐒 | `monkey` | `1f412` | 🦍 | `gorilla` | `1f98d` |
| 🦧 | `orangutan` | `1f9a7` | 🐿️ | `chipmunk` | `1f43f_fe0f` |
| 🦝 | `raccoon` | `1f99d` | 🦔 | `hedgehog` | `1f994` |
| 🦦 | `otter` | `1f9a6` | 🦇 | `bat` | `1f987` |
| 🐦 | `bird` | `1f426` | 🐦‍⬛ | `black-bird` | `1f426_200d_2b1b` |
| 🐓 | `rooster` | `1f413` | 🐣 | `hatching-chick` | `1f423` |
| 🐤 | `baby-chick` | `1f424` | 🐥 | `hatched-chick` | `1f425` |
| 🦅 | `eagle` | `1f985` | 🦉 | `owl` | `1f989` |
| 🕊️ | `peace` | `1f54a_fe0f` | 🪿 | `goose` | `1fabf` |
| 🦩 | `flamingo` | `1f9a9` | 🦚 | `peacock` | `1f99a` |
| 🐦‍🔥 | `phoenix` | `1f426_200d_1f525` | 🐧 | `penguin` | `1f427` |
| 🦭 | `seal` | `1f9ad` | 🦈 | `shark` | `1f988` |
| 🫍 | `orca` | `1facd` | 🐬 | `dolphin` | `1f42c` |
| 🐳 | `whale` | `1f433` | 🐟 | `fish` | `1f41f` |
| 🐡 | `blowfish` | `1f421` | 🦞 | `lobster` | `1f99e` |
| 🦀 | `crab` | `1f980` | 🐙 | `octopus` | `1f419` |
| 🪼 | `jellyfish` | `1fabc` | 🫧 | `bubbles` | `1fae7` |
| 🦂 | `scorpion` | `1f982` | 🕷️ | `spider` | `1f577_fe0f` |
| 🐌 | `snail` | `1f40c` | 🐜 | `ant` | `1f41c` |
| 🦗 | `cricket` | `1f997` | 🦟 | `mosquito` | `1f99f` |
| 🪳 | `cockroach` | `1fab3` | 🪰 | `fly` | `1fab0` |
| 🐝 | `bee` | `1f41d` | 🐞 | `lady-bug` | `1f41e` |
| 🦋 | `butterfly` | `1f98b` | 🐛 | `bug` | `1f41b` |
| 🪱 | `worm` | `1fab1` | 🐾 | `paw prints` | `1f43e` |

### Flags (4)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| 🏁 | `chequered-flag` | `1f3c1` | 🚩 | `triangular-flag` | `1f6a9` |
| 🏴 | `black-flag` | `1f3f4` | 🏳️ | `white-flag` | `1f3f3_fe0f` |

### Food and drink (67)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| 🍓 | `strawberry` | `1f353` | 🍒 | `cherries` | `1f352` |
| 🍎 | `red-apple` | `1f34e` | 🍅 | `tomato` | `1f345` |
| 🍉 | `watermelon` | `1f349` | 🍊 | `tangerine` | `1f34a` |
| 🥕 | `carrot` | `1f955` | 🥭 | `mango` | `1f96d` |
| 🍍 | `pineapple` | `1f34d` | 🌽 | `ear-of-corn` | `1f33d` |
| 🍋 | `lemon` | `1f34b` | 🍈 | `melon` | `1f348` |
| 🍐 | `pear` | `1f350` | 🫛 | `pea-pod` | `1fadb` |
| 🥬 | `leafy-green` | `1f96c` | 🫑 | `bell-pepper` | `1fad1` |
| 🥝 | `kiwi-fruit` | `1f95d` | 🥑 | `avocado` | `1f951` |
| 🥦 | `broccoli` | `1f966` | 🥒 | `cucumber` | `1f952` |
| 🫐 | `blueberries` | `1fad0` | 🍇 | `grapes` | `1f347` |
| 🫜 | `root-vegetable` | `1fadc` | 🥔 | `potato` | `1f954` |
| 🧅 | `onion` | `1f9c5` | 🫚 | `ginger` | `1fada` |
| 🧄 | `garlic` | `1f9c4` | 🫘 | `beans` | `1fad8` |
| 🍞 | `bread` | `1f35e` | 🥞 | `pancakes` | `1f95e` |
| 🍳 | `cooking` | `1f373` | 🧀 | `cheese-wedge` | `1f9c0` |
| 🥓 | `bacon` | `1f953` | 🍗 | `poultry-leg` | `1f357` |
| 🍔 | `hamburger` | `1f354` | 🌭 | `hot-dog` | `1f32d` |
| 🥨 | `pretzel` | `1f968` | 🍕 | `pizza` | `1f355` |
| 🌮 | `taco` | `1f32e` | 🌯 | `burrito` | `1f32f` |
| 🍝 | `spaghetti` | `1f35d` | 🥗 | `green-salad` | `1f957` |
| 🍜 | `steaming-bowl` | `1f35c` | 🍢 | `oden` | `1f362` |
| 🍡 | `dango` | `1f361` | 🍨 | `ice-cream` | `1f368` |
| 🍦 | `soft-ice-cream` | `1f366` | 🥧 | `pie` | `1f967` |
| 🍩 | `doughnut` | `1f369` | 🍪 | `cookie` | `1f36a` |
| 🧂 | `salt` | `1f9c2` | 🍿 | `popcorn` | `1f37f` |
| 🧋 | `bubble-tea` | `1f9cb` | 🧃 | `beverage-box` | `1f9c3` |
| 🍼 | `baby-bottle` | `1f37c` | 🍵 | `teacup-without-handle` | `1f375` |
| ☕ | `hot-beverage` | `2615` | 🫖 | `teapot` | `1fad6` |
| 🧉 | `mate` | `1f9c9` | 🍻 | `clinking-beer-mugs` | `1f37b` |
| 🥂 | `clinking-glasses` | `1f942` | 🍾 | `bottle-with-popping-cork` | `1f37e` |
| 🍷 | `wine-glass` | `1f377` | 🫗 | `pour` | `1fad7` |
| 🍹 | `tropical-drink` | `1f379` | 🥢 | `chopsticks` | `1f962` |
| 🍽️ | `fork-and-knife-with-plate` | `1f37d_fe0f` |  |  |  |

### Objects (51)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| 📟 | `pager` | `1f4df` | 🔌 | `electric-plug` | `1f50c` |
| 🔋 | `battery-full` | `1f50b` | 🪫 | `battery-low` | `1faab` |
| 💿 | `optical-disk` | `1f4bf` | 💻 | `laptop-computer` | `1f4bb` |
| 🖨️ | `printer` | `1f5a8_fe0f` | 🪎 | `treasure` | `1fa8e` |
| 🪙 | `coin` | `1fa99` | 💎 | `gem-stone` | `1f48e` |
| 💸 | `money-with-wings` | `1f4b8` | ⚖️ | `balance-scale` | `2696_fe0f` |
| 🛒 | `shopping-cart` | `1f6d2` | 💡 | `light-bulb` | `1f4a1` |
| 🧹 | `broom` | `1f9f9` | 🧦 | `socks` | `1f9e6` |
| 🎓 | `graduation-cap` | `1f393` | 👑 | `crown` | `1f451` |
| 💍 | `ring` | `1f48d` | 🪭 | `fan` | `1faad` |
| ☂️ | `umbrella` | `2602_fe0f` | 👠 | `high-heeled-shoe` | `1f460` |
| 👟 | `running-shoe` | `1f45f` | 🌡️ | `thermometer` | `1f321_fe0f` |
| 🩺 | `stethoscope` | `1fa7a` | 🛠️ | `hammer-and-wrench` | `1f6e0_fe0f` |
| 🪏 | `shovel` | `1fa8f` | ⚙️ | `gear` | `2699_fe0f` |
| ⛓️‍💥 | `broken-chain` | `26d3_fe0f_200d_1f4a5` | ⛓️ | `chains` | `26d3_fe0f` |
| 🖇️ | `linked-paperclips` | `1f587_fe0f` | ✂️ | `scissors` | `2702_fe0f` |
| ✏️ | `pencil` | `270f_fe0f` | 📚 | `books` | `1f4da` |
| 📊 | `bar-chart` | `1f4ca` | 📈 | `chart-increasing` | `1f4c8` |
| 📉 | `chart-decreasing` | `1f4c9` | 🗑️ | `wastebasket` | `1f5d1_fe0f` |
| 📦 | `package` | `1f4e6` | 🗳️ | `ballot-box` | `1f5f3_fe0f` |
| ⏰ | `alarm-clock` | `23f0` | ⌛ | `hourglass-done` | `231b` |
| ⏳ | `hourglass-not-done` | `23f3` | 🛎️ | `bellhop-bell` | `1f6ce_fe0f` |
| 🔔 | `bell` | `1f514` | 📣 | `megaphone` | `1f4e3` |
| 🔎 | `magnifying-glass-tilted-right` | `1f50e` | 🔮 | `crystal-ball` | `1f52e` |
| 💣 | `bomb` | `1f4a3` | 🪤 | `mouse-trap` | `1faa4` |
| 🔒 | `locked` | `1f512` |  |  |  |

### People (8)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| 🪂 | `parachute` | `1fa82` | 🫈 | `hairy-creature` | `1fac8` |
| 💃 | `dancer-woman` | `1f483` | 💃🏻 | `dancer-woman` | `1f483_1f3fb` |
| 💃🏼 | `dancer-woman` | `1f483_1f3fc` | 💃🏽 | `dancer-woman` | `1f483_1f3fd` |
| 💃🏾 | `dancer-woman` | `1f483_1f3fe` | 💃🏿 | `dancer-woman` | `1f483_1f3ff` |

### Smileys and emotions (502)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| 😀 | `smile` | `1f600` | 😃 | `smile-with-big-eyes` | `1f603` |
| 😄 | `grin` | `1f604` | 😁 | `grinning` | `1f601` |
| 😆 | `laughing` | `1f606` | 😅 | `grin-sweat` | `1f605` |
| 😂 | `joy` | `1f602` | 🤣 | `rofl` | `1f923` |
| 😭 | `loudly-crying` | `1f62d` | 😉 | `wink` | `1f609` |
| 😗 | `kissing` | `1f617` | 😙 | `kissing-smiling-eyes` | `1f619` |
| 😚 | `kissing-closed-eyes` | `1f61a` | 😘 | `kissing-heart` | `1f618` |
| 🥰 | `heart-face` | `1f970` | 😍 | `heart-eyes` | `1f60d` |
| 🤩 | `star-struck` | `1f929` | 🥳 | `partying-face` | `1f973` |
| 🫠 | `melting` | `1fae0` | 🙃 | `upside-down-face` | `1f643` |
| 🙂 | `slightly-happy` | `1f642` | 🥲 | `happy-cry` | `1f972` |
| 🥹 | `holding-back-tears` | `1f979` | 😊 | `blush` | `1f60a` |
| ☺️ | `warm-smile` | `263a_fe0f` | 😌 | `relieved` | `1f60c` |
| 🙂‍↕️ | `head-nod` | `1f642_200d_2195_fe0f` | 🙂‍↔️ | `head-shake` | `1f642_200d_2194_fe0f` |
| 😏 | `smirk` | `1f60f` | 🤤 | `drool` | `1f924` |
| 😋 | `yum` | `1f60b` | 😛 | `stuck-out-tongue` | `1f61b` |
| 😝 | `squinting-tongue` | `1f61d` | 😜 | `winky-tongue` | `1f61c` |
| 🤪 | `zany-face` | `1f92a` | 🫪 | `distorted-face` | `1faea` |
| 😔 | `pensive` | `1f614` | 🥺 | `pleading` | `1f97a` |
| 😬 | `grimacing` | `1f62c` | 😑 | `expressionless` | `1f611` |
| 😐 | `neutral-face` | `1f610` | 😶 | `mouth-none` | `1f636` |
| 😶‍🌫️ | `face-in-clouds` | `1f636_200d_1f32b_fe0f` | 🫥 | `dotted-line-face` | `1fae5` |
| 🤐 | `zipper-face` | `1f910` | 🫡 | `salute` | `1fae1` |
| 🤔 | `thinking-face` | `1f914` | 🤫 | `shushing-face` | `1f92b` |
| 🫢 | `hand-over-mouth` | `1fae2` | 🤭 | `smiling-eyes-with-hand-over-mouth` | `1f92d` |
| 🥱 | `yawn` | `1f971` | 🤗 | `hug-face` | `1f917` |
| 🫣 | `peeking` | `1fae3` | 😱 | `screaming` | `1f631` |
| 🤨 | `raised-eyebrow` | `1f928` | 🧐 | `monocle` | `1f9d0` |
| 😒 | `unamused` | `1f612` | 🙄 | `rolling-eyes` | `1f644` |
| 😮‍💨 | `exhale` | `1f62e_200d_1f4a8` | 😤 | `triumph` | `1f624` |
| 😠 | `angry` | `1f620` | 😡 | `rage` | `1f621` |
| 🤬 | `cursing` | `1f92c` | 😞 | `sad` | `1f61e` |
| 😓 | `sweat` | `1f613` | 😟 | `worried` | `1f61f` |
| 😥 | `concerned` | `1f625` | 😢 | `cry` | `1f622` |
| ☹️ | `big-frown` | `2639_fe0f` | 🙁 | `frown` | `1f641` |
| 🫤 | `diagonal-mouth` | `1fae4` | 😕 | `slightly-frowning` | `1f615` |
| 😰 | `anxious-with-sweat` | `1f630` | 😨 | `scared` | `1f628` |
| 😧 | `anguished` | `1f627` | 😦 | `gasp` | `1f626` |
| 😮 | `mouth-open` | `1f62e` | 😯 | `surprised` | `1f62f` |
| 😲 | `astonished` | `1f632` | 😳 | `flushed` | `1f633` |
| 🤯 | `mind-blown` | `1f92f` | 😖 | `scrunched-mouth` | `1f616` |
| 😣 | `scrunched-eyes` | `1f623` | 😩 | `weary` | `1f629` |
| 😫 | `distraught` | `1f62b` | 😵 | `x-eyes` | `1f635` |
| 😵‍💫 | `dizzy-face` | `1f635_200d_1f4ab` | 🫨 | `shaking-face` | `1fae8` |
| 🥴 | `woozy` | `1f974` | 🥵 | `hot-face` | `1f975` |
| 🥶 | `cold-face` | `1f976` | 🤢 | `sick` | `1f922` |
| 🤮 | `vomit` | `1f92e` | 🫩 | `tired` | `1fae9` |
| 😴 | `sleep` | `1f634` | 😪 | `sleepy` | `1f62a` |
| 🤧 | `sneeze` | `1f927` | 🤒 | `thermometer-face` | `1f912` |
| 🤕 | `bandage-face` | `1f915` | 😷 | `mask` | `1f637` |
| 🤥 | `liar` | `1f925` | 😇 | `halo` | `1f607` |
| 🤠 | `cowboy` | `1f920` | 🤑 | `money-face` | `1f911` |
| 🤓 | `nerd-face` | `1f913` | 😎 | `sunglasses-face` | `1f60e` |
| 🥸 | `disguise` | `1f978` | 🤡 | `clown` | `1f921` |
| 💩 | `poop` | `1f4a9` | 😈 | `imp-smile` | `1f608` |
| 👿 | `imp-frown` | `1f47f` | 👻 | `ghost` | `1f47b` |
| 💀 | `skull` | `1f480` | 🤖 | `robot` | `1f916` |
| 👹 | `ogre` | `1f479` | ☃️ | `snowman-with-snow` | `2603_fe0f` |
| ⛄ | `snowman` | `26c4` | 👽 | `alien` | `1f47d` |
| 👾 | `alien-monster` | `1f47e` | 🌚 | `moon-face-new` | `1f31a` |
| 🌝 | `moon-face-full` | `1f31d` | 🌞 | `sun-with-face` | `1f31e` |
| 🌛 | `moon-face-first-quarter` | `1f31b` | 🌜 | `moon-face-last-quarter` | `1f31c` |
| 😺 | `smiley-cat` | `1f63a` | 😸 | `smile-cat` | `1f638` |
| 😹 | `joy-cat` | `1f639` | 😻 | `heart-eyes-cat` | `1f63b` |
| 😼 | `smirk-cat` | `1f63c` | 😽 | `kissing-cat` | `1f63d` |
| 🙀 | `scream-cat` | `1f640` | 😿 | `crying-cat-face` | `1f63f` |
| 😾 | `pouting-cat` | `1f63e` | 🙈 | `see-no-evil-monkey` | `1f648` |
| 🙉 | `hear-no-evil-monkey` | `1f649` | 🙊 | `speak-no-evil-monkey` | `1f64a` |
| ⭐ | `star` | `2b50` | 🌟 | `glowing-star` | `1f31f` |
| ✨ | `sparkles` | `2728` | ⚡ | `electricity` | `26a1` |
| 💥 | `collision` | `1f4a5` | 🫯 | `fight` | `1faef` |
| 🕳️ | `hole` | `1f573_fe0f` | 🔥 | `fire` | `1f525` |
| 💯 | `100` | `1f4af` | 🎉 | `party-popper` | `1f389` |
| 🎊 | `confetti-ball` | `1f38a` | ❤️ | `red-heart` | `2764_fe0f` |
| 🧡 | `orange-heart` | `1f9e1` | 💛 | `yellow-heart` | `1f49b` |
| 💚 | `green-heart` | `1f49a` | 🩵 | `light-blue-heart` | `1fa75` |
| 💙 | `blue-heart` | `1f499` | 💜 | `purple-heart` | `1f49c` |
| 🤎 | `brown-heart` | `1f90e` | 🖤 | `black-heart` | `1f5a4` |
| 🩶 | `grey-heart` | `1fa76` | 🤍 | `white-heart` | `1f90d` |
| 🩷 | `pink-heart` | `1fa77` | 💘 | `cupid` | `1f498` |
| 💝 | `gift-heart` | `1f49d` | 💖 | `sparkling-heart` | `1f496` |
| 💗 | `heart-grow` | `1f497` | 💓 | `beating-heart` | `1f493` |
| 💞 | `revolving-hearts` | `1f49e` | 💕 | `two-hearts` | `1f495` |
| 💌 | `love-letter` | `1f48c` | 💟 | `heart-box` | `1f49f` |
| ♥️ | `heart` | `2665_fe0f` | ❣️ | `heart-exclamation-point` | `2763_fe0f` |
| ❤️‍🩹 | `bandaged-heart` | `2764_fe0f_200d_1fa79` | 💔 | `broken-heart` | `1f494` |
| ❤️‍🔥 | `fire-heart` | `2764_fe0f_200d_1f525` | 💋 | `kiss` | `1f48b` |
| 🫂 | `hugging` | `1fac2` | 🗣️ | `speaking-head` | `1f5e3_fe0f` |
| 👣 | `footprints` | `1f463` | 🫆 | `fingerprint` | `1fac6` |
| 🧠 | `brain` | `1f9e0` | 🫀 | `anatomical-heart` | `1fac0` |
| 🩸 | `blood` | `1fa78` | 🦠 | `microbe` | `1f9a0` |
| 🦴 | `bone` | `1f9b4` | 👀 | `eyes` | `1f440` |
| 👁️ | `eye` | `1f441_fe0f` | 🫦 | `biting-lip` | `1fae6` |
| 👃 | `nose` | `1f443` | 👃🏻 | `nose` | `1f443_1f3fb` |
| 👃🏼 | `nose` | `1f443_1f3fc` | 👃🏽 | `nose` | `1f443_1f3fd` |
| 👃🏾 | `nose` | `1f443_1f3fe` | 👃🏿 | `nose` | `1f443_1f3ff` |
| 👂 | `ear` | `1f442` | 👂🏻 | `ear` | `1f442_1f3fb` |
| 👂🏼 | `ear` | `1f442_1f3fc` | 👂🏽 | `ear` | `1f442_1f3fd` |
| 👂🏾 | `ear` | `1f442_1f3fe` | 👂🏿 | `ear` | `1f442_1f3ff` |
| 🦻 | `hearing-aid` | `1f9bb` | 🦻🏻 | `hearing-aid` | `1f9bb_1f3fb` |
| 🦻🏼 | `hearing-aid` | `1f9bb_1f3fc` | 🦻🏽 | `hearing-aid` | `1f9bb_1f3fd` |
| 🦻🏾 | `hearing-aid` | `1f9bb_1f3fe` | 🦻🏿 | `hearing-aid` | `1f9bb_1f3ff` |
| 🦶 | `foot` | `1f9b6` | 🦶🏻 | `foot` | `1f9b6_1f3fb` |
| 🦶🏼 | `foot` | `1f9b6_1f3fc` | 🦶🏽 | `foot` | `1f9b6_1f3fd` |
| 🦶🏾 | `foot` | `1f9b6_1f3fe` | 🦶🏿 | `foot` | `1f9b6_1f3ff` |
| 🦵 | `leg` | `1f9b5` | 🦵🏻 | `leg` | `1f9b5_1f3fb` |
| 🦵🏼 | `leg` | `1f9b5_1f3fc` | 🦵🏽 | `leg` | `1f9b5_1f3fd` |
| 🦵🏾 | `leg` | `1f9b5_1f3fe` | 🦵🏿 | `leg` | `1f9b5_1f3ff` |
| 🦿 | `leg-mechanical` | `1f9bf` | 🦾 | `arm-mechanical` | `1f9be` |
| 💪 | `muscle` | `1f4aa` | 💪🏻 | `muscle` | `1f4aa_1f3fb` |
| 💪🏼 | `muscle` | `1f4aa_1f3fc` | 💪🏽 | `muscle` | `1f4aa_1f3fd` |
| 💪🏾 | `muscle` | `1f4aa_1f3fe` | 💪🏿 | `muscle` | `1f4aa_1f3ff` |
| 👏 | `clap` | `1f44f` | 👏🏻 | `clap` | `1f44f_1f3fb` |
| 👏🏼 | `clap` | `1f44f_1f3fc` | 👏🏽 | `clap` | `1f44f_1f3fd` |
| 👏🏾 | `clap` | `1f44f_1f3fe` | 👏🏿 | `clap` | `1f44f_1f3ff` |
| 👍 | `thumbs-up` | `1f44d` | 👍🏻 | `thumbs-up` | `1f44d_1f3fb` |
| 👍🏼 | `thumbs-up` | `1f44d_1f3fc` | 👍🏽 | `thumbs-up` | `1f44d_1f3fd` |
| 👍🏾 | `thumbs-up` | `1f44d_1f3fe` | 👍🏿 | `thumbs-up` | `1f44d_1f3ff` |
| 👎 | `thumbs-down` | `1f44e` | 👎🏻 | `thumbs-down` | `1f44e_1f3fb` |
| 👎🏼 | `thumbs-down` | `1f44e_1f3fc` | 👎🏽 | `thumbs-down` | `1f44e_1f3fd` |
| 👎🏾 | `thumbs-down` | `1f44e_1f3fe` | 👎🏿 | `thumbs-down` | `1f44e_1f3ff` |
| 🫶 | `heart-hands` | `1faf6` | 🫶🏻 | `heart-hands` | `1faf6_1f3fb` |
| 🫶🏼 | `heart-hands` | `1faf6_1f3fc` | 🫶🏽 | `heart-hands` | `1faf6_1f3fd` |
| 🫶🏾 | `heart-hands` | `1faf6_1f3fe` | 🫶🏿 | `heart-hands` | `1faf6_1f3ff` |
| 🙌 | `raising-hands` | `1f64c` | 🙌🏻 | `raising-hands` | `1f64c_1f3fb` |
| 🙌🏼 | `raising-hands` | `1f64c_1f3fc` | 🙌🏽 | `raising-hands` | `1f64c_1f3fd` |
| 🙌🏾 | `raising-hands` | `1f64c_1f3fe` | 🙌🏿 | `raising-hands` | `1f64c_1f3ff` |
| 👐 | `open-hands` | `1f450` | 👐🏻 | `open-hands` | `1f450_1f3fb` |
| 👐🏼 | `open-hands` | `1f450_1f3fc` | 👐🏽 | `open-hands` | `1f450_1f3fd` |
| 👐🏾 | `open-hands` | `1f450_1f3fe` | 👐🏿 | `open-hands` | `1f450_1f3ff` |
| 🤲 | `palms-up` | `1f932` | 🤲🏻 | `palms-up` | `1f932_1f3fb` |
| 🤲🏼 | `palms-up` | `1f932_1f3fc` | 🤲🏽 | `palms-up` | `1f932_1f3fd` |
| 🤲🏾 | `palms-up` | `1f932_1f3fe` | 🤲🏿 | `palms-up` | `1f932_1f3ff` |
| 🤜 | `fist-rightwards` | `1f91c` | 🤜🏻 | `fist-rightwards` | `1f91c_1f3fb` |
| 🤜🏼 | `fist-rightwards` | `1f91c_1f3fc` | 🤜🏽 | `fist-rightwards` | `1f91c_1f3fd` |
| 🤜🏾 | `fist-rightwards` | `1f91c_1f3fe` | 🤜🏿 | `fist-rightwards` | `1f91c_1f3ff` |
| 🤛 | `fist-leftwards` | `1f91b` | 🤛🏻 | `fist-leftwards` | `1f91b_1f3fb` |
| 🤛🏼 | `fist-leftwards` | `1f91b_1f3fc` | 🤛🏽 | `fist-leftwards` | `1f91b_1f3fd` |
| 🤛🏾 | `fist-leftwards` | `1f91b_1f3fe` | 🤛🏿 | `fist-leftwards` | `1f91b_1f3ff` |
| ✊ | `raised-fist` | `270a` | ✊🏻 | `raised-fist` | `270a_1f3fb` |
| ✊🏼 | `raised-fist` | `270a_1f3fc` | ✊🏽 | `raised-fist` | `270a_1f3fd` |
| ✊🏾 | `raised-fist` | `270a_1f3fe` | ✊🏿 | `raised-fist` | `270a_1f3ff` |
| 👊 | `fist` | `1f44a` | 👊🏻 | `fist` | `1f44a_1f3fb` |
| 👊🏼 | `fist` | `1f44a_1f3fc` | 👊🏽 | `fist` | `1f44a_1f3fd` |
| 👊🏾 | `fist` | `1f44a_1f3fe` | 👊🏿 | `fist` | `1f44a_1f3ff` |
| 🫳 | `palm-down` | `1faf3` | 🫳🏻 | `palm-down` | `1faf3_1f3fb` |
| 🫳🏼 | `palm-down` | `1faf3_1f3fc` | 🫳🏽 | `palm-down` | `1faf3_1f3fd` |
| 🫳🏾 | `palm-down` | `1faf3_1f3fe` | 🫳🏿 | `palm-down` | `1faf3_1f3ff` |
| 🫴 | `palm-up` | `1faf4` | 🫴🏻 | `palm-up` | `1faf4_1f3fb` |
| 🫴🏼 | `palm-up` | `1faf4_1f3fc` | 🫴🏽 | `palm-up` | `1faf4_1f3fd` |
| 🫴🏾 | `palm-up` | `1faf4_1f3fe` | 🫴🏿 | `palm-up` | `1faf4_1f3ff` |
| 🫱 | `rightwards-hand` | `1faf1` | 🫱🏻 | `rightwards-hand` | `1faf1_1f3fb` |
| 🫱🏼 | `rightwards-hand` | `1faf1_1f3fc` | 🫱🏽 | `rightwards-hand` | `1faf1_1f3fd` |
| 🫱🏾 | `rightwards-hand` | `1faf1_1f3fe` | 🫱🏿 | `rightwards-hand` | `1faf1_1f3ff` |
| 🫲 | `leftwards-hand` | `1faf2` | 🫲🏻 | `leftwards-hand` | `1faf2_1f3fb` |
| 🫲🏼 | `leftwards-hand` | `1faf2_1f3fc` | 🫲🏽 | `leftwards-hand` | `1faf2_1f3fd` |
| 🫲🏾 | `leftwards-hand` | `1faf2_1f3fe` | 🫲🏿 | `leftwards-hand` | `1faf2_1f3ff` |
| 🫸 | `push-rightwards` | `1faf8` | 🫸🏻 | `push-rightwards` | `1faf8_1f3fb` |
| 🫸🏼 | `push-rightwards` | `1faf8_1f3fc` | 🫸🏽 | `push-rightwards` | `1faf8_1f3fd` |
| 🫸🏾 | `push-rightwards` | `1faf8_1f3fe` | 🫸🏿 | `push-rightwards` | `1faf8_1f3ff` |
| 🫷 | `push-leftwards` | `1faf7` | 🫷🏻 | `push-leftwards` | `1faf7_1f3fb` |
| 🫷🏼 | `push-leftwards` | `1faf7_1f3fc` | 🫷🏽 | `push-leftwards` | `1faf7_1f3fd` |
| 🫷🏾 | `push-leftwards` | `1faf7_1f3fe` | 🫷🏿 | `push-leftwards` | `1faf7_1f3ff` |
| 👋 | `wave` | `1f44b` | 👋🏻 | `wave` | `1f44b_1f3fb` |
| 👋🏼 | `wave` | `1f44b_1f3fc` | 👋🏽 | `wave` | `1f44b_1f3fd` |
| 👋🏾 | `wave` | `1f44b_1f3fe` | 👋🏿 | `wave` | `1f44b_1f3ff` |
| 🤚 | `back-hand` | `1f91a` | 🤚🏻 | `back-hand` | `1f91a_1f3fb` |
| 🤚🏼 | `back-hand` | `1f91a_1f3fc` | 🤚🏽 | `back-hand` | `1f91a_1f3fd` |
| 🤚🏾 | `back-hand` | `1f91a_1f3fe` | 🤚🏿 | `back-hand` | `1f91a_1f3ff` |
| 🖐️ | `palm` | `1f590_fe0f` | 🖐🏻 | `palm` | `1f590_1f3fb` |
| 🖐🏼 | `palm` | `1f590_1f3fc` | 🖐🏽 | `palm` | `1f590_1f3fd` |
| 🖐🏾 | `palm` | `1f590_1f3fe` | 🖐🏿 | `palm` | `1f590_1f3ff` |
| ✋ | `raised-hand` | `270b` | ✋🏻 | `raised-hand` | `270b_1f3fb` |
| ✋🏼 | `raised-hand` | `270b_1f3fc` | ✋🏽 | `raised-hand` | `270b_1f3fd` |
| ✋🏾 | `raised-hand` | `270b_1f3fe` | ✋🏿 | `raised-hand` | `270b_1f3ff` |
| 🖖 | `vulcan` | `1f596` | 🖖🏻 | `vulcan` | `1f596_1f3fb` |
| 🖖🏼 | `vulcan` | `1f596_1f3fc` | 🖖🏽 | `vulcan` | `1f596_1f3fd` |
| 🖖🏾 | `vulcan` | `1f596_1f3fe` | 🖖🏿 | `vulcan` | `1f596_1f3ff` |
| 🤟 | `love-you-gesture` | `1f91f` | 🤟🏻 | `love-you-gesture` | `1f91f_1f3fb` |
| 🤟🏼 | `love-you-gesture` | `1f91f_1f3fc` | 🤟🏽 | `love-you-gesture` | `1f91f_1f3fd` |
| 🤟🏾 | `love-you-gesture` | `1f91f_1f3fe` | 🤟🏿 | `love-you-gesture` | `1f91f_1f3ff` |
| 🤘 | `metal` | `1f918` | 🤘🏻 | `metal` | `1f918_1f3fb` |
| 🤘🏼 | `metal` | `1f918_1f3fc` | 🤘🏽 | `metal` | `1f918_1f3fd` |
| 🤘🏾 | `metal` | `1f918_1f3fe` | 🤘🏿 | `metal` | `1f918_1f3ff` |
| ✌️ | `victory` | `270c_fe0f` | ✌🏻 | `victory` | `270c_1f3fb` |
| ✌🏼 | `victory` | `270c_1f3fc` | ✌🏽 | `victory` | `270c_1f3fd` |
| ✌🏾 | `victory` | `270c_1f3fe` | ✌🏿 | `victory` | `270c_1f3ff` |
| 🤞 | `crossed-fingers` | `1f91e` | 🤞🏻 | `crossed-fingers` | `1f91e_1f3fb` |
| 🤞🏼 | `crossed-fingers` | `1f91e_1f3fc` | 🤞🏽 | `crossed-fingers` | `1f91e_1f3fd` |
| 🤞🏾 | `crossed-fingers` | `1f91e_1f3fe` | 🤞🏿 | `crossed-fingers` | `1f91e_1f3ff` |
| 🫰 | `hand-with-index-finger-and-thumb-crossed` | `1faf0` | 🫰🏻 | `hand-with-index-finger-and-thumb-crossed` | `1faf0_1f3fb` |
| 🫰🏼 | `hand-with-index-finger-and-thumb-crossed` | `1faf0_1f3fc` | 🫰🏽 | `hand-with-index-finger-and-thumb-crossed` | `1faf0_1f3fd` |
| 🫰🏾 | `hand-with-index-finger-and-thumb-crossed` | `1faf0_1f3fe` | 🫰🏿 | `hand-with-index-finger-and-thumb-crossed` | `1faf0_1f3ff` |
| 🤙 | `call-me-hand` | `1f919` | 🤙🏻 | `call-me-hand` | `1f919_1f3fb` |
| 🤙🏼 | `call-me-hand` | `1f919_1f3fc` | 🤙🏽 | `call-me-hand` | `1f919_1f3fd` |
| 🤙🏾 | `call-me-hand` | `1f919_1f3fe` | 🤙🏿 | `call-me-hand` | `1f919_1f3ff` |
| 🤌 | `pinched-fingers` | `1f90c` | 🤌🏻 | `pinched-fingers` | `1f90c_1f3fb` |
| 🤌🏼 | `pinched-fingers` | `1f90c_1f3fc` | 🤌🏽 | `pinched-fingers` | `1f90c_1f3fd` |
| 🤌🏾 | `pinched-fingers` | `1f90c_1f3fe` | 🤌🏿 | `pinched-fingers` | `1f90c_1f3ff` |
| 🤏 | `pinch` | `1f90f` | 🤏🏻 | `pinch` | `1f90f_1f3fb` |
| 🤏🏼 | `pinch` | `1f90f_1f3fc` | 🤏🏽 | `pinch` | `1f90f_1f3fd` |
| 🤏🏾 | `pinch` | `1f90f_1f3fe` | 🤏🏿 | `pinch` | `1f90f_1f3ff` |
| 👌 | `ok` | `1f44c` | 👌🏻 | `ok` | `1f44c_1f3fb` |
| 👌🏼 | `ok` | `1f44c_1f3fc` | 👌🏽 | `ok` | `1f44c_1f3fd` |
| 👌🏾 | `ok` | `1f44c_1f3fe` | 👌🏿 | `ok` | `1f44c_1f3ff` |
| 🫵 | `pointing` | `1faf5` | 🫵🏻 | `pointing` | `1faf5_1f3fb` |
| 🫵🏼 | `pointing` | `1faf5_1f3fc` | 🫵🏽 | `pointing` | `1faf5_1f3fd` |
| 🫵🏾 | `pointing` | `1faf5_1f3fe` | 🫵🏿 | `pointing` | `1faf5_1f3ff` |
| 👉 | `point-right` | `1f449` | 👉🏻 | `point-right` | `1f449_1f3fb` |
| 👉🏼 | `point-right` | `1f449_1f3fc` | 👉🏽 | `point-right` | `1f449_1f3fd` |
| 👉🏾 | `point-right` | `1f449_1f3fe` | 👉🏿 | `point-right` | `1f449_1f3ff` |
| 👈 | `point-left` | `1f448` | 👈🏻 | `point-left` | `1f448_1f3fb` |
| 👈🏼 | `point-left` | `1f448_1f3fc` | 👈🏽 | `point-left` | `1f448_1f3fd` |
| 👈🏾 | `point-left` | `1f448_1f3fe` | 👈🏿 | `point-left` | `1f448_1f3ff` |
| ☝️ | `index-finger` | `261d_fe0f` | ☝🏻 | `index-finger` | `261d_1f3fb` |
| ☝🏼 | `index-finger` | `261d_1f3fc` | ☝🏽 | `index-finger` | `261d_1f3fd` |
| ☝🏾 | `index-finger` | `261d_1f3fe` | ☝🏿 | `index-finger` | `261d_1f3ff` |
| 👆 | `point-up` | `1f446` | 👆🏻 | `point-up` | `1f446_1f3fb` |
| 👆🏼 | `point-up` | `1f446_1f3fc` | 👆🏽 | `point-up` | `1f446_1f3fd` |
| 👆🏾 | `point-up` | `1f446_1f3fe` | 👆🏿 | `point-up` | `1f446_1f3ff` |
| 👇 | `point-down` | `1f447` | 👇🏻 | `point-down` | `1f447_1f3fb` |
| 👇🏼 | `point-down` | `1f447_1f3fc` | 👇🏽 | `point-down` | `1f447_1f3fd` |
| 👇🏾 | `point-down` | `1f447_1f3fe` | 👇🏿 | `point-down` | `1f447_1f3ff` |
| 🖕 | `middle-finger` | `1f595` | 🖕🏻 | `middle-finger` | `1f595_1f3fb` |
| 🖕🏼 | `middle-finger` | `1f595_1f3fc` | 🖕🏽 | `middle-finger` | `1f595_1f3fd` |
| 🖕🏾 | `middle-finger` | `1f595_1f3fe` | 🖕🏿 | `middle-finger` | `1f595_1f3ff` |
| ✍️ | `writing-hand` | `270d_fe0f` | ✍🏻 | `writing-hand` | `270d_1f3fb` |
| ✍🏼 | `writing-hand` | `270d_1f3fc` | ✍🏽 | `writing-hand` | `270d_1f3fd` |
| ✍🏾 | `writing-hand` | `270d_1f3fe` | ✍🏿 | `writing-hand` | `270d_1f3ff` |
| 🤳 | `selfie` | `1f933` | 🤳🏻 | `selfie` | `1f933_1f3fb` |
| 🤳🏼 | `selfie` | `1f933_1f3fc` | 🤳🏽 | `selfie` | `1f933_1f3fd` |
| 🤳🏾 | `selfie` | `1f933_1f3fe` | 🤳🏿 | `selfie` | `1f933_1f3ff` |
| 🙏 | `folded-hands` | `1f64f` | 🙏🏻 | `folded-hands` | `1f64f_1f3fb` |
| 🙏🏼 | `folded-hands` | `1f64f_1f3fc` | 🙏🏽 | `folded-hands` | `1f64f_1f3fd` |
| 🙏🏾 | `folded-hands` | `1f64f_1f3fe` | 🙏🏿 | `folded-hands` | `1f64f_1f3ff` |
| 💅 | `nail-care` | `1f485` | 💅🏻 | `nail-care` | `1f485_1f3fb` |
| 💅🏼 | `nail-care` | `1f485_1f3fc` | 💅🏽 | `nail-care` | `1f485_1f3fd` |
| 💅🏾 | `nail-care` | `1f485_1f3fe` | 💅🏿 | `nail-care` | `1f485_1f3ff` |
| 🤝 | `handshake` | `1f91d` | 🤝🏻 | `handshake` | `1f91d_1f3fb` |
| 🫱🏻‍🫲🏼 | `handshake` | `1faf1_1f3fb_200d_1faf2_1f3fc` | 🫱🏻‍🫲🏽 | `handshake` | `1faf1_1f3fb_200d_1faf2_1f3fd` |
| 🫱🏻‍🫲🏾 | `handshake` | `1faf1_1f3fb_200d_1faf2_1f3fe` | 🫱🏻‍🫲🏿 | `handshake` | `1faf1_1f3fb_200d_1faf2_1f3ff` |
| 🫱🏼‍🫲🏻 | `handshake` | `1faf1_1f3fc_200d_1faf2_1f3fb` | 🤝🏼 | `handshake` | `1f91d_1f3fc` |
| 🫱🏼‍🫲🏽 | `handshake` | `1faf1_1f3fc_200d_1faf2_1f3fd` | 🫱🏼‍🫲🏾 | `handshake` | `1faf1_1f3fc_200d_1faf2_1f3fe` |
| 🫱🏼‍🫲🏿 | `handshake` | `1faf1_1f3fc_200d_1faf2_1f3ff` | 🫱🏽‍🫲🏻 | `handshake` | `1faf1_1f3fd_200d_1faf2_1f3fb` |
| 🫱🏽‍🫲🏼 | `handshake` | `1faf1_1f3fd_200d_1faf2_1f3fc` | 🤝🏽 | `handshake` | `1f91d_1f3fd` |
| 🫱🏽‍🫲🏾 | `handshake` | `1faf1_1f3fd_200d_1faf2_1f3fe` | 🫱🏽‍🫲🏿 | `handshake` | `1faf1_1f3fd_200d_1faf2_1f3ff` |
| 🫱🏾‍🫲🏻 | `handshake` | `1faf1_1f3fe_200d_1faf2_1f3fb` | 🫱🏾‍🫲🏼 | `handshake` | `1faf1_1f3fe_200d_1faf2_1f3fc` |
| 🫱🏾‍🫲🏽 | `handshake` | `1faf1_1f3fe_200d_1faf2_1f3fd` | 🤝🏾 | `handshake` | `1f91d_1f3fe` |
| 🫱🏾‍🫲🏿 | `handshake` | `1faf1_1f3fe_200d_1faf2_1f3ff` | 🫱🏿‍🫲🏻 | `handshake` | `1faf1_1f3ff_200d_1faf2_1f3fb` |
| 🫱🏿‍🫲🏼 | `handshake` | `1faf1_1f3ff_200d_1faf2_1f3fc` | 🫱🏿‍🫲🏽 | `handshake` | `1faf1_1f3ff_200d_1faf2_1f3fd` |
| 🫱🏿‍🫲🏾 | `handshake` | `1faf1_1f3ff_200d_1faf2_1f3fe` | 🤝🏿 | `handshake` | `1f91d_1f3ff` |

### Symbols (42)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| ♠️ | `spade` | `2660_fe0f` | ♈ | `Aries` | `2648` |
| ♉ | `Taurus` | `2649` | ♊ | `Gemini` | `264a` |
| ♋ | `Cancer` | `264b` | ♌ | `Leo` | `264c` |
| ♍ | `Virgo` | `264d` | ♎ | `Libra` | `264e` |
| ♏ | `Scorpio` | `264f` | ♐ | `Sagittarius` | `2650` |
| ♑ | `Capricorn` | `2651` | ♒ | `Aquarius` | `2652` |
| ♓ | `Pisces` | `2653` | ⛎ | `Ophiuchus` | `26ce` |
| 🗯️ | `anger-bubble` | `1f5ef_fe0f` | 💬 | `speech-bubble` | `1f4ac` |
| ❗ | `exclamation` | `2757` | ❓ | `question` | `2753` |
| ⁉️ | `exclamation-question-mark` | `2049_fe0f` | ‼️ | `exclamation-double` | `203c_fe0f` |
| ❌ | `cross-mark` | `274c` | 🆘 | `sos` | `1f198` |
| ♨️ | `hot-springs` | `2668_fe0f` | 📴 | `phone-off` | `1f4f4` |
| ☢️ | `radioactive` | `2622_fe0f` | ☣️ | `biohazard` | `2623_fe0f` |
| ⚠️ | `warning` | `26a0_fe0f` | ✅ | `check-mark` | `2705` |
| 🆕 | `new` | `1f195` | 🆓 | `free` | `1f193` |
| 🆙 | `up!` | `1f199` | 🆗 | `ok-button` | `1f197` |
| 🆒 | `cool` | `1f192` | 🚮 | `litter` | `1f6ae` |
| ☮️ | `peace-symbol` | `262e_fe0f` | ☯️ | `yin-yang` | `262f_fe0f` |
| ♾️ | `infinity` | `267e_fe0f` | 🎶 | `musical-notes` | `1f3b6` |
| ➕ | `plus-sign` | `2795` | ©️ | `copyright` | `a9_fe0f` |
| ®️ | `registered` | `ae_fe0f` | ™️ | `trade-mark` | `2122_fe0f` |

### Travel and places (31)

| | Name | Codepoints | | Name | Codepoints |
|---|------|------------|---|------|------------|
| 🛑 | `stop-sign` | `1f6d1` | 🚧 | `construction` | `1f6a7` |
| 🚨 | `police-car-light` | `1f6a8` | ⛽ | `fuel-pump` | `26fd` |
| 🛟 | `ring-buoy` | `1f6df` | ⚓ | `anchor` | `2693` |
| 🚦 | `vertical-traffic-light` | `1f6a6` | 🚲 | `bicycle` | `1f6b2` |
| 🏍️ | `motorcycle` | `1f3cd_fe0f` | 🚗 | `automobile` | `1f697` |
| 🚚 | `delivery-truck` | `1f69a` | 🚜 | `tractor` | `1f69c` |
| 🏎️ | `racing-car` | `1f3ce_fe0f` | 🚕 | `taxi` | `1f695` |
| 🚌 | `bus` | `1f68c` | 🚂 | `locomotive` | `1f682` |
| ⛵ | `sailboat` | `26f5` | 🛶 | `canoe` | `1f6f6` |
| 🛸 | `flying-saucer` | `1f6f8` | 🚀 | `rocket` | `1f680` |
| ✈️ | `airplane` | `2708_fe0f` | 🛫 | `airplane-departure` | `1f6eb` |
| 🛬 | `airplane-arrival` | `1f6ec` | 🎢 | `roller-coaster` | `1f3a2` |
| 🎡 | `ferris-wheel` | `1f3a1` | 🎠 | `carousel-horse` | `1f3a0` |
| 🗿 | `moai` | `1f5ff` | 🏚️ | `derelict-house` | `1f3da_fe0f` |
| 🏠 | `house` | `1f3e0` | 🏕️ | `camping` | `1f3d5_fe0f` |
| 🌇 | `sunset` | `1f307` |  |  |  |
