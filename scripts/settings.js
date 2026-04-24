import { MODULE_ID, HOOKS } from "./const.js";
import { getSettings, isObject, requestSettingsUpdate } from "./utils.js";
import { DiscordBridge } from "./bridge/DiscordBridge.js";

export function registerSettings() {
  const loc = key => `${MODULE_ID}.settings.${key}`;

  game.settings.registerMenu(MODULE_ID, "openRelayMenu", {
    name: loc("openRelayMenu"),
    hint: loc("openRelayMenuHint"),
    label: loc("openRelayMenuButton"),
    icon: "fa-solid fa-tower-broadcast",
    type: class extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = { tags: ["discord-relay"] };
      async render() { DiscordBridge.discordMenu.open({ page: "relay" }); }
    },
    restricted: false,
  });

  game.settings.registerMenu(MODULE_ID, "openGuideMenu", {
    name: loc("openGuideMenu"),
    hint: loc("openGuideMenuHint"),
    label: loc("openGuideMenuButton"),
    icon: "fa-solid fa-book-open",
    type: class extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = { tags: ["discord-relay"] };
      async render() { DiscordBridge.discordMenu.open({ page: "guide" }); }
    },
    restricted: false,
  });

  game.settings.register(MODULE_ID, "relayUserId", {
    name: loc("relayUserId"),
    hint: loc("relayUserIdHint"),
    scope: "world", config: false, type: String, default: "",
    onChange: () => Hooks.callAll(HOOKS.RENDER_LISTS),
  });

  game.settings.register(MODULE_ID, "overlayPopup", {
    name: loc("overlayPopup"),
    hint: loc("overlayPopupHint"),
    scope: "client", config: true, type: String,
    choices: {
      tab:    loc("overlayPopupTab"),
      window: loc("overlayPopupWindow"),
    },
    default: "tab",
  });

  game.settings.register(MODULE_ID, "browserConfirmation", {
    scope: "client", config: false, type: Boolean, default: false,
  });

  game.settings.register(MODULE_ID, "autoStart", {
    name: loc("autoStart"),
    hint: loc("autoStartHint"),
    scope: "client", config: true, type: Boolean, default: false,
  });

  game.settings.register(MODULE_ID, "discordUserProfiles", {
    scope: "world", config: false, type: Object, default: {},
    onChange: async (value) => {
      Hooks.callAll(HOOKS.RENDER_LISTS);
      const map      = getSettings("foundryDiscordIdsMap", false);
      const profiles = Object.entries(value).map(([userId, p]) => ({ ...p, userId }));
      let changed    = false;
      for (const [foundryId, discordId] of Object.entries(map)) {
        const match = profiles.find(p => p.nick === discordId || p.username === discordId);
        if (match) { map[foundryId] = match.userId; changed = true; }
      }
      if (changed) await requestSettingsUpdate("foundryDiscordIdsMap", map);
    },
  });

  game.settings.register(MODULE_ID, "foundryDiscordIdsMap", {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => Hooks.callAll(HOOKS.RENDER_LISTS),
  });

  game.settings.register(MODULE_ID, "discordVoiceChatUserIds", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => Hooks.callAll(HOOKS.RENDER_LISTS),
  });

  game.settings.register(MODULE_ID, "discordVoiceChatData", {
    scope: "world", config: false, type: Object, default: {},
    onChange: (data) => {
      Hooks.callAll(HOOKS.RENDER_LISTS);
      if (!DiscordBridge.state.messageListenerInstalled) return;
      if (data.guild_id && data.channel_id) {
        DiscordBridge.voiceActivityRelay.installOverlayListener();
      } else {
        DiscordBridge.voiceActivityRelay.uninstallOverlayListener();
      }
    },
  });

  game.settings.register(MODULE_ID, "speakingEventDebounceMs", {
    scope: "world", config: false, type: Number, default: 0,
  });

  game.settings.register(MODULE_ID, "browserOpeningLocation", {
    scope: "client", config: false, type: String,
    enum: ["tab", "window"], default: "tab",
    onChange: () => Hooks.callAll(HOOKS.RENDER_LISTS),
  });
}

export function registerSocket() {
  game.socket.on(`module.${MODULE_ID}`, async (msg) => {
    if (!isObject(msg) || typeof msg.type !== "string") return;
    const { type, key, data, options } = msg;

    if (type === "setSetting") {
      if (game.user.isGM) await game.settings.set(MODULE_ID, key, data, options ?? {});
      return;
    }

    if (type === "DiscordRelayMessage") {
      const handler = DiscordBridge.voiceActivityRelay.socketHandlers[key];
      if (typeof handler !== "function") return;
      try { handler(data); } catch (err) {
        console.warn(`DRL: socket handler failed [${key}]:`, err);
      }
    }
  });
}