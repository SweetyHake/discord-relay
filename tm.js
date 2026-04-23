// ==UserScript==
// @name         Streamkit Speaking Rela
// @version      0.3.0
// @description  Relays VOICE_STATE_* + SPEAKING_* from Discord Streamkit overlay to the opener window (Foundry). Adds on-demand roster snapshot via DV_REQUEST_SNAPSHOT.
// @match        https://streamkit.discord.com/overlay/voice/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(async function() {
    'use strict'

    // discordUserId -> { name, nick, avatarUrl }
    const profiles = {}

    const orig = {
        log: window.console.log.bind(window.console),
        info: window.console.info.bind(window.console),
        debug: window.console.debug.bind(window.console),
        warn: window.console.warn.bind(window.console)
    }

    function extractEvt(args) {
        for (const a of args) {
            if (!a || typeof a !== 'object') continue

            if (typeof a.evt === 'string' && a.data && typeof a.data === 'object') {
                return { evt: a.evt, data: a.data, cmd: a.cmd }
            }

            if (a.data && typeof a.data === 'object' && typeof a.data.evt === 'string') {
                return { evt: a.data.evt, data: a.data, cmd: a.cmd }
            }

            if (a.data && typeof a.data === 'object' && typeof a.cmd === 'string') {
                return { evt: null, data: a.data, cmd: a.cmd }
            }
        }
        return null
    }

    // Fallback (только если нет данных в payload). Может быть неидеальным/устаревшим.
    function safeMetaFromDom(userId) {
        try {
            const img = document.querySelector(`img[src*="${userId}"]`)
            const span = img?.parentElement?.querySelector("span")
            const mute = img?.parentElement.classList.contains("mute") || img?.parentElement.classList.contains("self_mute")
            const deaf = img?.parentElement.classList.contains("deaf") || img?.parentElement.classList.contains("self_deaf")
            return {
                nick: span?.textContent?.trim() || null,
                avatarUrl: img?.currentSrc || img?.src || null,
                mute,
                deaf
            }
        } catch (e) {
            return { nick: null, avatarUrl: null, mute: false, deaf: false }
        }
    }

    function getUserIdFromVoiceState(data) {
        return data?.user?.id ?? data?.user_id ?? data?.userId ?? null
    }

    function buildAvatarUrl(user) {
        if (!user?.id) return null

        if (user.avatar) {
            const ext = String(user.avatar).startsWith("a_") ? "gif" : "png"
            return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`
        }

        const disc = parseInt(user.discriminator, 10)
        const idx = Number.isFinite(disc) ? (disc % 5) : 0
        return `https://cdn.discordapp.com/embed/avatars/${idx}.png`
    }

    function upsertProfileFromVoiceState(data) {
        const userId = getUserIdFromVoiceState(data)
        if (!userId) return null

        const u = data?.user || {}

        const name = u.username
            ? (u.discriminator && u.discriminator !== "0"
                ? `${u.username}#${u.discriminator}`
                : u.username)
            : null

        const nick = data?.nick ?? u.global_name ?? u.username ?? null
        const avatarUrl = buildAvatarUrl(u)
        const mute = (data?.voice_state?.mute || data?.voice_state?.self_mute) ?? false
        const deaf = (data?.voice_state?.deaf || data?.voice_state?.self_deaf) ?? false

        const next = { name, nick, avatarUrl, mute, deaf }
        profiles[userId] = next
        return { userId, ...next }
    }

    function getCachedProfile(userId) {
        return profiles[userId] || null
    }

    function postToFoundry(payload) {
        if (!window.opener) return
        window.opener.postMessage(payload, "*")
    }

    // ─────────────────────────────────────────────
    // Snapshot (по запросу из Foundry)
    // ─────────────────────────────────────────────
    function parseOverlayIdsFromUrl() {
        const m = window.location.pathname.match(/\/overlay\/voice\/(\d+)\/(\d+)/)
        if (!m) return { guildId: null, channelId: null }
        return { guildId: m[1] || null, channelId: m[2] || null }
    }

    function findNickNearImg(img) {
        try {
            let el = img
            for (let i = 0; i < 5; i++) {
                const parent = el?.parentElement
                if (!parent) break

                const span = parent.querySelector("span")
                const text = span?.textContent?.trim()
                if (text) return text

                el = parent
            }
        } catch (e) {
            // ignore
        }
        return null
    }

    function extractDiscordUserIdFromAvatarUrl(url) {
        if (!url || typeof url !== "string") return null

        // cdn.discordapp.com/avatars/<id>/<hash>.png
        let m = url.match(/\/avatars\/(\d{5,})\//)
        if (m) return m[1]

        // иногда встречаются иные паттерны (на всякий)
        m = url.match(/\/users\/(\d{5,})\//)
        if (m) return m[1]

        return null
    }

    function collectRosterFromDom() {
        const out = new Map()

        const imgs = Array.from(document.querySelectorAll("img"))
        for (const img of imgs) {
            const src = img.currentSrc || img.src || ""
            if (!src) continue

            const userId = extractDiscordUserIdFromAvatarUrl(src)
            if (!userId) continue
            if (out.has(userId)) continue

            // meta: сначала из кэша (если уже был VOICE_STATE), иначе из DOM вокруг img
            const cached = getCachedProfile(userId)
            const nick = cached?.nick || findNickNearImg(img) || null
            const avatarUrl = cached?.avatarUrl || src || null
            const name = cached?.name || null

            const entry = { user_id: userId, name, nick, avatarUrl }
            out.set(userId, entry)

            // слегка “подпитаем” кэш, чтобы SPEAKING_* имели мету даже до VOICE_STATE
            if (!cached) profiles[userId] = { name, nick, avatarUrl }
        }

        return Array.from(out.values())
    }

    function onMessageFromFoundry(event) {
        if (!window.opener) return
        if (event.source !== window.opener) return

        const msg = event.data
        if (!msg || typeof msg !== "object") return

        if (msg.type === "DV_OVERLAY_HB_REQUEST") {
            postToFoundry({ type: "DV_OVERLAY_HB", ts: Date.now() })
        }
    }

    window.addEventListener("message", onMessageFromFoundry)

    // ─────────────────────────────────────────────
    // Relay VOICE_STATE_* + SPEAKING_* (как было, но с payload-meta)
    // ─────────────────────────────────────────────
    function handleConsole(method, args) {
        orig[method](...args)

        if (!window.opener) return

        const extracted = extractEvt(args)
        if (!extracted) return

        const { cmd, evt, data } = extracted

        const VOICE_EVTS = new Set(["VOICE_STATE_CREATE", "VOICE_STATE_DELETE", "VOICE_STATE_UPDATE"])
        const SPEAK_EVTS = new Set(["SPEAKING_START", "SPEAKING_STOP"])

        // Событие "Инициализация канала"
        if (cmd === "GET_CHANNEL") {
            const voice_states = data?.voice_states ?? data?.voiceStates ?? []
            const userList = voice_states.reduce((acc, user) => {
                const meta = upsertProfileFromVoiceState(user)
                const userId = meta?.userId ?? getUserIdFromVoiceState(user)
                const domMeta = (!meta && userId) ? safeMetaFromDom(userId) : { nick: null, avatarUrl: null, mute: false, deaf: false }
                return [...acc, {
                    raw: user,
                    user_id: userId,
                    name: meta?.name ?? null,
                    nick: meta?.nick ?? domMeta.nick,
                    avatarUrl: meta?.avatarUrl ?? domMeta.avatarUrl,
                    mute: meta?.mute ?? domMeta.mute,
                    deaf: meta?.deaf ?? domMeta.deaf,
                }]
            }, [])
            postToFoundry({
                evt: "GET_CHANNEL",
                ts: Date.now(),
                data: {
                    raw: data,
                    name: data?.name ?? null,
                    topic: data?.topic ?? null,
                    guild_id: data?.guild_id ?? data?.guildId ?? null,
                    channel_id: data?.channel_id ?? data?.channelId ?? data?.id ?? null,
                    user_limit: data?.user_limit ?? data?.userLimit ?? null,
                    voice_states: userList,
                },
            })
            return
        }
        if (!evt) return

        // События "Зашёл в канал / Вышел из канала / Изменился профиль"
        if (VOICE_EVTS.has(evt)) {
            const meta = upsertProfileFromVoiceState(data)
            const userId = meta?.userId ?? getUserIdFromVoiceState(data)
            const domMeta = (!meta && userId) ? safeMetaFromDom(userId) : { nick: null, avatarUrl: null, mute: false, deaf: false }

            postToFoundry({
                evt,
                ts: Date.now(),
                data: {
                    raw: data,
                    user_id: userId,
                    name: meta?.name ?? null,
                    nick: meta?.nick ?? domMeta.nick,
                    avatarUrl: meta?.avatarUrl ?? domMeta.avatarUrl,
                    mute: meta?.mute ?? domMeta.mute,
                    deaf: meta?.deaf ?? domMeta.deaf,
                },
            })
            return
        }

        // События "Начал говорить / Закончил говорить"
        if (SPEAK_EVTS.has(evt)) {
            const userId = data?.user_id
            if (!userId) return

            const cached = getCachedProfile(userId)
            const domMeta = cached ? { nick: null, avatarUrl: null, mute: false, deaf: false } : safeMetaFromDom(userId)

            postToFoundry({
                evt,
                ts: Date.now(),
                data: {
                    raw: data,
                    user_id: userId,
                    name: cached?.name ?? null,
                    nick: cached?.nick ?? domMeta.nick,
                    avatarUrl: cached?.avatarUrl ?? domMeta.avatarUrl,
                    mute: cached?.mute ?? domMeta.mute,
                    deaf: cached?.deaf ?? domMeta.deaf,
                },
            })
        }
    }

    window.console.log = (...args) => handleConsole('log', args)
    window.console.info = (...args) => handleConsole('info', args)
    window.console.debug = (...args) => handleConsole('debug', args)

    orig.log("[vnd relay] loaded", window.location.href)
})()
