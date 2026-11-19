// Speichert den Lernfortschritt pro Name: immer lokal (localStorage),
// zusätzlich in Firestore, wenn sync-config.js ausgefüllt ist.
(function () {
  const cfg = window.SYNC_CONFIG || {};
  const remoteOn = !!(cfg.projectId && cfg.apiKey);
  const LS_USERS = "pq.users";
  const LS_CURRENT = "pq.current";
  const lsKey = (key) => "pq.progress." + key;

  let user = null; // { key, name }
  let data = null; // { name, topics: {topicId: {qid: entry}}, resets: {topicId: ms} }
  let pushTimer = null;
  let listeners = [];
  let status = remoteOn ? "idle" : "local";

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function normalize(name) { return name.trim().replace(/\s+/g, " ").toLowerCase(); }
  function empty(name) { return { name, topics: {}, resets: {} }; }

  function setStatus(s) { status = s; listeners.forEach((f) => f(s)); }

  function merge(a, b) {
    const out = empty(a.name || b.name);
    const topics = new Set([...Object.keys(a.topics || {}), ...Object.keys(b.topics || {})]);
    for (const t of new Set([...Object.keys(a.resets || {}), ...Object.keys(b.resets || {})])) {
      out.resets[t] = Math.max((a.resets || {})[t] || 0, (b.resets || {})[t] || 0);
    }
    for (const t of topics) {
      const ea = (a.topics || {})[t] || {}, eb = (b.topics || {})[t] || {};
      const reset = out.resets[t] || 0;
      const m = {};
      for (const q of new Set([...Object.keys(ea), ...Object.keys(eb)])) {
        const x = ea[q], y = eb[q];
        const pick = !x ? y : !y ? x : (x.t >= y.t ? x : y);
        if (pick && pick.t > reset) m[q] = pick;
      }
      out.topics[t] = m;
    }
    return out;
  }

  // ---------- Firestore (REST, ohne SDK) ----------
  function docUrl(key) {
    return "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(cfg.projectId) +
      "/databases/(default)/documents/progress/" + encodeURIComponent("u_" + key.replace(/\//g, "_")) +
      "?key=" + encodeURIComponent(cfg.apiKey);
  }
  async function pull(key) {
    const r = await fetch(docUrl(key));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    const doc = await r.json();
    const s = doc.fields && doc.fields.data && doc.fields.data.stringValue;
    return s ? JSON.parse(s) : null;
  }
  async function push(key, d) {
    const r = await fetch(docUrl(key), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { data: { stringValue: JSON.stringify(d) }, updated: { timestampValue: new Date().toISOString() } } }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
  }

  async function sync() {
    if (!remoteOn || !user) return;
    const key = user.key;
    setStatus("syncing");
    try {
      const remote = await pull(key);
      if (!user || user.key !== key) return;
      if (remote) data = merge(data, remote);
      saveLocal();
      await push(key, data);
      setStatus("ok");
    } catch (e) {
      console.warn("Sync fehlgeschlagen", e);
      setStatus("error");
    }
  }
  function schedulePush() {
    if (!remoteOn) return;
    clearTimeout(pushTimer);
    setStatus("pending");
    pushTimer = setTimeout(sync, 1200);
  }

  function saveLocal() { if (user) safeSet(lsKey(user.key), JSON.stringify(data)); }

  function knownUsers() {
    try { return JSON.parse(safeGet(LS_USERS) || "[]"); } catch (e) { return []; }
  }

  const Store = {
    remoteOn,
    get status() { return status; },
    onStatus(f) { listeners.push(f); },
    knownUsers,
    currentUser() { return user; },
    lastUser() { return safeGet(LS_CURRENT); },

    async login(name) {
      const key = normalize(name);
      if (!key) throw new Error("Bitte einen Namen eingeben.");
      user = { key, name: name.trim() };
      let local = null;
      try { local = JSON.parse(safeGet(lsKey(key)) || "null"); } catch (e) {}
      data = local || empty(user.name);
      const users = knownUsers().filter((u) => u.key !== key);
      users.unshift({ key, name: user.name });
      safeSet(LS_USERS, JSON.stringify(users.slice(0, 10)));
      safeSet(LS_CURRENT, user.name);
      saveLocal();
      await sync();
    },
    logout() {
      clearTimeout(pushTimer);
      if (remoteOn && user && status === "pending") sync();
      user = null; data = null;
      try { localStorage.removeItem(LS_CURRENT); } catch (e) {}
    },
    forget(key) {
      safeSet(LS_USERS, JSON.stringify(knownUsers().filter((u) => u.key !== key)));
      try { localStorage.removeItem(lsKey(key)); } catch (e) {}
    },
    sync,
    topic(topicId) { return (data && data.topics[topicId]) || {}; },
    record(topicId, qid, ok) {
      const t = data.topics[topicId] || (data.topics[topicId] = {});
      const prev = t[qid] || { tries: 0, right: 0 };
      t[qid] = { ok, tries: prev.tries + 1, right: prev.right + (ok ? 1 : 0), t: Date.now() };
      saveLocal();
      schedulePush();
    },
    reset(topicId) {
      data.resets[topicId] = Date.now();
      data.topics[topicId] = {};
      saveLocal();
      schedulePush();
    },
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sync().then(() => Store.onRefresh && Store.onRefresh());
    else if (status === "pending") { clearTimeout(pushTimer); sync(); }
  });

  window.Store = Store;
})();
