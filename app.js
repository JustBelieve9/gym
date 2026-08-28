/* Логика: выбор человека и темы, рендер дня, выбор альтернативы, отметка подходов,
   вес и повторы по подходам, прогресс, визуальный таймер отдыха, пинг таймера
   и отчёт в телеграм, wake lock.
   Программы живут в data.js. */
(function () {
  "use strict";

  var PREFIX = "gym-";
  var REPORT_URL = "https://gym-report.thezavarkin.workers.dev";
  var THEME_COLOR = { dark: "#0B1120", light: "#EEF1F6" };

  var el = {
    people:      document.querySelectorAll(".person"),
    themeBtn:    document.getElementById("themeBtn"),
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

  var state = { person: DEFAULT_PERSON, day: null, done: [], log: [], pick: [], startedAt: 0, sent: false };
  var timer = { endAt: 0, total: 0, last: 0, int: null, running: false, label: "" };

  function store(k, v) { try { localStorage.setItem(PREFIX + k, v); } catch (e) {} }
  function recall(k)   { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } }
  function program()   { return PEOPLE[state.person].program; }
  function exList()     { return program()[state.day].exercises; }
  function activeName(i) { return (state.pick && state.pick[i]) || exList()[i].name; }
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
  function freshLog(day) {
    return program()[day].exercises.map(function (ex) {
      var a = []; for (var i = 0; i < ex.sets; i++) a.push({ w: null, r: null }); return a;
    });
  }
  function freshPick(day) { return program()[day].exercises.map(function () { return null; }); }

  function numOrNull(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  /* Лог по подходам. Понимает и новый формат (log: [[{w,r}]]), и старые записи
     с одним весом на упражнение (weights: [60, …]) — старый вес уходит в первый подход. */
  function normalizeLog(saved, day) {
    var base = freshLog(day);
    if (Array.isArray(saved.log) && saved.log.length === base.length) {
      var okShape = base.every(function (arr, i) {
        return Array.isArray(saved.log[i]) && saved.log[i].length === arr.length;
      });
      if (okShape) {
        return base.map(function (arr, i) {
          return arr.map(function (_, j) {
            var s = saved.log[i][j] || {};
            return { w: numOrNull(s.w), r: numOrNull(s.r) };
          });
        });
      }
    }
    if (Array.isArray(saved.weights) && saved.weights.length === base.length) {
      base.forEach(function (arr, i) {
        if (arr[0] && saved.weights[i] != null) arr[0].w = numOrNull(saved.weights[i]);
      });
    }
    return base;
  }

  function load(day) {
    var exs = program()[day].exercises;
    var blank = { sets: fresh(day), log: freshLog(day), pick: freshPick(day), startedAt: 0, sent: false };
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
        log: normalizeLog(saved, day),
        pick: Array.isArray(saved.pick) && saved.pick.length === shape.length
          ? saved.pick.map(function (p, idx) {
              var ex = exs[idx];
              var ok = p && (p === ex.name || (ex.alts || []).indexOf(p) !== -1);
              return ok ? p : null;
            })
          : freshPick(day),
        startedAt: saved.startedAt || 0,
        sent: Boolean(saved.sent)
      };
    } catch (e) { return blank; }
  }

  function save() {
    store(key(state.day), JSON.stringify({
      date: today(), sets: state.done, log: state.log, pick: state.pick,
      startedAt: state.startedAt, sent: state.sent
    }));
  }

  /* Последние вес и повторы — по НАЗВАНИЮ упражнения, не по номеру: перестановка
     программы в data.js и переключение альтернативы не путают подсказки между
     упражнениями. Старый формат (число вместо {w,r}) читается как {w:число}. */
  function lastLog() {
    var m;
    try { m = JSON.parse(recall(state.person + "-lastw") || "{}"); } catch (e) { m = {}; }
    Object.keys(m).forEach(function (k) {
      if (typeof m[k] === "number") m[k] = { w: m[k], r: null };
    });
    return m;
  }
  function rememberSet(name, w, r) {
    var m = lastLog();
    if (w == null && r == null) {
      delete m[name];
    } else {
      var cur = m[name] && typeof m[name] === "object" ? m[name] : {};
      m[name] = {
        w: w != null ? w : (cur.w != null ? cur.w : null),
        r: r != null ? r : (cur.r != null ? cur.r : null)
      };
    }
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

    var active = activeName(idx);
    var variants = [ex.name].concat(ex.alts || []);
    var chips = variants
      .filter(function (v) { return v !== active; })
      .map(function (v) { return '<button type="button" class="altchip" data-name="' + esc(v) + '">' + esc(v) + "</button>"; })
      .join("");
    var altsHtml = (ex.alts && ex.alts.length) ? '<div class="ex__alts">' + chips + "</div>" : "";

    var rows = "";
    for (var i = 0; i < ex.sets; i++) {
      var rec = (state.log[idx] && state.log[idx][i]) || { w: null, r: null };
      rows +=
        '<div class="setrow" data-set="' + i + '">' +
          '<button type="button" class="set" data-set="' + i + '" aria-pressed="false"' +
            ' aria-label="Подход ' + (i + 1) + " из " + ex.sets + '">' +
            '<span class="set__n">' + (i + 1) + "</span>" + icon("i-check") + "</button>" +
          '<input class="field field--w" type="text" inputmode="decimal" enterkeyhint="next"' +
            ' data-k="w" aria-label="Вес, подход ' + (i + 1) + '" value="' + (rec.w != null ? fmtWeight(rec.w) : "") + '">' +
          '<span class="setrow__x" aria-hidden="true">×</span>' +
          '<input class="field field--r" type="text" inputmode="numeric" enterkeyhint="done"' +
            ' data-k="r" aria-label="Повторы, подход ' + (i + 1) + '" value="' + (rec.r != null ? rec.r : "") + '">' +
        "</div>";
    }

    art.innerHTML =
      '<div class="ex__head">' +
        '<span class="ex__num">' + (idx + 1) + "</span>" +
        '<div class="ex__title">' +
          '<h3 class="ex__name">' + esc(active) + "</h3>" + altsHtml +
        "</div>" +
      "</div>" +
      '<div class="ex__scheme-row">' +
        '<span class="ex__scheme">' + ex.sets + " × " + ex.reps + "</span>" +
        '<span class="ex__rest">' + restLabel(ex.rest) + "</span>" +
      "</div>" +
      '<div class="ex__sets" role="group" aria-label="Подходы: ' + esc(active) + '">' + rows + "</div>";

    return art;
  }

  /* Плейсхолдеры веса и повторов: старт от прошлой тренировки этого упражнения,
     дальше по сессии подхватывается уже введённое значение. */
  function refreshHints(exIdx) {
    var art = el.list.querySelector('[data-ex="' + exIdx + '"]');
    if (!art) return;
    var last = lastLog()[activeName(exIdx)] || {};
    var prevW = last.w != null ? last.w : null;
    var prevR = last.r != null ? last.r : null;
    var lowReps = (exList()[exIdx].reps.match(/\d+/) || [""])[0];
    var rows = art.querySelectorAll(".setrow");
    Array.prototype.forEach.call(rows, function (row, i) {
      var rec = (state.log[exIdx] && state.log[exIdx][i]) || { w: null, r: null };
      var wf = row.querySelector(".field--w");
      var rf = row.querySelector(".field--r");
      if (wf) wf.placeholder = prevW != null ? fmtWeight(prevW) : "";
      if (rf) rf.placeholder = prevR != null ? String(prevR) : lowReps;
      if (rec.w != null) prevW = rec.w;
      if (rec.r != null) prevR = rec.r;
    });
  }

  function rebuildCard(idx) {
    var old = el.list.querySelector('[data-ex="' + idx + '"]');
    if (!old) return;
    var node = exerciseNode(exList()[idx], idx);
    old.parentNode.replaceChild(node, old);
    applyMarks(idx);
    refreshHints(idx);
  }

  function renderDay(day) {
    state.day = day;
    var loaded = load(day);
    state.done = loaded.sets;
    state.log = loaded.log;
    state.pick = loaded.pick;
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
    });

    restoreMarks();
    data.exercises.forEach(function (ex, i) { refreshHints(i); });
    updateProgress();
  }

  function applyMarks(exIdx) {
    var art = el.list.querySelector('[data-ex="' + exIdx + '"]');
    if (!art) return;
    var arr = state.done[exIdx] || [];
    arr.forEach(function (on, setIdx) {
      var b = art.querySelector('.set[data-set="' + setIdx + '"]');
      if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    art.classList.toggle("is-done", arr.length > 0 && arr.every(Boolean));
  }

  function restoreMarks() {
    state.done.forEach(function (_, exIdx) { applyMarks(exIdx); });
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

  /* ───────── Подходы, веса, альтернативы ───────── */

  el.list.addEventListener("click", function (e) {
    var chip = e.target.closest(".altchip");
    if (chip) {
      var cart = chip.closest(".ex");
      var ci = Number(cart.dataset.ex);
      var picked = chip.dataset.name;
      state.pick[ci] = picked === exList()[ci].name ? null : picked;
      save();
      rebuildCard(ci);
      return;
    }

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
      var rest = exList()[exIdx].rest;
      if (rest > 0) startTimer(rest, activeName(exIdx));
      var c = counts();
      if (c.done === c.total && !state.sent) sendReport(true);
    }
  });

  el.list.addEventListener("change", function (e) {
    var f = e.target.closest(".field");
    if (!f) return;
    var art = f.closest(".ex"), row = f.closest(".setrow");
    var exIdx = Number(art.dataset.ex), setIdx = Number(row.dataset.set), k = f.dataset.k;

    var raw = f.value.trim().replace(",", ".");
    var n = raw === "" ? null : parseFloat(raw);
    var prev = state.log[exIdx][setIdx][k];
    if (n != null && (!isFinite(n) || n < 0 || n > 999)) n = prev;
    if (n != null && k === "r") n = Math.round(n);

    state.log[exIdx][setIdx][k] = n;
    f.value = n == null ? "" : (k === "w" ? fmtWeight(n) : String(n));

    var rec = state.log[exIdx][setIdx];
    rememberSet(activeName(exIdx), rec.w, rec.r);
    save();
    refreshHints(exIdx);
  });

  el.resetDay.addEventListener("click", function () {
    if (!confirm("Сбросить все отметки за " + program()[state.day].title.toLowerCase() + "?")) return;
    state.done = fresh(state.day);
    state.log = freshLog(state.day);
    state.pick = freshPick(state.day);
    state.startedAt = 0;
    state.sent = false;
    save();
    renderDay(state.day);
  });

  /* ───────── Таймер отдыха ─────────
     Визуальный обратный отсчёт на экране. Сигнал об окончании приходит пингом
     в телеграм (worker сам планирует отправку — переживает сон телефона). */

  function fmt(sec) { return Math.floor(sec / 60) + ":" + pad(sec % 60); }

  function pingTimer(seconds, label) {
    try {
      fetch(REPORT_URL + "/timer", {
        method: "POST", keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ person: state.person, seconds: Math.round(seconds), label: label || "" })
      }).catch(function () {});
    } catch (e) {}
  }
  function cancelPing() {
    try {
      fetch(REPORT_URL + "/timer/cancel", {
        method: "POST", keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ person: state.person })
      }).catch(function () {});
    } catch (e) {}
  }

  function startTimer(sec, label) {
    timer.total = sec;
    timer.last = sec;
    timer.label = label || "";
    timer.endAt = Date.now() + sec * 1000;
    timer.running = true;
    el.timer.classList.remove("is-done");
    el.timer.classList.add("is-open");
    el.timerLabel.textContent = "Отдых";

    pingTimer(sec, timer.label);

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
    cancelPing();                 // таймер догорел на экране — серверный пинг уже не нужен
    setTimeout(function () { if (!timer.running) closeTimer(); }, 6000);
  }

  function closeTimer() {
    clearInterval(timer.int);
    timer.int = null;
    timer.running = false;
    cancelPing();
    el.timer.classList.remove("is-open");
  }

  el.timerAdd.addEventListener("click", function () {
    if (!timer.running) { startTimer(30, ""); return; }
    timer.endAt += 30000;
    timer.total += 30;
    pingTimer(Math.max(0, (timer.endAt - Date.now()) / 1000), timer.label);
    tick();
  });
  el.timerRestart.addEventListener("click", function () { startTimer(timer.last || 90, timer.label); });
  el.timerSkip.addEventListener("click", closeTimer);

  /* ───────── Отчёт в телеграм ───────── */

  function toast(msg, bad) {
    el.toast.textContent = msg;
    el.toast.classList.toggle("is-bad", Boolean(bad));
    el.toast.classList.add("is-on");
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.toast.classList.remove("is-on"); }, 4000);
  }

  function setSummary(i) {
    var parts = state.log[i].map(function (rec) {
      if (rec.w != null && rec.r != null) return fmtWeight(rec.w) + "×" + rec.r;
      if (rec.w != null) return fmtWeight(rec.w) + " кг";
      if (rec.r != null) return rec.r + " повт";
      return null;
    }).filter(Boolean);
    return parts.length ? " · " + parts.join(", ") : "";
  }

  function reportText() {
    var d = program()[state.day], c = counts(), lines = [];
    lines.push("🏋️ <b>" + esc(PEOPLE[state.person].label) + " · " + esc(d.title) + "</b>");
    lines.push(esc(d.subtitle));
    lines.push("");
    d.exercises.forEach(function (ex, i) {
      var arr = state.done[i], n = arr.filter(Boolean).length;
      var mark = n === arr.length ? "✅" : (n ? "🟡" : "⚪️");
      lines.push(mark + " " + esc(activeName(i)) + setSummary(i) + " · " + n + "/" + arr.length);
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
  selectPerson(recall("person") || DEFAULT_PERSON);
  selectTab(WEEKDAY_MAP[new Date().getDay()] || "mon");
})();
