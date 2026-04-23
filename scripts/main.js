import { MODULE_ID, HOOKS } from "./const.js";
import { registerSettings, registerSocket } from "./settings.js";
import { DiscordBridge } from "./bridge/DiscordBridge.js";
import { DiscordMenu }   from "./apps/DiscordMenu.js";

Hooks.once("init", () => {
  registerSettings();
  CONFIG[MODULE_ID] = { hooks: HOOKS };
});

Hooks.once("setup", () => {
  registerSocket();
});

Hooks.once("ready", async () => {
  globalThis.DiscordBridge = DiscordBridge;

  if (game.user.isGM) {
    DiscordBridge.statusCheck.startHeartbeatBroadcast();
  }

  const autoStart = game.settings.get(MODULE_ID, "autoStart");
  if (autoStart) {
    const relayUserId = game.settings.get(MODULE_ID, "relayUserId");
    if (relayUserId && relayUserId === game.user.id) {
      setTimeout(async () => {
        await DiscordBridge.voiceActivityRelay.installOverlayListener();
        Hooks.callAll(HOOKS.ON_TOGGLE, "on");
      }, 3000);
    }
  }
  
  DiscordMenu._installHooks();

});

Hooks.on("userConnected", user => {
  delete DiscordBridge.state.overlayLastSeenByUserId[user.id];
});

Hooks.on("userDisconnected", user => {
  delete DiscordBridge.state.overlayLastSeenByUserId[user.id];
});