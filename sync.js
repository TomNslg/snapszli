/* Snapszli — optional Firebase Realtime Database sync (one JSON blob per room). */
(() => {
  const ROOM_KEY = "snapszli-sync-room";
  const config = window.SNAPSZLI_SYNC_CONFIG || { enabled: false };

  let rtdb = null;
  let roomId = null;
  let onRemoteUpdate = null;
  let suppressEcho = false;

  function roomFromUrl() {
    try {
      return new URLSearchParams(location.search).get("room")?.trim() || null;
    } catch {
      return null;
    }
  }

  function contentTs(payload) {
    return payload?.settings?.contentUpdatedAt || payload?.exportedAt || "";
  }

  function init(onUpdate) {
    onRemoteUpdate = onUpdate;
    if (!config.enabled || !config.firebase?.databaseURL) return false;
    if (typeof firebase === "undefined") return false;

    roomId = roomFromUrl() || localStorage.getItem(ROOM_KEY);
    if (!roomId) return false;
    localStorage.setItem(ROOM_KEY, roomId);

    if (!firebase.apps.length) firebase.initializeApp(config.firebase);
    rtdb = firebase.database().ref(`rooms/${roomId}`);

    rtdb.on("value", (snap) => {
      const remote = snap.val();
      if (!remote || suppressEcho || !onRemoteUpdate) return;
      onRemoteUpdate(remote);
    });
    return true;
  }

  async function push(payload) {
    if (!rtdb || !payload) return;
    suppressEcho = true;
    try {
      await rtdb.set(payload);
    } finally {
      setTimeout(() => {
        suppressEcho = false;
      }, 200);
    }
  }

  async function pullOnce() {
    if (!rtdb) return null;
    const snap = await rtdb.get();
    return snap.val() || null;
  }

  function isEnabled() {
    return !!rtdb;
  }

  function getRoomId() {
    return roomId;
  }

  window.SnapszliSync = { init, push, pullOnce, isEnabled, getRoomId, contentTs };
})();
