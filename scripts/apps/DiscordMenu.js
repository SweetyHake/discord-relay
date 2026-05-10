import { MODULE_ID, HOOKS, TICK_MS, RELAY_STATUS_ICONS, LOG_MAX, TAB_ICONS } from "../const.js";
import { getSettings, modLoc, requestSettingsUpdate, requestQuickSettingsUpdate, copyToClipboard, now } from "../utils.js";
import { DiscordBridge } from "../bridge/DiscordBridge.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DiscordMenu extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id:      "discord-relay",
    classes: ["discord-relay-app"],
    position: { width: 700, height: 600 },
    window: {
      resizable: false,
      title:     `${MODULE_ID}.discordMenu.windowTitle`,
    },
    actions: {
      toggleRelay: DiscordMenu._onToggleRelay,
    },
  };

  static PARTS = {
    relay: { template: `modules/${MODULE_ID}/templates/relay.hbs` },
    guide: { template: `modules/${MODULE_ID}/templates/guide.hbs` },
  };

  constructor(options = {}) {
    options.id = `discord-relay-${options.page ?? "relay"}`;
    super(options);
    this._page               = options.page ?? "relay";
    this._tickerId           = null;
    this._guideScriptCache   = undefined;
    this._guideScriptLoading = null;
    this._hookRenderLists    = null;
  }

  async _prepareContext(_options) {
    let voiceChatData = getSettings("discordVoiceChatData");
    voiceChatData.voiceUrlIsValid = /\d{17,20}\/\d{17,20}/.test(voiceChatData._fullId ?? "");
    if (!voiceChatData.name) {
      voiceChatData.name = (voiceChatData.guild_id && voiceChatData.channel_id)
        ? modLoc("general.unknownVoiceChat")
        : "";
    }
    return { voiceChatData };
  }

  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    options.parts = [this._page];
  }

  async _preparePartContext(partId, context, options) {
    await super._preparePartContext(partId, context, options);
    if (partId === "guide") {
      context.guideScript = await this._loadGuideScript();
    }
    return context;
  }

  async _onRender(_context, options) {
    const el = this.element;

    this._stopTicker();
    if (this._page === "relay") this._startTicker();

    if (options.parts?.includes("relay")) this._initRelayTab(el);
    if (options.parts?.includes("guide")) this._initGuideTab(el);
  }

  async close(options = {}) {
    this._stopTicker();
    if (this._hookRenderLists) {
      Hooks.off(HOOKS.RENDER_LISTS, this._hookRenderLists);
      this._hookRenderLists = null;
    }
    return super.close(options);
  }

  _startTicker() {
    if (this._tickerId !== null) return;
    this._checkRelayState(true);
    this._tickerId = setInterval(() => this._checkRelayState(), TICK_MS);
  }

  _stopTicker() {
    if (this._tickerId === null) return;
    clearInterval(this._tickerId);
    this._tickerId = null;
  }

  _initRelayTab(el) {
    this._updateRelayButton(el);
    this._renderMappingList(el);
    this._renderDiscordVoiceChatList(el);
    this._fillLog(el);
    this._bindRelayInputs(el);

    if (this._hookRenderLists) Hooks.off(HOOKS.RENDER_LISTS, this._hookRenderLists);
    this._hookRenderLists = () => {
      if (!this.rendered) return;
      this._renderMappingList(this.element);
      this._renderDiscordVoiceChatList(this.element);
      this._updateRelayButton(this.element);
    };
    Hooks.on(HOOKS.RENDER_LISTS, this._hookRenderLists);
  }

  _bindRelayInputs(el) {
    const voiceInput = el.querySelector("input[name='voiceUrl']");
    const voiceIcon  = el.querySelector(".relay-status__config [data-name='voiceUrl'] i");

    const processVoiceUrl = async (value) => {
      const match = value.match(/(\d{17,20})\/(\d{17,20})/);
      if (match) {
        voiceInput.value = `${match[1]}/${match[2]}`;
        voiceIcon?.classList.replace("fa-circle-xmark", "fa-circle-check");
        const prev = getSettings("discordVoiceChatData", false);
        if (prev.guild_id === match[1] && prev.channel_id === match[2]) return;
        await requestSettingsUpdate("discordVoiceChatData", {
          guild_id: match[1], channel_id: match[2],
          _fullId:  `${match[1]}/${match[2]}`,
          name:     modLoc("general.unknownVoiceChat"),
          topic: "", user_limit: null,
        });
        ui.notifications.info(modLoc("notifications.voiceChatDataUpdated"));
      } else {
        voiceIcon?.classList.replace("fa-circle-check", "fa-circle-xmark");
        await requestSettingsUpdate("discordVoiceChatData", {
          guild_id: null, channel_id: null, _fullId: null,
          name: null, topic: null, user_limit: null,
        });
      }
      this._updateRelayButton(this.element);
    };

    const debouncedInput = foundry.utils.debounce(e => processVoiceUrl(e.target.value), 500);
    voiceInput?.addEventListener("input", debouncedInput);
    voiceInput?.addEventListener("paste", () => setTimeout(() => processVoiceUrl(voiceInput.value), 0));


  }

  _updateRelayButton(el) {
    const btn      = el?.querySelector("button[data-action='toggleRelay']");
    const statusEl = el?.querySelector(".relay-status__text");
    if (!btn) return;

    const voiceData           = getSettings("discordVoiceChatData", false);
    const voiceUrlIsValid     = /\d{17,20}\/\d{17,20}/.test(voiceData._fullId ?? "");
    const canEnable           = voiceUrlIsValid;

    btn.disabled            = !canEnable;
    btn.dataset.tooltip     = canEnable ? "" : modLoc("discordMenu.relayStatusConfig.disableRelayButtonTooltip");

    const ids       = game.users.filter(u => u.active).map(u => u.id);
    const states    = DiscordBridge.voiceActivityRelay.getOverlayFreshnessArray(ids);
    const relayId   = getSettings("relayUserId", false);
    const hasActive = Object.values(states).some(s => s.active);
    const hasFresh  = Object.values(states).some(s => s.fresh);

    const status =
      (!hasActive || (!hasFresh && !relayId)) ? "OFFLINE" :
      !hasFresh                                ? "STALE"   :
      !relayId                                 ? "READY"   : "ACTIVE";

    const isActive = status !== "OFFLINE" && relayId === game.user.id;
    btn.classList.toggle("active", isActive);
    const span = btn.querySelector("span");
    if (span) span.textContent = modLoc(`discordMenu.headerRelayButton${isActive ? "Deactivate" : "Activate"}`);
    if (statusEl) statusEl.textContent = status;
  }

  // ── Mapping list (Discord user → Foundry user) ─────────────────────────────

  _renderMappingList(el) {
    const container = el?.querySelector(".mapping-list");
    if (!container) return;

    const profiles  = getSettings("discordUserProfiles", false);
    const idsMap    = getSettings("foundryDiscordIdsMap", false);
    const foundryUsers = game.users;

    // Build options once
    const selectOptions = [
      { value: "", label: `— ${modLoc("discordMenu.foundryUserList.noLink")} —` },
      ...foundryUsers.map(u => ({ value: u.id, label: u.name })),
    ];

    // Build reverse map: discordId → foundryUserId
    const discordToFoundryMap = {};
    for (const [fId, dIds] of Object.entries(idsMap)) {
      if (dIds?.length) {
        for (const dId of dIds) {
          discordToFoundryMap[dId] = fId;
        }
      }
    }

    const frag = document.createDocumentFragment();
    for (const [discordId, profile] of Object.entries(profiles)) {
      if (!profile) continue;
      const row = this._buildMappingRow(profile, discordId, discordToFoundryMap[discordId] ?? null, selectOptions);
      frag.appendChild(row);
    }

    container.innerHTML = "";
    container.appendChild(frag);
  }

  _buildMappingRow(profile, discordId, linkedFoundryId, selectOptions) {
    const row = document.createElement("div");
    row.className = "mapping-row";
    row.dataset.discordUserId = discordId;

    // Avatar
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "mapping-row__avatar";
    if (profile.avatarUrl) {
      const img = Object.assign(document.createElement("img"), {
        src: profile.avatarUrl, alt: "",
      });
      avatarWrap.appendChild(img);
    }
    row.appendChild(avatarWrap);

    // Name
    row.appendChild(Object.assign(document.createElement("span"), {
      className:   "mapping-row__name",
      textContent: profile.nick ?? profile.username ?? discordId,
    }));

    // Spacer
    row.appendChild(Object.assign(document.createElement("div"), { className: "mapping-row__spacer" }));

    // Select
    const select = document.createElement("select");
    select.className = "mapping-row__select";
    for (const opt of selectOptions) {
      const el = Object.assign(document.createElement("option"), {
        value:    opt.value,
        textContent: opt.label,
      });
      if (opt.value === linkedFoundryId) el.selected = true;
      select.appendChild(el);
    }
    select.addEventListener("change", async e => {
      const foundryUserId = e.target.value || null;
      const idsMap = getSettings("foundryDiscordIdsMap", false);
      const updates = { ...idsMap };
      for (const [fId, dIds] of Object.entries(updates)) {
        const arr = Array.isArray(dIds) ? dIds : (dIds ? [dIds] : []);
        updates[fId] = arr.filter(dId => dId !== discordId);
      }
      if (foundryUserId) {
        if (!updates[foundryUserId]) updates[foundryUserId] = [];
        if (!updates[foundryUserId].includes(discordId)) {
          updates[foundryUserId] = [...updates[foundryUserId], discordId];
        }
      }
      await requestQuickSettingsUpdate("foundryDiscordIdsMap", updates);
    });
    row.appendChild(select);

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "mapping-row__delete";
    deleteBtn.type = "button";
    deleteBtn.title = modLoc("discordMenu.foundryUserList.delete");
    deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
    deleteBtn.addEventListener("click", async () => {
      const profiles = getSettings("discordUserProfiles", false);
      const updates = { ...profiles };
      delete updates[discordId];
      await requestSettingsUpdate("discordUserProfiles", updates);
      this._renderMappingList(this.element);
    });
    row.appendChild(deleteBtn);

    return row;
  }

  // ── Discord voice chat list ────────────────────────────────────────────────

  _renderDiscordVoiceChatList(el) {
    const list = el?.querySelector(".discord-voice-chat__list");
    if (!list) return;
    list.innerHTML = "";

    const relayId = getSettings("relayUserId", false);
    const isFresh = DiscordBridge.voiceActivityRelay.getOverlayFreshness(relayId).fresh;

    if (isFresh) {
      const userIds  = getSettings("discordVoiceChatUserIds", false);
      const profiles = getSettings("discordUserProfiles", false);
      const frag     = document.createDocumentFragment();
      for (const userId of userIds) {
        const profile = profiles[userId];
        if (!profile) continue;
        const item = this._buildDiscordVoiceChatItem(profile);
        if (item) frag.appendChild(item);
      }
      list.appendChild(frag);
    } else {
      const warning = document.createElement("div");
      warning.className = "warning";
      const icon = Object.assign(document.createElement("i"), { className: "fa-solid fa-triangle-exclamation" });
      const text = Object.assign(document.createElement("span"), {
        textContent: modLoc("discordMenu.voiceChat.chatInactiveWarning"),
      });
      warning.appendChild(icon);
      warning.appendChild(text);
      list.appendChild(warning);
    }
  }

  _buildDiscordVoiceChatItem(user) {
    if (!user) return null;
    const item = document.createElement("div");
    item.className         = "discord-voice-chat__item";
    item.dataset.discordUserId = user.userId;

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "user-avatar-wrapper";
    avatarWrap.appendChild(Object.assign(document.createElement("img"), {
      src: user.avatarUrl ?? "", alt: "",
    }));
    item.appendChild(avatarWrap);

    item.appendChild(Object.assign(document.createElement("span"), {
      textContent: user.nick ?? user.username ?? "",
    }));

    if (user.mute) {
      item.appendChild(Object.assign(document.createElement("i"), {
        className: "fa-solid fa-microphone-slash",
      }));
    }

    return item;
  }

  // ── Log ───────────────────────────────────────────────────────────────────

  _fillLog(el) {
    const list = el?.querySelector(".log-container .log__list");
    if (!list) return;
    const entries = (globalThis.DiscordBridge?.voiceChat?.getLog?.() ?? [])
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    list.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const item = this._buildLogItem(entry);
      if (item) frag.appendChild(item);
    }
    list.appendChild(frag);
  }

  addLogEntry(entry) {
    const list = this.element?.querySelector(".log-container .log__list");
    if (!list) return;
    const item = this._buildLogItem(entry, true);
    if (!item) return;
    list.prepend(item);
    while (list.children.length > LOG_MAX) list.lastElementChild?.remove();
  }

  _buildLogItem(entry, animate = false) {
    if (!entry) return null;

    const item = document.createElement("div");
    item.className = "log__item";
    if (entry.ts)   item.dataset.logTs   = String(entry.ts);
    if (entry.type) item.dataset.logType = String(entry.type);
    if (animate)    item.classList.add("enter");

    const timeStr = (entry.ts && !Number.isNaN(entry.ts))
      ? new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "--:--:--";

    item.appendChild(Object.assign(document.createElement("span"), {
      className: "time", textContent: timeStr,
    }));

    const data      = entry.payload ?? {};
    const avatarUrl = data.avatarUrl ?? null;

    if (avatarUrl) {
      const avatar = Object.assign(document.createElement("img"), { className: "avatar", alt: "" });
      if (avatarUrl.includes(".gif")) {
        avatar.src = avatarUrl.replace(".gif", ".png");
        avatar.dataset.animatedUrl = avatarUrl;
      } else {
        avatar.src = avatarUrl;
      }
      avatar.dataset.staticUrl = avatar.src;
      item.appendChild(avatar);
    } else {
      item.appendChild(Object.assign(document.createElement("div"), { className: "avatar" }));
    }

    const nick = data.nick ?? data.name ?? entry.discordUserId ?? "";
    const type = entry.type ?? "";
    item.appendChild(Object.assign(document.createElement("span"), {
      className:   "text",
      textContent: [nick, type].filter(Boolean).join(" — "),
    }));

    item.appendChild(Object.assign(document.createElement("div"), { className: "filler" }));

    return item;
  }

  // ── Guide tab ─────────────────────────────────────────────────────────────

  _initGuideTab(el) {
    if (!el) return;
    const copyBtn = el.querySelector("[data-guide-copy='script']");
    const codeEl  = el.querySelector("[data-guide-script]");
    if (!copyBtn || !codeEl) return;

    const defaultLabel = copyBtn.dataset.labelDefault ?? copyBtn.textContent.trim();
    const copiedLabel  = copyBtn.dataset.labelCopied  ?? defaultLabel;

    copyBtn.addEventListener("click", async e => {
      e.preventDefault();
      e.stopPropagation();
      const text = codeEl.textContent.trim();
      if (!text) return;
      const ok = await copyToClipboard(text);
      if (ok) {
        clearTimeout(copyBtn._resetTimer);
        copyBtn.textContent = copiedLabel;
        copyBtn.classList.add("success");
        copyBtn._resetTimer = setTimeout(() => {
          copyBtn.textContent = defaultLabel;
          copyBtn.classList.remove("success");
        }, 2000);
      } else {
        ui.notifications.warn(modLoc("discordMenu.guide.prep.tamper.script.copyError"));
      }
    });
  }

  async _loadGuideScript() {
    if (this._guideScriptCache !== undefined) return this._guideScriptCache;
    if (this._guideScriptLoading) return this._guideScriptLoading;
    if (!globalThis.fetch) { this._guideScriptCache = null; return null; }

    this._guideScriptLoading = fetch(`modules/${MODULE_ID}/tm.js`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => { this._guideScriptCache = text; return text; })
      .catch(err => {
        console.warn("DRL: Failed to load TamperMonkey guide script", err);
        this._guideScriptCache = null;
        return null;
      })
      .finally(() => { this._guideScriptLoading = null; });

    return this._guideScriptLoading;
  }

  // ── Ticker / state check ──────────────────────────────────────────────────

  _checkRelayState(forced = false) {
    const ids     = game.users.filter(u => u.active).map(u => u.id);
    const states  = DiscordBridge.voiceActivityRelay.getOverlayFreshnessArray(ids);
    const relayId = getSettings("relayUserId", false);
    const uiBuf   = DiscordBridge.ui.usersStateBuffer;

    const newRelayActive = states[relayId]?.fresh ?? false;
    if (DiscordBridge.ui.relayIsActiveBuffer !== newRelayActive) {
      DiscordBridge.ui.relayIsActiveBuffer = newRelayActive;
      this._renderDiscordVoiceChatList(this.element);
    }

    let needsRelayBtn = false;
    for (const userId of ids) {
      const state     = states[userId];
      const currAlive = state?.active ? state : null;
      const bufStatus = uiBuf.get(userId);

      if (!currAlive && !bufStatus) continue;

      const freshChanged = bufStatus && currAlive && bufStatus.fresh !== state.fresh;
      const appeared     = !!currAlive !== !!bufStatus;

      if (!forced && !freshChanged && !appeared) continue;

      if (currAlive) uiBuf.set(userId, { fresh: state.fresh });
      else uiBuf.delete(userId);

      needsRelayBtn = true;
    }

    if (forced || needsRelayBtn) this._updateRelayButton(this.element);
  }

  _getUserVoiceStatus(state, isRelayUser) {
    if (!state?.active) return "OFFLINE";
    if (!state.fresh)   return "STALE";
    if (isRelayUser)    return "ONLINE";
    return "READY";
  }

  static _onToggleRelay(_event, _target) {
    const wasActive = DiscordBridge.state.messageListenerInstalled;
    if (wasActive) DiscordBridge.voiceActivityRelay.uninstallOverlayListener();
    else          DiscordBridge.voiceActivityRelay.installOverlayListener();
    const isActive = DiscordBridge.state.messageListenerInstalled;
    Hooks.callAll(HOOKS.ON_TOGGLE, isActive ? "on" : "off");
  }

  static _installHooks() {
    Hooks.on(HOOKS.USERS_STATUS_CHANGED, () => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof DiscordMenu) app._updateRelayButton(app.element);
      }
    });

    Hooks.on(HOOKS.LOG_ENTRY_ADDED, entry => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof DiscordMenu) {
          try { app.addLogEntry(entry); } catch { /* ignore */ }
        }
      }
    });

    Hooks.on("userConnected", () => {
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof DiscordMenu) app._renderMappingList(app.element);
      }
    });

    Hooks.on(HOOKS.SPEAKING_START, data => {
      document.querySelector(
        `.discord-voice-chat__item[data-discord-user-id="${data.user_id}"]`
      )?.classList.add("speaking");
    });

    Hooks.on(HOOKS.SPEAKING_STOP, data => {
      document.querySelector(
        `.discord-voice-chat__item[data-discord-user-id="${data.user_id}"]`
      )?.classList.remove("speaking");
    });
  }
} 
