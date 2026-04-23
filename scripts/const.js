export const MODULE_ID   = "discord-relay";
export const MODULE_PATH = `modules/${MODULE_ID}`;

export const HOOKS = {
  ON_TOGGLE:           `${MODULE_ID}.onToggle`,
  USERS_STATUS_CHANGED: `${MODULE_ID}.usersStatusChanged`,
  SPEAKING_START:       `${MODULE_ID}.userStartedSpeaking`,
  SPEAKING_STOP:        `${MODULE_ID}.userStoppedSpeaking`,
  VOICE_STATE_CREATE:   `${MODULE_ID}.userUpdated`,
  VOICE_STATE_DELETE:   `${MODULE_ID}.userUpdated`,
  VOICE_STATE_UPDATE:   `${MODULE_ID}.userUpdated`,
  RENDER_LISTS:         `${MODULE_ID}.renderLists`,
  LOG_ENTRY_ADDED:      `${MODULE_ID}.logEntryAdded`,
};

export const TICK_MS                  = 1000;
export const HB_INTERVAL_MS           = 5000;
export const READY_TTL_MS             = 12000;
export const PROFILES_SAVE_DEBOUNCE_MS = 1500;
export const LOG_MAX                  = 50;

export const RELAY_STATUS_ICONS = {
  OFFLINE: "fa-solid fa-circle-xmark",
  READY:   "fa-solid fa-circle-dot",
  ONLINE:  "fa-solid fa-circle",
  STALE:   "fa-solid fa-circle-exclamation",
};

export const VOICE_CHAT_DATA_KEYS = [
  "guild_id", "channel_id", "name", "topic", "user_limit",
];

export const TAB_ICONS = {
  relay: "fa-solid fa-tower-broadcast",
  guide: "fa-solid fa-book",
};
