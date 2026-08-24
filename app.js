/* Логика: рендер дня, отметка подходов, прогресс, таймер отдыха,
   сохранение в localStorage, wake lock. Программа живёт в data.js. */
(function () {
  "use strict";

  var PREFIX = "gym-";

  var el = {
    tabs:        document.querySelectorAll(".tab"),
    panelDay:    document.getElementById("panel-day"),
    panelHelp:   document.getElementById("panel-help"),
    list:        document.getElementById("exList"),
    subtitle:    document.getElementById("daySubtitle"),
    doneCount:   document.getElementById("doneCount"),
    totalCount:  document.getElementById("totalCount"),
    fill:        document.getElementById("progressFill"),
    progress:    document.getElementById("progressBlock"),
    resetDay:    document.getElementById("resetDay"),
    timer:       document.getElementById("timer"),
    timerTime:   document.getElementById("timerTime"),
    timerLabel:  document.getElementById("timerLabel"),
    timerLine:   document.getElementById("timerLine"),
    timerAdd:    document.getElementById("timerAdd"),
    timerRestart:document.getElementById("timerRestart"),
    timerSkip:   document.getElementById("timerSkip")
  };

  var state = { day: null, done: [] };
  var timer = { endAt: 0, total: 0, last: 0, int: null, running: false };

  /* ───────── Хранилище ───────── */

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function fresh(day) {
    return PROGRAM[day].exercises.map(function (ex) {
      return new Array(ex.sets).fill(false);
    });
  }

  function load(day) {
    try {
      var raw = localStorage.getItem(PREFIX + day);
      if (!raw) return fresh(day);
      var saved = JSON.parse(raw);
      // Новый день — отметки прошлой тренировки больше не актуальны
      if (!saved || saved.date !== today()) return fresh(day);
      // Программу могли поправить в data.js — сверяем форму данных
      var shape = fresh(day);
      if (!Array.isArray(saved.sets) || saved.sets.length !== shape.length) return shape;
      for (var i = 0; i < shape.length; i++) {
        if (!Array.isArray(saved.sets[i]) || saved.sets[i].length !== shape[i].length) return shape;
      }
      return saved.sets;
    } catch (e) {
      return fresh(day);
    }
  }

  function save() {
    try {
      localStorage.setItem(PREFIX + state.day, JSON.stringify({ date: today(), sets: state.done }));
    } catch (e) { /* приватный режим — молча работаем без сохранения */ }
  }

  /* ───────── Рендер ───────── */

  function icon(id) {
    return '<svg aria-hidden="true"><use href="#' + id + '"></use></svg>';
  }

  function restLabel(sec) {
    if (!sec) return "без отдыха";
    if (sec < 60) return "отдых " + sec + " с";
    var m = Math.floor(sec / 60), s = sec % 60;
    return "отдых " + m + (s ? ":" + pad(s) : " мин");
  }

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
        '<span class="ex__scheme">' + ex.sets + " × " + ex.reps +
          '<span class="ex__rest">' + restLabel(ex.rest) + "</span>" +
        "</span>" +
        '<div class="sets" role="group" aria-label="Подходы: ' + ex.name + '">' + sets + "</div>" +
      "</div>";

    return art;
  }

  function renderDay(day) {
    state.day = day;
    state.done = load(day);

    var data = PROGRAM[day];
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

  function updateProgress() {
    var done = 0, total = 0;
    state.done.forEach(function (arr) {
      total += arr.length;
      arr.forEach(function (v) { if (v) done++; });
    });
    el.doneCount.textContent = done;
    el.totalCount.textContent = total;
    el.fill.style.width = total ? (done / total * 100) + "%" : "0%";
    el.fill.classList.toggle("is-complete", total > 0 && done === total);
    el.progress.setAttribute("aria-label", "Прогресс дня: " + done + " из " + total + " подходов");
  }

  /* ───────── Подходы ───────── */

  el.list.addEventListener("click", function (e) {
    var btn = e.target.closest(".set");
    if (!btn) return;
    var art = btn.closest(".ex");
    var exIdx = Number(art.dataset.ex);
    var setIdx = Number(btn.dataset.set);

    var on = !state.done[exIdx][setIdx];
    state.done[exIdx][setIdx] = on;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    art.classList.toggle("is-done", state.done[exIdx].every(Boolean));

    save();
    updateProgress();

    if (on) {
      vibrate(10);
      keepAwake();
      var rest = PROGRAM[state.day].exercises[exIdx].rest;
      if (rest > 0) startTimer(rest);
    }
  });

  el.resetDay.addEventListener("click", function () {
    if (!confirm("Сбросить все отметки за " + PROGRAM[state.day].title.toLowerCase() + "?")) return;
    state.done = fresh(state.day);
    save();
    restoreMarks();
    updateProgress();
  });

  /* ───────── Таймер отдыха ───────── */

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + pad(s);
  }

  function startTimer(sec) {
    timer.total = sec;
    timer.last = sec;
    timer.endAt = Date.now() + sec * 1000;
    timer.running = true;
    el.timer.classList.remove("is-done");
    el.timer.classList.add("is-open");
    el.timerLabel.textContent = "Отдых";
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
    beep();
    vibrate([70, 80, 70]);
    setTimeout(function () { if (!timer.running) closeTimer(); }, 6000);
  }

  function closeTimer() {
    clearInterval(timer.int);
    timer.int = null;
    timer.running = false;
    el.timer.classList.remove("is-open");
  }

  el.timerAdd.addEventListener("click", function () {
    if (!timer.running) { startTimer(30); return; }
    timer.endAt += 30000;
    timer.total += 30;
    tick();
  });
  el.timerRestart.addEventListener("click", function () { startTimer(timer.last || 90); });
  el.timerSkip.addEventListener("click", closeTimer);

  /* Короткий бип через Web Audio — без внешних файлов, работает и без сети */
  var audioCtx = null;
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
      [0, 0.18].forEach(function (offset) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        var t = audioCtx.currentTime + offset;
        o.type = "sine";
        o.frequency.setValueAtTime(880, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t); o.stop(t + 0.16);
      });
    } catch (e) { /* звук недоступен — остаётся вибрация */ }
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  /* ───────── Экран не гаснет ───────── */

  var lock = null;
  function keepAwake() {
    if (!("wakeLock" in navigator) || lock) return;
    navigator.wakeLock.request("screen").then(function (l) {
      lock = l;
      l.addEventListener("release", function () { lock = null; });
    }).catch(function () { /* не поддерживается или отказано — не критично */ });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { keepAwake(); if (timer.running) tick(); }
  });

  /* ───────── Вкладки ───────── */

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
    try { localStorage.setItem(PREFIX + "lastTab", day); } catch (e) {}
  }

  el.tabs.forEach(function (t) {
    t.addEventListener("click", function () { selectTab(t.dataset.day); });
    t.addEventListener("keydown", function (e) {
      var keys = { ArrowLeft: -1, ArrowRight: 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      var arr = Array.prototype.slice.call(el.tabs);
      var i = (arr.indexOf(t) + keys[e.key] + arr.length) % arr.length;
      arr[i].focus();
      selectTab(arr[i].dataset.day);
    });
  });

  /* ───────── Старт ───────── */

  selectTab(WEEKDAY_MAP[new Date().getDay()] || "mon");
})();
