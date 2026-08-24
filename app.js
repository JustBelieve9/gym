/* Логика: выбор человека и темы, рендер дня, отметка подходов, рабочие веса,
   прогресс, таймер отдыха со звуком, отчёт в телеграм, wake lock.
   Программы живут в data.js. */
(function () {
  "use strict";

  var PREFIX = "gym-";
  var REPORT_URL = "https://gym-report.thezavarkin.workers.dev";
  var THEME_COLOR = { dark: "#0B1120", light: "#EEF1F6" };

  var el = {
    people:      document.querySelectorAll(".person"),
    themeBtn:    document.getElementById("themeBtn"),
    soundBtn:    document.getElementById("soundBtn"),
    themeColor:  document.getElementById("themeColor"),
    tabs:        document.querySelectorAll(".tab"),
    panelDay:    document.getElementById("panel-day"),
    panelHelp:   document.getElementById("panel-help"),
    helpBlocks:  document.querySelectorAll(".help-block"),
    tgLinks:     document.querySelectorAll(".tg-link"),
    list:        document.getElementById("exList"),
    subtitle:    document.getElementById("daySubtitle"),
    doneCount:   document.getElementById("doneCount"),
    totalCount:  document.getElementById("totalCount"),
    fill:        document.getElementById("progressFill"),
    progress:    document.getElementById("progressBlock"),
    dayActions:  document.getElementById("dayActions"),
    sendReport:  document.getElementById("sendReport"),
    resetDay:    document.getElementById("resetDay"),
    toast:       document.getElementById("toast"),
    timer:       document.getElementById("timer"),
    timerTime:   document.getElementById("timerTime"),
    timerLabel:  document.getElementById("timerLabel"),
    timerLine:   document.getElementById("timerLine"),
    timerAdd:    document.getElementById("timerAdd"),
    timerRestart:document.getElementById("timerRestart"),
    timerSkip:   document.getElementById("timerSkip")
  };

  var state = { person: DEFAULT_PERSON, day: null, done: [], weights: [], startedAt: 0, sent: false };
  var timer = { endAt: 0, total: 0, last: 0, int: null, running: false, nodes: null, scheduled: false };

  function store(k, v) { try { localStorage.setItem(PREFIX + k, v); } catch (e) {} }
  function recall(k)   { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } }
  function program()   { return PEOPLE[state.person].program; }
  function pad(n)      { return n < 10 ? "0" + n : String(n); }
  function esc(s)      { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  /* ───────── Тема ───────── */

  function applyTheme(theme) {
    var root = document.documentElement;
    root.classList.add("theme-switching");
    void root.offsetWidth;               // форсируем пересчёт, чтобы глушилка успела примениться
    root.setAttribute("data-theme", theme);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { root.classList.remove("theme-switching"); });
    });
    if (el.themeColor) el.themeColor.setAttribute("content", THEME_COLOR[theme]);
    el.themeBtn.setAttribute("aria-label", theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему");
    store("theme", theme);
  }

  el.themeBtn.addEventListener("click", function () {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  /* ───────── Звук ─────────
     iOS усыпляет Web Audio, как только экран гаснет или браузер уходит в фон.
     Поэтому три слоя: беззвучный медиа-луп держит аудиосессию живой, тон
     планируется в аудиографе заранее (переживает торможение главного потока),
     Media Session помечает страницу как играющую медиа. */

  var audioCtx = null, keepAliveEl = null, silentUrl = null;

  function soundOn() { return recall("sound") !== "off"; }

  function applySound(on) {
    store("sound", on ? "on" : "off");
    document.documentElement.setAttribute("data-sound", on ? "on" : "off");
    el.soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    el.soundBtn.setAttribute("aria-label", on ? "Выключить звук" : "Включить звук");
    if (!on) { cancelChime(); stopKeepAlive(); }
  }

  el.soundBtn.addEventListener("click", function () { applySound(!soundOn()); });

  function ctx() {
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      audioCtx = audioCtx || new C();
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }

  /* Почти-тишина, а не чистые нули: нулевой поток iOS может выбросить как пустой */
  function silentWav(seconds, rate) {
    var n = Math.floor(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function s(off, str) { for (var i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
    s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE");
    s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, "data"); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }

  function startKeepAlive() {
    if (!soundOn()) return;
    if (!keepAliveEl) {
      silentUrl = silentUrl || silentWav(0.5, 8000);
      keepAliveEl = document.createElement("audio");
      keepAliveEl.src = silentUrl;
      keepAliveEl.loop = true;
      keepAliveEl.setAttribute("playsinline", "");
      keepAliveEl.volume = 0.02;
      document.body.appendChild(keepAliveEl);
    }
    var p = keepAliveEl.play();
    if (p && p.catch) p.catch(function () {});
  }

  function stopKeepAlive() { if (keepAliveEl) { try { keepAliveEl.pause(); } catch (e) {} } }

  /* Два коротких тона, E6 -> B6. Свой синтез, не копия чужого сигнала. */
  function chime(at) {
    var c = ctx();
    if (!c) return null;
    var t0 = at != null ? at : c.currentTime + 0.02, nodes = [];
    [[1319, 0], [1976, 0.07]].forEach(function (n) {
      var o = c.createOscillator(), g = c.createGain(), t = t0 + n[1];
      o.type = "triangle";
      o.frequency.setValueAtTime(n[0], t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 0.18);
      nodes.push(o);
    });
    return nodes;
  }

  function cancelChime() {
    if (!timer.nodes) return;
    timer.nodes.forEach(function (o) { try { o.stop(0); o.disconnect(); } catch (e) {} });
    timer.nodes = null;
    timer.scheduled = false;
  }

  function mediaSession(on, label) {
    if (!("mediaSession" in navigator)) return;
    try {
      if (on) {
        if (window.MediaMetadata) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: "Отдых · " + label,
            artist: PEOPLE[state.person].label,
            album: "Тренировка"
          });
        }
        navigator.mediaSession.playbackState = "playing";
      } else {
        navigator.mediaSession.playbackState = "none";
      }
    } catch (e) {}
  }

  function vibrate(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } }

  /* ───────── Хранилище ───────── */

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function key(day) { return state.person + "-" + day; }   // у каждого свои отметки

  function fresh(day) {
    return program()[day].exercises.map(function (ex) { return new Array(ex.sets).fill(false); });
  }
  function freshWeights(day) { return program()[day].exercises.map(function () { return null; }); }

  function load(day) {
    var blank = { sets: fresh(day), weights: freshWeights(day), startedAt: 0, sent: false };
    var raw = recall(key(day));
    if (!raw) return blank;
    try {
      var saved = JSON.parse(raw);
      if (!saved || saved.date !== today()) return blank;   // новый день — отметки не актуальны
      var shape = blank.sets;
      if (!Array.isArray(saved.sets) || saved.sets.length !== shape.length) return blank;
      for (var i = 0; i < shape.length; i++) {
        if (!Array.isArray(saved.sets[i]) || saved.sets[i].length !== shape[i].length) return blank;
      }
      return {
        sets: saved.sets,
        // записи до появления весов их не содержат — дополняем, а не считаем битыми
        weights: Array.isArray(saved.weights) && saved.weights.length === shape.length
          ? saved.weights : freshWeights(day),
        startedAt: saved.startedAt || 0,
        sent: Boolean(saved.sent)
      };
    } catch (e) { return blank; }
  }

  function save() {
    store(key(state.day), JSON.stringify({
      date: today(), sets: state.done, weights: state.weights,
      startedAt: state.startedAt, sent: state.sent
    }));
  }

  /* Последние веса — по НАЗВАНИЮ упражнения, не по номеру: перестановка
     программы в data.js не должна путать веса между упражнениями. */
  function lastWeights() {
    try { return JSON.parse(recall(state.person + "-lastw") || "{}"); } catch (e) { return {}; }
  }
  function rememberWeight(name, val) {
    var m = lastWeights();
    if (val == null) delete m[name]; else m[name] = val;
    store(state.person + "-lastw", JSON.stringify(m));
  }

  (function migrateLegacyKeys() {
    DAY_ORDER.forEach(function (day) {
      var legacy = recall(day);
      if (legacy === null) return;
      if (recall(DEFAULT_PERSON + "-" + day) === null) store(DEFAULT_PERSON + "-" + day, legacy);
      try { localStorage.removeItem(PREFIX + day); } catch (e) {}
    });
  })();

  /* ───────── Рендер ───────── */

  function icon(id) { return '<svg aria-hidden="true"><use href="#' + id + '"></use></svg>'; }

  function restLabel(sec) {
    if (!sec) return "без отдыха";
    if (sec < 60) return "отдых " + sec + " с";
    var m = Math.floor(sec / 60), s = sec % 60;
    return "отдых " + m + (s ? ":" + pad(s) : " мин");
  }

  function fmtWeight(n) { return String(n).replace(".", ","); }

  function exerciseNode(ex, idx) {
    var art = document.createElement("article");
    art.className = "ex";
    art.dataset.ex = idx;

    var sets = "";
    for (var i = 0; i < ex.sets; i++) {
      sets += '<button type="button" class="set" data-set="' + i + '"' +
              ' aria-pressed="false" aria-label="Подход ' + (i + 1) + ' из ' + ex.sets + '">' +
              '<span class="set__n">' + (i + 1) + "</span>" + icon("i-check") + "</button>";
    }

    art.innerHTML =
      '<div class="ex__head">' +
        '<span class="ex__num">' + (idx + 1) + "</span>" +
        '<h3 class="ex__name">' + ex.name + "</h3>" +
      "</div>" +
      '<div class="ex__row">' +
        '<span class="ex__scheme">' + ex.sets + " × " + ex.reps + "</span>" +
        '<div class="sets" role="group" aria-label="Подходы: ' + ex.name + '">' + sets + "</div>" +
      "</div>" +
      '<div class="ex__foot">' +
        '<span class="ex__rest">' + restLabel(ex.rest) + "</span>" +
        '<span class="wslot" data-w="' + idx + '"></span>' +
      "</div>";

    return art;
  }

  function renderWeight(idx) {
    var slot = el.list.querySelector('.wslot[data-w="' + idx + '"]');
    if (!slot) return;
    var ex = program()[state.day].exercises[idx];
    var own = state.weights[idx];
    var hint = lastWeights()[ex.name];
    var label = "Рабочий вес: " + ex.name;

    if (own != null) {
      slot.innerHTML = '<button type="button" class="weight" aria-label="' + label + '">' +
        "<b>" + fmtWeight(own) + "</b> кг</button>";
    } else if (hint != null) {
      slot.innerHTML = '<button type="button" class="weight weight--hint" aria-label="' + label +
        ', в прошлый раз ' + fmtWeight(hint) + '"><b>' + fmtWeight(hint) + "</b> кг</button>";
    } else {
      slot.innerHTML = '<button type="button" class="weight weight--empty" aria-label="' + label +
        '">+ вес</button>';
    }
  }

  function openWeightEditor(idx) {
    var slot = el.list.querySelector('.wslot[data-w="' + idx + '"]');
    if (!slot) return;
    var ex = program()[state.day].exercises[idx];
    var start = state.weights[idx] != null ? state.weights[idx] : lastWeights()[ex.name];

    slot.innerHTML = '<input class="winput" type="text" inputmode="decimal" enterkeyhint="done"' +
      ' aria-label="Рабочий вес: ' + ex.name + '" value="' + (start != null ? fmtWeight(start) : "") +
      '"><span class="winput__unit">кг</span>';

    var input = slot.querySelector(".winput");
    input.focus();
    input.select();

    function commit() {
      input.removeEventListener("blur", commit);
      var raw = input.value.trim().replace(",", ".");
      var n = raw === "" ? null : parseFloat(raw);
      if (n != null && (!isFinite(n) || n < 0 || n > 999)) n = state.weights[idx];
      state.weights[idx] = n;
      rememberWeight(ex.name, n);
      save();
      renderWeight(idx);
    }
    function cancel() { input.removeEventListener("blur", commit); renderWeight(idx); }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }

  function renderDay(day) {
    state.day = day;
    var loaded = load(day);
    state.done = loaded.sets;
    state.weights = loaded.weights;
    state.startedAt = loaded.startedAt;
    state.sent = loaded.sent;

    var data = program()[day];
    el.subtitle.textContent = data.subtitle;
    el.list.innerHTML = "";

    var group = null, groupKey = null;
    data.exercises.forEach(function (ex, i) {
      var node = exerciseNode(ex, i);
      if (ex.superset) {
        if (!group || groupKey !== ex.superset) {
          group = document.createElement("div");
          group.className = "ss-group";
          groupKey = ex.superset;
          el.list.appendChild(group);
        }
        group.appendChild(node);
      } else {
        group = null; groupKey = null;
        el.list.appendChild(node);
      }
      renderWeight(i);
    });

    restoreMarks();
    updateProgress();
  }

  function restoreMarks() {
    state.done.forEach(function (arr, exIdx) {
      var art = el.list.querySelector('[data-ex="' + exIdx + '"]');
      if (!art) return;
      arr.forEach(function (on, setIdx) {
        var b = art.querySelector('[data-set="' + setIdx + '"]');
        if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      art.classList.toggle("is-done", arr.every(Boolean));
    });
  }

  function counts() {
    var done = 0, total = 0;
    state.done.forEach(function (arr) {
      total += arr.length;
      arr.forEach(function (v) { if (v) done++; });
    });
    return { done: done, total: total };
  }

  function updateProgress() {
    var c = counts();
    el.doneCount.textContent = c.done;
    el.totalCount.textContent = c.total;
    el.fill.style.width = c.total ? (c.done / c.total * 100) + "%" : "0%";
    el.fill.classList.toggle("is-complete", c.total > 0 && c.done === c.total);
    el.progress.setAttribute("aria-label", "Прогресс дня: " + c.done + " из " + c.total + " подходов");
    el.sendReport.disabled = c.done === 0;
  }

  /* ───────── Подходы и веса ───────── */

  el.list.addEventListener("click", function (e) {
    var w = e.target.closest(".weight");
    if (w) { openWeightEditor(Number(w.closest(".wslot").dataset.w)); return; }

    var btn = e.target.closest(".set");
    if (!btn) return;
    var art = btn.closest(".ex");
    var exIdx = Number(art.dataset.ex), setIdx = Number(btn.dataset.set);

    var on = !state.done[exIdx][setIdx];
    state.done[exIdx][setIdx] = on;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    art.classList.toggle("is-done", state.done[exIdx].every(Boolean));
    if (on && !state.startedAt) state.startedAt = Date.now();

    save();
    updateProgress();

    if (on) {
      vibrate(10);
      keepAwake();
      var rest = program()[state.day].exercises[exIdx].rest;
      if (rest > 0) startTimer(rest);
      var c = counts();
      if (c.done === c.total && !state.sent) sendReport(true);
    }
  });

  el.resetDay.addEventListener("click", function () {
    if (!confirm("Сбросить все отметки за " + program()[state.day].title.toLowerCase() + "?")) return;
    state.done = fresh(state.day);
    state.startedAt = 0;
    state.sent = false;
    save();
    restoreMarks();
    updateProgress();
  });

  /* ───────── Таймер отдыха ───────── */

  function fmt(sec) { return Math.floor(sec / 60) + ":" + pad(sec % 60); }

  function startTimer(sec) {
    cancelChime();
    timer.total = sec;
    timer.last = sec;
    timer.endAt = Date.now() + sec * 1000;
    timer.running = true;
    el.timer.classList.remove("is-done");
    el.timer.classList.add("is-open");
    el.timerLabel.textContent = "Отдых";

    if (soundOn()) {
      startKeepAlive();
      var c = ctx();
      if (c) { timer.nodes = chime(c.currentTime + sec); timer.scheduled = Boolean(timer.nodes); }
    }
    mediaSession(true, fmt(sec));

    tick();
    if (timer.int) clearInterval(timer.int);
    timer.int = setInterval(tick, 200);
  }

  function tick() {
    var leftMs = Math.max(0, timer.endAt - Date.now());
    el.timerTime.textContent = fmt(Math.ceil(leftMs / 1000));
    el.timerLine.style.width = timer.total ? (leftMs / 1000 / timer.total * 100) + "%" : "0%";
    if (leftMs <= 0) finishTimer();
  }

  function finishTimer() {
    clearInterval(timer.int);
    timer.int = null;
    timer.running = false;
    el.timer.classList.add("is-done");
    el.timerLabel.textContent = "Готово";
    el.timerTime.textContent = "0:00";
    el.timerLine.style.width = "100%";
    // если тон был запланирован заранее — он уже прозвучал сам, второй раз не нужен
    if (soundOn() && !timer.scheduled) chime();
    timer.nodes = null;
    timer.scheduled = false;
    vibrate([70, 80, 70]);
    mediaSession(false);
    setTimeout(function () { if (!timer.running) closeTimer(); }, 6000);
  }

  function closeTimer() {
    clearInterval(timer.int);
    timer.int = null;
    timer.running = false;
    cancelChime();
    stopKeepAlive();
    mediaSession(false);
    el.timer.classList.remove("is-open");
  }

  el.timerAdd.addEventListener("click", function () {
    if (!timer.running) { startTimer(30); return; }
    timer.endAt += 30000;
    timer.total += 30;
    cancelChime();
    if (soundOn()) {
      var c = ctx();
      if (c) {
        timer.nodes = chime(c.currentTime + Math.max(0, (timer.endAt - Date.now()) / 1000));
        timer.scheduled = Boolean(timer.nodes);
      }
    }
    tick();
  });
  el.timerRestart.addEventListener("click", function () { startTimer(timer.last || 90); });
  el.timerSkip.addEventListener("click", closeTimer);

  /* ───────── Отчёт в телеграм ───────── */

  function toast(msg, bad) {
    el.toast.textContent = msg;
    el.toast.classList.toggle("is-bad", Boolean(bad));
    el.toast.classList.add("is-on");
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.toast.classList.remove("is-on"); }, 4000);
  }

  function reportText() {
    var d = program()[state.day], c = counts(), lines = [];
    lines.push("🏋️ <b>" + esc(PEOPLE[state.person].label) + " · " + esc(d.title) + "</b>");
    lines.push(esc(d.subtitle));
    lines.push("");
    d.exercises.forEach(function (ex, i) {
      var arr = state.done[i], n = arr.filter(Boolean).length;
      var mark = n === arr.length ? "✅" : (n ? "🟡" : "⚪️");
      var w = state.weights[i];
      lines.push(mark + " " + esc(ex.name) +
        (w != null ? " · " + fmtWeight(w) + " кг" : "") + " · " + n + "/" + arr.length);
    });
    lines.push("");
    var tail = "<b>" + c.done + "/" + c.total + "</b> подходов";
    if (state.startedAt) {
      var mins = Math.round((Date.now() - state.startedAt) / 60000);
      if (mins > 0 && mins < 300) tail += " · " + mins + " мин";
    }
    lines.push(tail);
    return lines.join("\n");
  }

  var sending = false;

  function sendReport(auto) {
    if (sending) return;                       // защита от двойного тапа
    if (auto && state.sent) return;
    sending = true;
    // Помечаем СИНХРОННО, до запроса: иначе поправленная галочка успеет
    // запустить вторую автоотправку, пока летит первая, и придёт дубль.
    if (auto) { state.sent = true; save(); }

    var body = JSON.stringify({ person: state.person, text: reportText() });
    el.sendReport.disabled = true;

    fetch(REPORT_URL + "/report", {
      method: "POST", headers: { "content-type": "application/json" }, body: body
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.ok) {
          state.sent = true; save();
          toast(auto ? "Тренировка закрыта, отчёт отправлен" : "Отчёт отправлен");
        } else {
          if (auto) { state.sent = false; save(); }   // откат: пусть попробует ещё раз
          toast(res.j && res.j.error === "телеграм не подключён"
            ? "Телеграм не подключён — ссылка в «Справке»"
            : "Не удалось отправить отчёт", true);
        }
      })
      .catch(function () {
        if (auto) { state.sent = false; save(); }
        toast("Нет связи — отчёт не ушёл", true);
      })
      .then(function () { sending = false; updateProgress(); });
  }

  el.sendReport.addEventListener("click", function () { sendReport(false); });

  /* ───────── Экран не гаснет ───────── */

  var lock = null;
  function keepAwake() {
    if (!("wakeLock" in navigator) || lock) return;
    navigator.wakeLock.request("screen").then(function (l) {
      lock = l;
      l.addEventListener("release", function () { lock = null; });
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { keepAwake(); if (timer.running) tick(); }
  });

  /* ───────── Переключатель человека ───────── */

  function selectPerson(person) {
    if (!PEOPLE[person]) person = DEFAULT_PERSON;
    state.person = person;

    el.people.forEach(function (b) {
      var active = b.dataset.person === person;
      b.setAttribute("aria-checked", active ? "true" : "false");
      b.tabIndex = active ? 0 : -1;
    });
    el.helpBlocks.forEach(function (b) { b.hidden = b.dataset.person !== person; });
    el.tgLinks.forEach(function (a) { a.href = REPORT_URL + "/link?p=" + a.dataset.person; });

    store("person", person);
    if (state.day) renderDay(state.day);
  }

  el.people.forEach(function (b) {
    b.addEventListener("click", function () { selectPerson(b.dataset.person); });
    b.addEventListener("keydown", function (e) {
      var step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      var arr = Array.prototype.slice.call(el.people);
      var next = arr[(arr.indexOf(b) + step + arr.length) % arr.length];
      next.focus();
      selectPerson(next.dataset.person);
    });
  });

  /* ───────── Вкладки дней ───────── */

  function selectTab(day) {
    el.tabs.forEach(function (t) {
      var active = t.dataset.day === day;
      t.setAttribute("aria-selected", active ? "true" : "false");
      t.tabIndex = active ? 0 : -1;
    });

    var isHelp = day === "help";
    el.panelDay.hidden = isHelp;
    el.panelHelp.hidden = !isHelp;
    el.progress.hidden = isHelp;

    if (!isHelp) {
      renderDay(day);
      el.panelDay.setAttribute("aria-labelledby", "tab-" + day);
    }
    store("lastTab", day);
  }

  el.tabs.forEach(function (t) {
    t.addEventListener("click", function () { selectTab(t.dataset.day); });
    t.addEventListener("keydown", function (e) {
      var step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      var arr = Array.prototype.slice.call(el.tabs);
      var next = arr[(arr.indexOf(t) + step + arr.length) % arr.length];
      next.focus();
      selectTab(next.dataset.day);
    });
  });

  /* ───────── Старт ───────── */

  applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  applySound(soundOn());
  selectPerson(recall("person") || DEFAULT_PERSON);
  selectTab(WEEKDAY_MAP[new Date().getDay()] || "mon");
})();
