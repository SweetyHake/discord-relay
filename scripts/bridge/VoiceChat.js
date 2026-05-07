import { VOICE_CHAT_DATA_KEYS, HOOKS } from "../const.js";
import { arraysEqual, getSettings, now, requestSettingsUpdate } from "../utils.js";

export class VoiceChat {
  constructor(voiceActivityRelay) {
    this._relay = voiceActivityRelay;
  }

  _extractUserData(data) {
    const userRaw = data?.raw?.user ?? data?.user;
    if (!data || !userRaw) return null;
    const userId = data.user_id ?? userRaw.id;
    if (!userId) return null;
    return {
      userId,
      mute:     data.mute !== undefined ? data.mute : (userRaw.voice_state?.mute || userRaw.voice_state?.self_mute || false),
      deaf:     data.deaf !== undefined ? data.deaf : (userRaw.voice_state?.deaf || userRaw.voice_state?.self_deaf || false),
      nick:     data.nick ?? data.raw?.nick ?? userRaw.global_name ?? null,
      username: data.name ?? userRaw.username ?? null,
      avatarUrl: data.avatarUrl ?? null,
      bot:      userRaw.bot ?? false,
    };
  }

  async updateUserProfiles(users = [], socketEvt = null) {
    if (!users?.length) return;
    const profiles = getSettings("discordUserProfiles");
    let changed = false;

    for (const user of users) {
      const next = this._extractUserData(user);
      if (!next?.userId) continue;
      const prev = profiles[next.userId];
      if (!prev || !foundry.utils.equals(prev, next)) {
        profiles[next.userId] = next;
        changed = true;
      }
    }

    if (!changed) return;

    await requestSettingsUpdate("discordUserProfiles", profiles);

    if (socketEvt) {
      this._relay.emitSocket("DV_VOICE_STATE", {
        ts:            now(),
        foundryUserId: game.user.id,
        evt:           socketEvt,
        data:          users,
      });
    }
  }

  async updateVoiceChatData(data, checkId = false) {
    if (checkId) {
      const current = getSettings("discordVoiceChatData", false);
      if (data.guild_id !== current?.guild_id || data.channel_id !== current?.channel_id) return;
    }

    const prev = getSettings("discordVoiceChatData");
    const next = VOICE_CHAT_DATA_KEYS.reduce((acc, key) => ({ ...acc, [key]: data[key] ?? null }), {});
    next._fullId = (next.guild_id && next.channel_id)
      ? `${next.guild_id}/${next.channel_id}`
      : undefined;

    let needsRender = true;

    if (!foundry.utils.equals(prev, next)) {
      needsRender = false;
      await requestSettingsUpdate("discordVoiceChatData", next);
    }

    const prevUserIds = getSettings("discordVoiceChatUserIds");
    const nextUserIds = (data.voice_states ?? [])
      .map(u => u.user_id ?? u.raw?.user?.id)
      .filter(Boolean);

    if (!arraysEqual(prevUserIds, nextUserIds)) {
      needsRender = false;
      await requestSettingsUpdate("discordVoiceChatUserIds", nextUserIds);
    }

    if (needsRender) {
      Hooks.callAll(HOOKS.RENDER_LISTS);
    }
  }

  async updateVoiceChatUserIds(data, evt) {
    const userId = data.user_id;
    if (!userId || (evt !== "VOICE_STATE_CREATE" && evt !== "VOICE_STATE_DELETE")) return;

    const prevIds = getSettings("discordVoiceChatUserIds");
    let changed   = false;

    if (evt === "VOICE_STATE_CREATE" && !prevIds.includes(userId)) {
      prevIds.push(userId);
      changed = true;
    } else if (evt === "VOICE_STATE_DELETE") {
      const idx = prevIds.indexOf(userId);
      if (idx > -1) { prevIds.splice(idx, 1); changed = true; }
    }

    if (!changed) return;

    const nextIds = [...prevIds];
    await requestSettingsUpdate("discordVoiceChatUserIds", nextIds);
    this._relay.emitSocket("DV_VOICE_STATE", {
      ts:           now(),
      foundryUserId: game.user.id,
      evt,
      data:         [userId],
    });
  }
}
