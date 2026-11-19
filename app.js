(function () {
  const $app = document.getElementById("app");
  const LETTERS = ["A", "B", "C", "D", "E", "F"];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pref = {
    get(k, d) { try { const v = localStorage.getItem("pq.pref." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("pq.pref." + k, JSON.stringify(v)); } catch (e) {} },
  };

  let topics = [];
  let topic = null; // geladene Themen-Datei
  let run = null; // { ids, i, results: {qid: ok}, checked, selected:Set }
  let view = "login";

  // ---------- Kopfzeile & Sync-Anzeige ----------
  const SYNC_TEXT = {
    local: ["", "Fortschritt wird nur in diesem Browser gespeichert"],
    idle: ["", ""],
    syncing: ["⟳", "Synchronisiere …"],
    pending: ["●", "Änderungen werden gleich gespeichert"],
    ok: ["✓", "Mit allen Geräten synchronisiert"],
    error: ["⚠", "Sync gerade nicht möglich – lokal gespeichert, wird später nachgeholt"],
  };
  function paintSync(s) {
    const el = document.getElementById("syncState");
    const [icon, text] = SYNC_TEXT[s] || ["", ""];
    el.textContent = icon; el.title = text; el.className = "sync sync-" + s;
  }
  Store.onStatus(paintSync);
  function paintHeader() {
    const u = Store.currentUser();
    document.getElementById("userBox").hidden = !u;
    if (u) document.getElementById("userName").textContent = u.name;
    paintSync(Store.status);
  }
  document.getElementById("logoutBtn").onclick = () => { Store.logout(); run = null; showLogin(); };
  document.getElementById("brand").onclick = () => { if (Store.currentUser() && view === "quiz" && run && !confirm("Quiz verlassen? Bereits beantwortete Fragen bleiben gespeichert.")) return; if (Store.currentUser()) showHome(); };
  Store.onRefresh = () => { if (view === "home") showHome(); };

  // ---------- Daten laden ----------
  async function loadTopics() {
    const r = await fetch("themen/index.json", { cache: "no-cache" });
    topics = await r.json();
  }
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function decrypt(enc, pw) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  class PwError extends Error {}
  async function fetchTopic(t, pw) {
    const r = await fetch(t.file, { cache: "no-cache" });
    const data = await r.json();
    if (!data.ct) return data;
    if (!pw) throw new PwError();
    try { return await decrypt(data, pw); } catch (e) { throw new PwError(); }
  }
  async function loadTopic(id) {
    const t = topics.find((x) => x.id === id) || topics[0];
    if (topic && topic.id === t.id) return;
    topic = await fetchTopic(t, pref.get("pw", ""));
    pref.set("topic", topic.id);
  }

  // ---------- App-Passwort ----------
  function showPassword(err) {
    view = "pw"; paintHeader();
    $app.innerHTML = `
      <section class="card narrow">
        <h1>🔒 Geschützter Bereich</h1>
        <p class="muted">Dieses Quiz ist nur für unsere Lerngruppe. Bitte gib das App-Passwort ein. Es wird auf diesem Gerät gespeichert.</p>
        <form id="pwForm" class="row">
          <input id="pwInput" type="password" autocomplete="current-password" placeholder="App-Passwort" required>
          <button class="btn primary">Entsperren</button>
        </form>
        ${err ? `<p class="error">${esc(err)}</p>` : ""}
      </section>`;
    const input = $app.querySelector("#pwInput");
    input.focus();
    $app.querySelector("#pwForm").onsubmit = async (e) => {
      e.preventDefault();
      $app.querySelector(".card").classList.add("busy");
      try {
        topic = await fetchTopic(topics.find((x) => x.id === pref.get("topic", topics[0].id)) || topics[0], input.value);
        pref.set("pw", input.value);
        start();
      } catch (e) { showPassword(e instanceof PwError ? "Das Passwort stimmt nicht." : "Fragen konnten nicht geladen werden."); }
    };
  }

  // ---------- Anmeldung ----------
  function showLogin(err) {
    view = "login"; paintHeader();
    const users = Store.knownUsers();
    $app.innerHTML = `
      <section class="card narrow">
        <h1>Willkommen!</h1>
        <p class="muted">Melde dich mit deinem Namen an. Ein Passwort gibt es nicht.
        ${Store.remoteOn ? "Mit demselben Namen siehst du deinen Fortschritt auf jedem Gerät." : "Dein Fortschritt wird in diesem Browser gespeichert."}</p>
        ${users.length ? `<div class="known">${users.map((u) => `<span class="chip"><button class="chip-main" data-name="${esc(u.name)}">${esc(u.name)}</button><button class="chip-x" data-forget="${esc(u.key)}" title="Von diesem Gerät entfernen" aria-label="${esc(u.name)} entfernen">×</button></span>`).join("")}</div><p class="muted small">oder neuer Name:</p>` : ""}
        <form id="loginForm" class="row">
          <input id="nameInput" autocomplete="nickname" placeholder="Dein Name" maxlength="40" required>
          <button class="btn primary">Los geht's</button>
        </form>
        ${err ? `<p class="error">${esc(err)}</p>` : ""}
      </section>`;
    const go = async (name) => {
      $app.querySelector(".card").classList.add("busy");
      try { await Store.login(name); await showHome(); }
      catch (e) { showLogin(e.message); }
    };
    $app.querySelector("#loginForm").onsubmit = (e) => { e.preventDefault(); go($app.querySelector("#nameInput").value); };
    $app.querySelectorAll("[data-name]").forEach((b) => (b.onclick = () => go(b.dataset.name)));
    $app.querySelectorAll("[data-forget]").forEach((b) => (b.onclick = () => { Store.forget(b.dataset.forget); showLogin(); }));
    if (!users.length) $app.querySelector("#nameInput").focus();
  }

  // ---------- Übersicht ----------
  function stats(qs) {
    const p = Store.topic(topic.id);
    let done = 0, ok = 0;
    for (const q of qs) { const e = p[q.id]; if (e) { done++; if (e.ok) ok++; } }
    return { total: qs.length, done, ok, wrong: done - ok };
  }
  function bar(s) {
    const w = (n) => (s.total ? (n / s.total) * 100 : 0).toFixed(1) + "%";
    return `<div class="bar" title="${s.ok} richtig, ${s.wrong} falsch, ${s.total - s.done} offen"><span class="ok" style="width:${w(s.ok)}"></span><span class="bad" style="width:${w(s.wrong)}"></span></div>`;
  }
  async function showHome() {
    view = "home"; paintHeader();
    await loadTopic(pref.get("topic", topics[0].id));
    const opts = Object.assign({ level: "alle", filter: "alle", order: "reihe" }, pref.get("opts", {}));
    const all = stats(topic.questions);
    const lv = topic.levels.map((l) => ({ ...l, s: stats(topic.questions.filter((q) => q.level === l.id)) }));
    const radio = (name, val, label, cur) => `<label class="seg"><input type="radio" name="${name}" value="${val}" ${cur === val ? "checked" : ""}><span>${label}</span></label>`;
    $app.innerHTML = `
      <section class="card">
        ${topics.length > 1 ? `<label class="small muted">Thema</label><select id="topicSel">${topics.map((t) => `<option value="${esc(t.id)}" ${t.id === topic.id ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</select>` : ""}
        <h1>${esc(topic.title)}</h1>
        ${topic.source ? `<p class="muted small">${esc(topic.source)}</p>` : ""}
        <div class="overall">
          <div class="big">${all.ok}<span>/${all.total}</span></div>
          <div class="grow">
            <div class="muted small">richtig beantwortet · ${all.wrong} falsch · ${all.total - all.done} offen</div>
            ${bar(all)}
          </div>
        </div>
        <div class="levels">
          ${lv.map((l) => `<div class="lvl"><div class="lvl-head"><b>${esc(l.label)}</b><span class="muted small">${l.s.ok}/${l.s.total}</span></div>${bar(l.s)}</div>`).join("")}
        </div>
      </section>
      <section class="card">
        <h2>Neue Runde</h2>
        <form id="startForm">
          <div class="field"><div class="label">Schwierigkeit</div><div class="segs">
            ${radio("level", "alle", "Alle", opts.level)}${topic.levels.map((l) => radio("level", l.id, esc(l.label), opts.level)).join("")}
          </div></div>
          <div class="field"><div class="label">Fragen</div><div class="segs">
            ${radio("filter", "alle", "Alle", opts.filter)}${radio("filter", "offen", "Noch offen", opts.filter)}${radio("filter", "falsch", "Zuletzt falsch", opts.filter)}${radio("filter", "nichtrichtig", "Offen + falsch", opts.filter)}
          </div></div>
          <div class="field"><div class="label">Reihenfolge</div><div class="segs">
            ${radio("order", "reihe", "Der Reihe nach", opts.order)}${radio("order", "mix", "Gemischt", opts.order)}
          </div></div>
          <p class="muted small" id="countInfo"></p>
          <button class="btn primary wide" id="startBtn">Starten</button>
        </form>
      </section>
      <p class="center"><button class="link danger" id="resetBtn">Fortschritt für dieses Thema zurücksetzen</button></p>`;

    const form = $app.querySelector("#startForm");
    const read = () => Object.fromEntries(new FormData(form).entries());
    const pick = (o) => {
      const p = Store.topic(topic.id);
      return topic.questions.filter((q) => {
        if (o.level !== "alle" && q.level !== o.level) return false;
        const e = p[q.id];
        if (o.filter === "offen") return !e;
        if (o.filter === "falsch") return e && !e.ok;
        if (o.filter === "nichtrichtig") return !e || !e.ok;
        return true;
      }).map((q) => q.id);
    };
    const upd = () => {
      const n = pick(read()).length;
      $app.querySelector("#countInfo").textContent = n ? `${n} Fragen in dieser Runde` : "Keine Fragen für diese Auswahl.";
      $app.querySelector("#startBtn").disabled = !n;
    };
    form.onchange = () => { pref.set("opts", read()); upd(); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const o = read(); let ids = pick(o);
      if (o.order === "mix") ids = shuffle(ids);
      run = { ids, i: 0, results: {}, checked: false, selected: new Set() };
      showQuestion();
    };
    upd();
    const sel = $app.querySelector("#topicSel");
    if (sel) sel.onchange = async () => { try { await loadTopic(sel.value); showHome(); } catch (e) { if (e instanceof PwError) showPassword("Für dieses Thema gilt ein anderes Passwort."); } };
    $app.querySelector("#resetBtn").onclick = () => {
      if (confirm(`Gesamten Fortschritt für „${topic.title}“ löschen?${Store.remoteOn ? " Das gilt für alle Geräte." : ""}`)) { Store.reset(topic.id); showHome(); }
    };
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ---------- Frage ----------
  function showQuestion() {
    view = "quiz"; paintHeader();
    if (run.i >= run.ids.length) return showDone();
    const q = topic.questions.find((x) => x.id === run.ids[run.i]);
    const lvl = topic.levels.find((l) => l.id === q.level);
    const correct = new Set(q.correct);
    const prev = Store.topic(topic.id)[q.id];
    const order = shuffle(q.options.map((_, i) => i)); // Antworten bei jedem Aufruf neu mischen
    $app.innerHTML = `
      <div class="qtop">
        <button class="link" id="quitBtn">← Übersicht</button>
        <span class="muted small">Frage ${run.i + 1} von ${run.ids.length}</span>
      </div>
      <div class="bar thin"><span class="ok" style="width:${((run.i) / run.ids.length) * 100}%"></span></div>
      <section class="card question">
        <div class="qmeta">
          <span class="badge lvl-${esc(q.level)}">${esc(lvl ? lvl.label : q.level)}</span>
          <span class="muted small">Nr. ${q.id}${prev ? ` · zuletzt ${prev.ok ? "richtig" : "falsch"}` : ""}</span>
        </div>
        <h2 class="qtext">${esc(q.question)}</h2>
        ${q.formula ? `<div class="formula">${q.formula.split(" • ").map(esc).join("<br>")}</div>` : ""}
        <p class="muted small">Alle richtigen Antworten auswählen (eine oder mehrere).</p>
        <div class="options">
          ${order.map((i, pos) => `
            <label class="opt" data-i="${i}">
              <input type="checkbox" value="${i}">
              <span class="letter">${LETTERS[pos]}</span>
              <span class="otext">${esc(q.options[i])}</span>
              <span class="mark"></span>
            </label>`).join("")}
        </div>
        <div id="feedback"></div>
        <div class="actions"><button class="btn primary wide" id="actBtn">Prüfen</button></div>
      </section>`;
    run.checked = false; run.selected = new Set();
    const boxes = [...$app.querySelectorAll(".opt input")];
    const btn = $app.querySelector("#actBtn");
    const refreshBtn = () => { if (!run.checked) btn.disabled = run.selected.size === 0; };
    boxes.forEach((b) => (b.onchange = () => {
      if (run.checked) { b.checked = !b.checked; return; }
      b.checked ? run.selected.add(+b.value) : run.selected.delete(+b.value);
      b.closest(".opt").classList.toggle("sel", b.checked); refreshBtn();
    }));
    refreshBtn();

    const check = () => {
      if (!run.selected.size) return;
      run.checked = true;
      const ok = q.correct.length === run.selected.size && q.correct.every((c) => run.selected.has(c));
      run.results[q.id] = ok;
      Store.record(topic.id, q.id, ok);
      $app.querySelectorAll(".opt").forEach((el) => {
        const i = +el.dataset.i, isC = correct.has(i), isS = run.selected.has(i);
        el.classList.add("done", isC ? "is-correct" : "is-wrong");
        if (isS) el.classList.add("sel");
        el.querySelector(".mark").textContent = isC ? (isS ? "✓" : "✓ fehlte") : (isS ? "✗" : "");
        el.querySelector("input").disabled = true;
      });
      $app.querySelector("#feedback").innerHTML = `
        <div class="fb ${ok ? "fb-ok" : "fb-bad"}">
          <b>${ok ? "Richtig!" : "Leider nicht ganz."}</b> Richtig: ${order.map((i, pos) => (correct.has(i) ? LETTERS[pos] : null)).filter(Boolean).join(", ")}
          <p>${esc(q.explanation)}</p>
          ${q.slides ? `<p class="small muted">📑 ${esc(q.slides)}</p>` : ""}
        </div>`;
      btn.textContent = run.i + 1 < run.ids.length ? "Weiter" : "Auswertung";
      btn.disabled = false; btn.focus();
    };
    btn.onclick = () => { if (!run.checked) check(); else { run.i++; showQuestion(); window.scrollTo(0, 0); } };
    $app.querySelector("#quitBtn").onclick = () => { run = null; showHome(); };
  }

  function showDone() {
    view = "done";
    const vals = Object.values(run.results);
    const ok = vals.filter(Boolean).length;
    const wrongIds = Object.keys(run.results).filter((k) => !run.results[k]).map(Number);
    $app.innerHTML = `
      <section class="card narrow center">
        <h1>${vals.length ? (ok / vals.length >= 0.8 ? "Stark! 🎉" : ok / vals.length >= 0.5 ? "Gut dabei! 💪" : "Dranbleiben! 📚") : "Runde beendet"}</h1>
        <div class="big">${ok}<span>/${vals.length}</span></div>
        <p class="muted">richtig in dieser Runde</p>
        <div class="col">
          ${wrongIds.length ? `<button class="btn primary wide" id="againBtn">Die ${wrongIds.length} falschen nochmal</button>` : ""}
          <button class="btn wide" id="homeBtn">Zur Übersicht</button>
        </div>
      </section>`;
    const again = $app.querySelector("#againBtn");
    if (again) again.onclick = () => { run = { ids: shuffle(wrongIds), i: 0, results: {}, checked: false, selected: new Set() }; showQuestion(); };
    $app.querySelector("#homeBtn").onclick = () => { run = null; showHome(); };
  }

  // ---------- Tastatur ----------
  document.addEventListener("keydown", (e) => {
    if (view !== "quiz" || e.target.tagName === "INPUT" && e.target.type !== "checkbox") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const idx = "abcd".indexOf(k) >= 0 ? "abcd".indexOf(k) : "1234".indexOf(k);
    if (idx >= 0) {
      const b = $app.querySelectorAll(".opt input")[idx];
      if (b && !run.checked) { b.checked = !b.checked; b.dispatchEvent(new Event("change")); }
    } else if (e.key === "Enter") {
      e.preventDefault(); const btn = $app.querySelector("#actBtn"); if (btn && !btn.disabled) btn.click();
    }
  });

  // ---------- Start ----------
  (async function init() {
    try { await loadTopics(); await loadTopic(pref.get("topic", topics[0].id)); }
    catch (e) {
      if (e instanceof PwError) return showPassword(pref.get("pw", "") ? "Das gespeicherte Passwort gilt nicht mehr. Bitte neu eingeben." : "");
      $app.innerHTML = `<section class="card"><p class="error">Fragen konnten nicht geladen werden.</p></section>`; return;
    }
    start();
  })();
  async function start() {
    const last = Store.lastUser();
    if (last) { try { await Store.login(last); return showHome(); } catch (e) {} }
    showLogin();
  }
})();
