import { HB_INTERVAL_MS } from "../const.js";
import { getActiveUserIds } from "../utils.js";

export class StatusCheck {
  constructor(state, voiceActivityRelay) {
    this._state = state;
    this._relay = voiceActivityRelay;
  }

  startHeartbeatBroadcast() {
    if (!game.user.isGM || this._state.hbIntervalId) return;

    this._state.hbIntervalId = setInterval(() => {
      const ids        = getActiveUserIds();
      const nextStatus = { ...this._state.usersStatus };

      for (const userId of ids) {
        nextStatus[userId] = this._relay.getOverlayFreshness(userId);
      }

      const changes = this._relay.diffStatus(this._state.usersStatus, nextStatus);
      this._state.usersStatus = nextStatus;

      this._relay.emitSocket("DV_HB_REQUEST", {
        usersStatus: this._state.usersStatus,
        changes,
        hasChanges: Object.keys(changes).length > 0,
      });
    }, HB_INTERVAL_MS);
  }

  stopHeartbeatBroadcast() {
    if (!this._state.hbIntervalId) return;
    clearInterval(this._state.hbIntervalId);
    this._state.hbIntervalId = null;
  }
}
