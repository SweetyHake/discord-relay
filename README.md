# Discord Relay

**Bot-free Discord voice relay for Foundry VTT 14+**

Discord Relay bridges a Discord voice channel and your Foundry VTT world **without
running any Discord bot, OAuth application, or backend server**. It piggy-backs on
the public [Discord StreamKit Overlay](https://streamkit.discord.com/overlay) and a
small browser-side relay that forwards voice events into Foundry through the
native socket.

One Foundry user (the **Relay User**, usually the GM) keeps the StreamKit overlay
window/tab open. That user receives speaking, mute, deafen and join/leave events
from Discord and re-broadcasts them to all other connected players via
`game.socket`. Every other client subscribes to those events through standard
Foundry **Hooks**, so any module or world script can react to Discord voice
activity with a couple of lines of code.

---

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Installation & setup](#installation--setup)
- [Public API — `DiscordBridge`](#public-api--discordbridge)
- [Hooks reference](#hooks-reference)
- [Macro examples](#macro-examples)
- [Settings reference](#settings-reference)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

---

## Features

- No Discord bot, no token, no backend — just the official StreamKit overlay.
- Real-time **speaking start / stop** events per Discord user.
- Real-time **mute / self-mute / deafen / self-deafen / join / leave** events.
- Mapping table between **Discord users → Foundry users** (one Foundry user can be
  linked to several Discord accounts).
- World-synced status: every client sees who is speaking, even though only the
  Relay User actually has the overlay open.
- GM heartbeat broadcast so all clients know whether the relay is currently
  online, offline or stale.
- Optional auto-start on world load for the configured Relay User.
- Two presentation modes for the StreamKit overlay (browser tab or popup window).
- Localized in **English** and **Русский**.

---

## How it works

```
  Discord  ──►  StreamKit Overlay (browser)
                       │  postMessage
                       ▼
            Relay User's Foundry client
                       │  game.socket.emit
                       ▼
            All other Foundry clients
                       │  Hooks.callAll(...)
                       ▼
              Your modules / macros
```

1. The Relay User opens `https://streamkit.discord.com/overlay/voice/<guild>/<channel>`
   in a tab or popup. A small TamperMonkey-style script (provided in the **Guide**
   tab of the module menu) injects heartbeats and forwards overlay events back to
   the parent Foundry window with `window.postMessage`.
2. Foundry receives those messages, normalizes them and emits them on the module
   socket as `DiscordRelayMessage` payloads (`DV_OVERLAY_HB`, `DV_SPEAKING`,
   `DV_VOICE_STATE`, `USER_STATE_UPDATE`, `DV_HB_REQUEST`).
3. Each remote client transforms the payload into a Foundry **Hook** call so the
   rest of your code never has to touch sockets directly.

---

## Installation & setup

1. Install the module via the manifest URL or from the Foundry package browser.
2. Enable it in your world.
3. Open **Game Settings → Module Settings → Discord Relay → Open Relay Menu**.
4. Follow the in-app **Guide** tab to:
   - install the TamperMonkey/Greasemonkey userscript on the StreamKit overlay
     domain;
   - paste the Discord voice channel URL (`<guild_id>/<channel_id>`);
   - confirm browser pop-ups are allowed;
   - press **Activate Relay**.
5. (Optional) Map Discord users to Foundry users in the **Foundry users** list.
6. (Optional) Enable **Auto-start** so the configured Relay User reconnects on
   reload.

---

## Public API — `DiscordBridge`

After the `ready` hook the module exposes a global object:

```js
globalThis.DiscordBridge        // also available as just DiscordBridge
```

Useful surface area:

| Member | Type | Description |
| --- | --- | --- |
| `DiscordBridge.state` | `object` | Live state: `usersStatus`, `overlayLastSeenByUserId`, `messageListenerInstalled`, `overlayWindowRef`, … |
| `DiscordBridge.voiceActivityRelay` | `VoiceActivityRelay` | Owns the overlay listener and socket emitters. |
| `DiscordBridge.voiceChat` | `VoiceChat` | Maintains profiles + voice channel data (settings). |
| `DiscordBridge.statusCheck` | `StatusCheck` | GM-only heartbeat broadcaster. |
| `DiscordBridge.discordMenu.open({ page })` | `function` | Open the relay UI on `"relay"` or `"guide"` tab. |
| `DiscordBridge.mutedList()` | `() => Array` | Currently muted users in the voice channel. |
| `DiscordBridge.deafenedList()` | `() => Array` | Currently deafened users in the voice channel. |
| `DiscordBridge.voiceActivityRelay.installOverlayListener()` | `async` | Open the overlay window/tab and start relaying (becomes Relay User). |
| `DiscordBridge.voiceActivityRelay.uninstallOverlayListener()` | `async` | Stop being the Relay User. |
| `DiscordBridge.voiceActivityRelay.openOverlay()` | `Window\|null` | Just open the overlay without becoming relay. |
| `DiscordBridge.voiceActivityRelay.getOverlayFreshness(foundryUserId)` | `{ fresh, ageMs, active }` | Whether a Foundry user's overlay heartbeat is recent. |
| `DiscordBridge.voiceActivityRelay.isLocalOverlayFresh()` | `boolean` | Convenience for the local user. |

The hook name table is also published on `CONFIG`:

```js
CONFIG["discord-relay"].hooks
// → { ON_TOGGLE, USERS_STATUS_CHANGED, SPEAKING_START, SPEAKING_STOP,
//     VOICE_STATE_CREATE, VOICE_STATE_DELETE, VOICE_STATE_UPDATE,
//     RENDER_LISTS, LOG_ENTRY_ADDED }
```

---

## Hooks reference

All hooks are namespaced under `discord-relay.*`.

### `discord-relay.onToggle`

Fired when the local user activates or deactivates the relay listener.

```js
Hooks.on("discord-relay.onToggle", (state /* "on" | "off" */) => {
  console.log("Relay is now", state);
});
```

### `discord-relay.usersStatusChanged`

Fired whenever the GM heartbeat reports that one or more Foundry users transitioned
between `active`/`fresh` states (i.e. their StreamKit overlay went online, became
stale, or disappeared).

```js
Hooks.on("discord-relay.usersStatusChanged", (usersStatus, changes) => {
  // usersStatus: { [foundryUserId]: { active, fresh, ageMs } }
  // changes:     { [foundryUserId]: { prev: {active,fresh}, next: {active,fresh} } }
});
```

### `discord-relay.userStartedSpeaking`

Discord StreamKit reported a `SPEAKING_START`. Payload is the normalized speaker
info plus the resolved Foundry user (when a mapping exists).

```js
Hooks.on("discord-relay.userStartedSpeaking", (data) => {
  // data = { user_id, foundryUserId, discordUserId, ...rest }
});
```

### `discord-relay.userStoppedSpeaking`

Counterpart of the above — `SPEAKING_STOP`.

```js
Hooks.on("discord-relay.userStoppedSpeaking", (data) => { /* … */ });
```

### `discord-relay.userUpdated`

A single hook that covers all three voice-state transitions: `VOICE_STATE_CREATE`
(joined the channel), `VOICE_STATE_DELETE` (left), and `VOICE_STATE_UPDATE`
(mute/deafen/nick changed).

The second argument is an options object with the original event timestamp.

```js
Hooks.on("discord-relay.userUpdated", (user, options) => {
  // user = {
  //   user_id, discordUserId, foundryUserId,
  //   mute, deaf, nick, username, avatarUrl, bot
  // }
  // options = { modifiedTime: <epoch ms> }
});
```

> Note: the constants `VOICE_STATE_CREATE`, `VOICE_STATE_DELETE`, and
> `VOICE_STATE_UPDATE` all resolve to the same hook name (`userUpdated`). Inspect
> module settings (`discordVoiceChatUserIds`, `discordUserProfiles`) if you need
> to distinguish join vs. leave vs. update.

### `discord-relay.renderLists`

Fired when any of the persisted lists change (profiles, channel data, voice user
list, mapping). UIs use this to re-render. Payload: none.

```js
Hooks.on("discord-relay.renderLists", () => refreshMyHud());
```

### `discord-relay.logEntryAdded`

Reserved for log entries shown in the Relay menu's log panel. Payload is the log
entry object with `ts`, `type`, `discordUserId`, `payload`.

```js
Hooks.on("discord-relay.logEntryAdded", (entry) => { /* … */ });
```

---

## Macro examples

> All examples assume the relay has been activated and at least one Foundry user
> is linked to a Discord user via the **Foundry users** list in the Relay menu.

### 1. Highlight a token while its player speaks

```js
// Macro: "Speaking ring"
Hooks.on("discord-relay.userStartedSpeaking", ({ foundryUserId }) => {
  if (!foundryUserId) return;
  for (const token of canvas.tokens.placeables) {
    if (token.actor?.ownership?.[foundryUserId] === 3) {
      token.ring?.flashColor?.(Color.from("#43b581"), { duration: 400 });
    }
  }
});

Hooks.on("discord-relay.userStoppedSpeaking", ({ foundryUserId }) => {
  if (!foundryUserId) return;
  // your own clean-up, e.g. clear a custom highlight
});
```

### 2. Show a chat notification when a player joins the voice channel

```js
Hooks.on("discord-relay.userUpdated", (user, { modifiedTime }) => {
  const inChannel = game.settings
    .get("discord-relay", "discordVoiceChatUserIds")
    .includes(user.discordUserId);

  ChatMessage.create({
    speaker: { alias: "Discord" },
    content: `${user.nick ?? user.username} ${inChannel ? "joined" : "left"} voice (${new Date(modifiedTime).toLocaleTimeString()})`,
    whisper: [game.user.id],
  });
});
```

### 3. Auto-mute a Foundry user's audio cues when they self-mute on Discord

```js
Hooks.on("discord-relay.userUpdated", (user) => {
  if (!user.foundryUserId) return;
  const flag = user.mute ? true : false;
  game.user.id === user.foundryUserId &&
    game.settings.set("core", "globalAmbientVolume", flag ? 0 : 0.5);
});
```

### 4. Toggle the relay programmatically

```js
// Activate
await DiscordBridge.voiceActivityRelay.installOverlayListener();

// Deactivate
await DiscordBridge.voiceActivityRelay.uninstallOverlayListener();
```

### 5. Open the relay UI on a specific tab

```js
DiscordBridge.discordMenu.open({ page: "guide" });
```

### 6. React to relay coming online for the whole table

```js
Hooks.on("discord-relay.usersStatusChanged", (status, changes) => {
  for (const [userId, { prev, next }] of Object.entries(changes)) {
    if (!prev.fresh && next.fresh) {
      ui.notifications.info(`${game.users.get(userId)?.name ?? userId} is now relaying Discord audio.`);
    }
  }
});
```

### 7. List currently muted speakers

```js
console.table(DiscordBridge.mutedList());
console.table(DiscordBridge.deafenedList());
```

---

## Settings reference

Most settings are managed by the in-app menu, but they are also accessible via
`game.settings.get("discord-relay", <key>)`:

| Key | Scope | Purpose |
| --- | --- | --- |
| `relayUserId` | world | Foundry user currently acting as the Relay User. |
| `overlayPopup` | client | `"tab"` or `"window"` — how the StreamKit overlay opens. |
| `browserConfirmation` | client | The user has acknowledged the popup permission prompt. |
| `autoStart` | client | Auto-install the overlay listener on `ready` for the Relay User. |
| `discordUserProfiles` | world | `{ [discordUserId]: { nick, username, avatarUrl, mute, deaf, bot } }`. |
| `foundryDiscordIdsMap` | world | `{ [foundryUserId]: [discordUserId, …] }` mapping. |
| `discordVoiceChatUserIds` | world | Discord user IDs currently in the watched voice channel. |
| `discordVoiceChatData` | world | `{ guild_id, channel_id, name, topic, user_limit, _fullId }`. |
| `speakingEventDebounceMs` | world | Optional debounce for `SPEAKING_*` events. |

---

## Troubleshooting

- **Relay status shows OFFLINE** — the StreamKit overlay window has been closed
  or the userscript is not running. Re-open the overlay from the Relay menu.
- **Status shows STALE** — heartbeats stopped arriving for more than 12 s. Check
  that the overlay tab is not throttled (some browsers freeze background tabs).
- **`Cannot open overlay — missing guild_id or channel_id`** — paste a valid
  voice channel URL of the form `…/<guild_id>/<channel_id>` in the Relay menu.
- **No speaking events** — confirm the userscript is enabled on
  `streamkit.discord.com` and that the overlay is showing the correct channel.

---

## Credits

- Author: **SweetyHake** — <https://boosty.to/sweetyhake>
- Repository: <https://github.com/SweetyHake/discord-relay>

Issues and pull requests welcome.
