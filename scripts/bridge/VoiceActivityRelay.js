import { MODULE_ID, HOOKS, READY_TTL_MS } from "../const.js";
import { getSettings, isObject, now, requestSettingsUpdate } from "../utils.js";

export class VoiceActivityRelay {
  constructor(state) {
    this._state   = state;
    this._onOverlayMessage = null;
    this.socketHandlers = this._buildSocketHandlers();
  }

  _normalizeUserId(id) {
    return String(id ?? "").trim();
  }

  getOverlayFreshness(foundryUserId) {
    const ts = this._state.overlayLastSeenByUserId[foundryUserId];
    if (!Number.isFinite(ts)) return { fresh: false, ageMs: Infinity, active: false };
    const ageMs = now() - ts;
    return { fresh: ageMs <= READY_TTL_MS, ageMs, active: true };
  }

  getOverlayFreshnessArray(foundryUserIds) {
    const nowTs = now();
    return Object.fromEntries(
      foundryUserIds.map(userId => {
        const ts = this._state.overlayLastSeenByUserId[userId];
        if (!Number.isFinite(ts)) return [userId, { fresh: false, ageMs: Infinity, active: false }];
        const ageMs = nowTs - ts;
        return [userId, { fresh: ageMs <= READY_TTL_MS, ageMs, active: true }];
      })
    );
  }

  isLocalOverlayFresh() {
    return this.getOverlayFreshness(game.user.id).fresh;
  }

  openOverlay() {
    const { guild_id, channel_id } = getSettings("discordVoiceChatData", false);
    if (!guild_id || !channel_id) {
      console.error("DRL: Cannot open overlay — missing guild_id or channel_id");
      return null;
    }
    const url      = `https://streamkit.discord.com/overlay/voice/${guild_id}/${channel_id}`;
    const features = getSettings("overlayPopup", false) === "window" ? "popup,width=420,height=900" : "";
    return window.open(url, "drl_streamkit_overlay", features);
  }

  async installOverlayListener() {
    this._state.overlayWindowRef = this.openOverlay();
    if (!this._state.messageListenerInstalled) {
      this._onOverlayMessage = this._handleOverlayMessage.bind(this);
      window.addEventListener("message", this._onOverlayMessage);
      this._state.messageListenerInstalled = true;
      
      this.emitSocket("USER_STATE_UPDATE", { action: "add", userId: game.user.id });
    }
    const { requestSettingsUpdate } = await import("../utils.js");
    await requestSettingsUpdate("relayUserId", game.user.id);
  }

  async uninstallOverlayListener() {
    if (this._state.messageListenerInstalled) {
      window.removeEventListener("message", this._onOverlayMessage);
      this._onOverlayMessage = null;
      this._state.messageListenerInstalled = false;
      
      this.emitSocket("USER_STATE_UPDATE", { action: "remove", userId: game.user.id });
    }
    const { getSettings, requestSettingsUpdate } = await import("../utils.js");
    if (getSettings("relayUserId", false) === game.user.id) {
      await requestSettingsUpdate("relayUserId", "");
    }
  }

  _handleOverlayMessage(event) {
    if (!event || event.origin !== "https://streamkit.discord.com") return;
    const msg = event.data;
    if (!isObject(msg)) return;

    const userId = game.user.id;

    if (msg.type === "DV_OVERLAY_HB") {
      this._state.overlayLastSeenByUserId[userId] = msg.ts ?? now();
      const nextStatus  = { ...this._state.usersStatus };
      nextStatus[userId] = this.getOverlayFreshness(userId);
      const changes     = this.diffStatus(this._state.usersStatus, nextStatus);
      this._state.usersStatus = nextStatus;
      this.emitSocket("DV_OVERLAY_HB", {
        usersStatus:             this._state.usersStatus,
        overlayLastSeenByUserId: this._state.overlayLastSeenByUserId,
        changes,
        hasChanges: Object.keys(changes).length > 0,
      });
      return;
    }

    if (typeof msg.evt !== "string" || !this._isRelayUser() || !isObject(msg.data)) return;

    const { evt, data } = msg;

    if (evt === "GET_CHANNEL") {
      globalThis.DiscordBridge?.voiceChat?.updateVoiceChatData(data, false);
      globalThis.DiscordBridge?.voiceChat?.updateUserProfiles(data.voice_states ?? []);
      return;
    }

    if (evt.startsWith("SPEAKING_")) {
      this.emitSocket("DV_SPEAKING", { ts: msg.ts ?? now(), evt, data });
      return;
    }

    if (evt.startsWith("VOICE_STATE_")) {
      if (!data.user_id && !data.raw?.user?.id) return;
      globalThis.DiscordBridge?.voiceChat?.updateUserProfiles([data], evt);
      globalThis.DiscordBridge?.voiceChat?.updateVoiceChatUserIds(data, evt);
    }
  }

  _isRelayUser() {
    return game.user.id === getSettings("relayUserId", false);
  }

  diffStatus(prev, next) {
    const changes = {};
    for (const [userId, nextVal] of Object.entries(next)) {
      const prevVal = prev[userId];
      if (!prevVal) continue;
      if (!!prevVal.active === !!nextVal.active && !!prevVal.fresh === !!nextVal.fresh) continue;
      changes[userId] = {
        prev: { active: !!prevVal.active, fresh: !!prevVal.fresh },
        next: { active: !!nextVal.active, fresh: !!nextVal.fresh },
      };
    }
    return changes;
  }

  emitSocket(key, data, { invokeLocal = true } = {}) {
    if (invokeLocal) {
      const handler = this.socketHandlers[key];
      if (typeof handler === "function") {
        try { handler(data); } catch (err) {
          console.warn(`DRL: local socket handler failed [${key}]:`, err);
        }
      }
    }
    game.socket.emit(`module.${MODULE_ID}`, { type: "DiscordRelayMessage", key, data });
  }

  _buildSocketHandlers() {
    return {
      DV_HB_REQUEST: (payload) => {
        this._state.usersStatus = payload.usersStatus;
        if (payload.hasChanges) {
          Hooks.callAll(HOOKS.USERS_STATUS_CHANGED, payload.usersStatus, payload.changes);
        }
        if (this._state.usersStatus[game.user.id]?.active) {
          try {
            this._state.overlayWindowRef?.postMessage({ type: "DV_OVERLAY_HB_REQUEST" }, "*");
          } catch { }
        }
      },

      DV_OVERLAY_HB: (payload) => {
        this._state.overlayLastSeenByUserId = payload.overlayLastSeenByUserId;
        this._state.usersStatus             = payload.usersStatus;
        if (payload.hasChanges) {
          Hooks.callAll(HOOKS.USERS_STATUS_CHANGED, payload.usersStatus, payload.changes);
        }
      },

      USER_STATE_UPDATE: (payload) => {
        if (payload.action === "add" && !this._state.overlayLastSeenByUserId[payload.userId]) {
          this._state.overlayLastSeenByUserId[payload.userId] = 0;
          this._state.usersStatus[payload.userId]             = { active: true, fresh: false, ageMs: Infinity };
        } else if (payload.action === "remove") {
          delete this._state.overlayLastSeenByUserId[payload.userId];
          this._state.usersStatus[payload.userId] = { active: false, fresh: false, ageMs: Infinity };
        }
      },

      DV_VOICE_STATE: (payload) => {
        const { data: users, evt } = payload;
        if (!users?.length) return;
        const hookKey = HOOKS[evt];
        if (!hookKey) { console.error("DRL: unknown voice state event:", evt); return; }

        const profiles            = getSettings("discordUserProfiles", false);
        const foundryDiscordIdsMap = getSettings("foundryDiscordIdsMap", false);
        const options             = { modifiedTime: payload.ts ?? now() };

        for (const user of users) {
          const profile = typeof user === "string" ? profiles[user] : profiles[user?.user_id ?? user?.userId];
          const discordUserId = typeof user === "string" ? user : (user?.user_id ?? user?.userId ?? null);

          const normalized = {
            user_id:   discordUserId,
            mute:      user?.mute !== undefined ? user.mute : (profile?.mute ?? false),
            deaf:      user?.deaf !== undefined ? user.deaf : (profile?.deaf ?? false),
            nick:      profile?.nick    ?? user?.nick    ?? null,
            username:  profile?.username ?? user?.username ?? null,
            avatarUrl: profile?.avatarUrl ?? user?.avatarUrl ?? null,
            bot:       profile?.bot     ?? user?.bot     ?? false,
          };

          const foundryUserId = discordUserId
            ? (Object.keys(foundryDiscordIdsMap).find(fId => foundryDiscordIdsMap[fId]?.includes(discordUserId)) ?? null)
            : null;

          Hooks.callAll(hookKey, { ...normalized, discordUserId, foundryUserId }, options);
        }
      },

      DV_SPEAKING: (payload) => {
        const hookKey = HOOKS[payload.evt];
        if (!hookKey) return;
        const foundryDiscordIdsMap = getSettings("foundryDiscordIdsMap", false);
        const discordUserId        = payload.data.user_id ?? null;
        const foundryUserId = discordUserId
          ? (Object.keys(foundryDiscordIdsMap).find(fId => foundryDiscordIdsMap[fId]?.includes(discordUserId)) ?? null)
          : null;
        Hooks.callAll(hookKey, { ...payload.data, foundryUserId, discordUserId });
      },
    };
  }
}
