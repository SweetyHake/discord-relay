import { VoiceActivityRelay } from "./VoiceActivityRelay.js";
import { StatusCheck }        from "./StatusCheck.js";
import { VoiceChat }          from "./VoiceChat.js";
import { getSettings }        from "../utils.js";

class DiscordBridgeClass {
  constructor() {
    this.state = {
      usersStatus:              {},
      overlayLastSeenByUserId:  {},
      hbIntervalId:             null,
      messageListenerInstalled: false,
      overlayWindowRef:         null,
    };

    this.voiceActivityRelay = new VoiceActivityRelay(this.state);
    this.statusCheck        = new StatusCheck(this.state, this.voiceActivityRelay);
    this.voiceChat          = new VoiceChat(this.voiceActivityRelay);

    this.ui = {
      usersStateBuffer:    new Map(),
      relayIsActiveBuffer: false,
    };

    this.discordMenu = {
      open: (options = {}) => this.openMenu(options),
    };

    this.mutedList = () => {
      const profiles = getSettings("discordUserProfiles", false) ?? {};
      const voiceUserIds = getSettings("discordVoiceChatUserIds", false) ?? [];
      return voiceUserIds
        .filter(userId => profiles[userId]?.mute)
        .map(userId => ({ userId, ...profiles[userId] }));
    };

    this.deafenedList = () => {
      const profiles = getSettings("discordUserProfiles", false) ?? {};
      const voiceUserIds = getSettings("discordVoiceChatUserIds", false) ?? [];
      return voiceUserIds
        .filter(userId => profiles[userId]?.deaf)
        .map(userId => ({ userId, ...profiles[userId] }));
    };
  }

  async openMenu(options = {}) {
    const id = `discord-relay-${options.page ?? "relay"}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) {
      if (options.page && existing._page !== options.page) {
        existing._page = options.page;
        await existing.render({ parts: [options.page] });
      }
      existing.bringToFront();
      return existing;
    }
    const { DiscordMenu } = await import("../apps/DiscordMenu.js");
    return new DiscordMenu(options).render(true);
  }
}

export const DiscordBridge = new DiscordBridgeClass();
