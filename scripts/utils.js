import { MODULE_ID } from "./const.js";

export const modLoc    = (key)       => game.i18n.localize(`${MODULE_ID}.${key}`);
export const modFormat = (key, data) => game.i18n.format(`${MODULE_ID}.${key}`, data);

export const getSettings = (key, deepClone = true) =>
  deepClone
    ? foundry.utils.deepClone(game.settings.get(MODULE_ID, key))
    : game.settings.get(MODULE_ID, key);

export const isObject         = (x)    => x !== null && typeof x === "object";
export const arraysEqual      = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export const getActiveUserIds = ()     => game.users.filter(u => u.active).map(u => u.id);
export const now              = ()     => Date.now();

export async function requestSettingsUpdate(settingKey, settingData, options = {}) {
  const setting = game.settings.settings.get(`${MODULE_ID}.${settingKey}`);
  if (game.user.isGM || setting?.scope === "client") {
    await game.settings.set(MODULE_ID, settingKey, settingData, options);
  } else {
    game.socket.emit(`module.${MODULE_ID}`, {
      type:    "setSetting",
      key:     settingKey,
      data:    settingData,
      options,
    });
  }
}

export async function requestQuickSettingsUpdate(settingKey, patch, options = {}) {
  const current = getSettings(settingKey);
  const next = typeof patch === "object"
    ? foundry.utils.mergeObject(current, patch, { inplace: false })
    : patch;
  await requestSettingsUpdate(settingKey, next, options);
}

export async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.readOnly = true;
      Object.assign(el.style, { position: "fixed", opacity: "0", left: "-9999px" });
      document.body.appendChild(el);
      el.select();
      el.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
