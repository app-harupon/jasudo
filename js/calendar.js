/* ============================================================
 * calendar.js — 月/週/日ビューのカレンダー + 未スケジュールトレイ + 今日リスト
 * 週・日ビューは時刻グリッドで、タスクを「何分やるか」に応じたブロックとして配置する。
 * ============================================================ */
const Calendar = (() => {
  const grid = document.getElementById("cal-grid");
  const monthView = document.getElementById("cal-month-view");
  const timegrid = document.getElementById("cal-timegrid");
  const title = document.getElementById("cal-title");
  const trayList = document.getElementById("tray-list");
  const todayList = document.getElementById("today-list");
  const modeBtns = document.querySelectorAll(".mode-btn");
  const catFilterEl = document.getElementById("cal-cat-filter");

  const ROW_H = 44;       // 1時間あたりの高さ(px)
  const START_HOUR = 0;
  const END_HOUR = 24;

  let cursor = new Date();               // 各モード共通の基準日
  let mode = Store.settings.calendarView || "month";

  /* ---------- ドロップ受け入れ(汎用) ---------- */
  // ドラッグされた要素が「タスク(t:id)」か「予定(e:id)」かを判別する
  function parseDrag(raw) {
    const i = raw.indexOf(":");
    if (i === -1) return null;
    return { type: raw.slice(0, i), id: raw.slice(i + 1) };
  }
  function makeDroppable(el, onDrop) {
    el._dropHandler = onDrop; // タッチ操作(touch-drag.js)からも同じ処理を呼べるように保持しておく
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const drag = parseDrag(e.dataTransfer.getData("text/plain") || "");
      if (drag) onDrop(drag, e);
    });
  }

  /* ---------- 未スケジュールトレイ ---------- */
  function renderTray() {
    trayList.innerHTML = "";
    // 定時タスクは曜日×時刻で自動的に出現するため、未スケジュール扱いにはしない
    const list = Store.getTasks()
      .filter((t) => !t.done && !t.scheduledDate && !t.recurrence)
      .filter((t) => Store.matchesCategoryFilter(t.categoryId))
      .sort((a, b) => Store.scoreOf(b) - Store.scoreOf(a));
    if (list.length === 0) {
      const p = document.createElement("div");
      p.className = "tray-empty";
      p.textContent = "未スケジュールのタスクはありません";
      trayList.appendChild(p);
    }
    list.forEach((t) => trayList.appendChild(UI.makeChip(t)));
  }
  // トレイへドロップ = スケジュール解除(日付・時刻とも外す)。予定は常に日付を持つため対象外
  makeDroppable(trayList, (drag) => {
    if (drag.type !== "t") return;
    Store.updateTask(drag.id, { scheduledDate: null, scheduledTime: null });
    UI.toast("未スケジュールに戻しました");
    App.refresh();
  });

  /* ============================================================
   * モード切替
   * ============================================================ */
  function setMode(m) {
    mode = m;
    Store.setSetting("calendarView", m);
    modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    monthView.classList.toggle("hidden", m !== "month");
    timegrid.classList.toggle("hidden", m === "month");
    renderMain();
  }
  modeBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  function renderMain() {
    updateTitle();
    if (mode === "month") renderMonth();
    else if (mode === "week") renderWeek();
    else renderDay();
  }

  function updateTitle() {
    if (mode === "month") {
      title.textContent = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;
    } else if (mode === "week") {
      const s = Store.startOfWeek(cursor);
      const e = Store.addDays(s, 6);
      title.textContent = `${s.getMonth() + 1}/${s.getDate()} 〜 ${e.getMonth() + 1}/${e.getDate()}`;
    } else {
      const wd = ["日", "月", "火", "水", "木", "金", "土"][cursor.getDay()];
      title.textContent = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月${cursor.getDate()}日(${wd})`;
    }
  }

  /* ============================================================
   * 月ビュー
   * ============================================================ */
  function renderMonth() {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    grid.innerHTML = "";

    const byDate = {};
    Store.getTasks().forEach((t) => {
      if (!t.scheduledDate || !Store.matchesCategoryFilter(t.categoryId)) return;
      (byDate[t.scheduledDate] = byDate[t.scheduledDate] || []).push(t);
    });
    const eventsByDate = {};
    Store.getEvents().forEach((ev) => {
      if (!Store.matchesCategoryFilter(ev.categoryId)) return;
      (eventsByDate[ev.date] = eventsByDate[ev.date] || []).push(ev);
    });

    const firstWd = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const totalCells = Math.ceil((firstWd + daysInMonth) / 7) * 7;
    const tKey = Store.todayKey();

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - firstWd + 1;
      const cell = document.createElement("div");
      if (dayNum < 1 || dayNum > daysInMonth) {
        cell.className = "cal-cell out";
        grid.appendChild(cell);
        continue;
      }
      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      cell.className = "cal-cell" + (key === tKey ? " today" : "");

      const dateEl = document.createElement("div");
      dateEl.className = "cal-date";
      dateEl.textContent = dayNum;
      dateEl.title = "タップして日ビューを開く";
      dateEl.addEventListener("click", (e) => {
        e.stopPropagation();
        cursor = new Date(y, m, dayNum);
        setMode("day");
      });
      cell.appendChild(dateEl);

      // その日が対象曜日の定時タスクも合わせて表示する
      const dateObj = new Date(y, m, dayNum);
      const recurHere = Store.getTasks()
        .filter((t) => Store.occursOnDate(t, dateObj) && Store.matchesCategoryFilter(t.categoryId));
      // 優先度順で並ぶ →「今何をやるべきか」が一目でわかる(予定は末尾に追加)
      const taskList = (byDate[key] || []).concat(recurHere)
        .sort((a, b) => Store.effectiveScore(b) - Store.effectiveScore(a));
      const eventList = eventsByDate[key] || [];
      const MAX_SHOW = 3;
      taskList.slice(0, MAX_SHOW).forEach((t) => cell.appendChild(UI.makeChip(t, { showTime: true, dateCtx: key })));
      eventList.slice(0, Math.max(0, MAX_SHOW - taskList.length)).forEach((ev) => cell.appendChild(UI.makeEventChip(ev)));
      const shownCount = Math.min(taskList.length, MAX_SHOW) + Math.min(eventList.length, Math.max(0, MAX_SHOW - taskList.length));
      const totalCount = taskList.length + eventList.length;
      if (totalCount > shownCount) {
        const more = document.createElement("div");
        more.className = "cal-more";
        more.textContent = `他${totalCount - shownCount}件`;
        cell.appendChild(more);
      }

      makeDroppable(cell, (drag) => {
        if (drag.type === "e") Store.updateEvent(drag.id, { date: key });
        else Store.updateTask(drag.id, { scheduledDate: key });
        UI.toast(`${m + 1}/${dayNum} に設定しました`);
        App.refresh();
      });

      grid.appendChild(cell);
    }
  }

  /* ============================================================
   * 週・日ビュー(時刻グリッド)
   * 「どこで何分やるか」をブロックの高さで表現する。
   * ============================================================ */
  function renderWeek() {
    const start = Store.startOfWeek(cursor);
    buildTimeGrid(Array.from({ length: 7 }, (_, i) => Store.addDays(start, i)));
  }
  function renderDay() {
    buildTimeGrid([new Date(cursor)]);
  }

  function buildTimeGrid(days) {
    timegrid.classList.toggle("mode-week", days.length > 1);
    timegrid.classList.toggle("mode-day", days.length === 1);
    timegrid.innerHTML = "";

    const scrollOuter = document.createElement("div");
    scrollOuter.className = "tg-hscroll";
    const inner = document.createElement("div");
    inner.className = "tg-inner";

    /* ---- ヘッダー(曜日・日付) ---- */
    const head = document.createElement("div");
    head.className = "tg-head";
    head.appendChild(el("div", "tg-gutter"));
    days.forEach((d) => {
      const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
      const h = el("div", "tg-day-head" + (Store.dateKey(d) === Store.todayKey() ? " today" : ""));
      h.innerHTML = `<span class="tg-wd">${wd}</span><span class="tg-date">${d.getDate()}</span>`;
      if (days.length > 1) {
        h.style.cursor = "pointer";
        h.title = "タップして日ビューを開く";
        h.addEventListener("click", () => { cursor = new Date(d); setMode("day"); });
      }
      head.appendChild(h);
    });
    inner.appendChild(head);

    /* ---- スクロール本体(時刻ラベル + 各日トラック) ---- */
    const scrollInner = document.createElement("div");
    scrollInner.className = "tg-scroll";
    const body = document.createElement("div");
    body.className = "tg-body";
    body.style.height = `${(END_HOUR - START_HOUR) * ROW_H}px`;

    const gutter = el("div", "tg-gutter");
    for (let h = START_HOUR; h < END_HOUR; h++) {
      const lbl = el("div", "tg-hour-label");
      lbl.style.top = `${(h - START_HOUR) * ROW_H}px`;
      lbl.textContent = `${h}:00`;
      gutter.appendChild(lbl);
    }
    body.appendChild(gutter);

    const byDate = {};
    Store.getTasks().forEach((t) => {
      if (!t.scheduledDate || !Store.matchesCategoryFilter(t.categoryId)) return;
      (byDate[t.scheduledDate] = byDate[t.scheduledDate] || []).push(t);
    });
    const eventsByDate = {};
    Store.getEvents().forEach((ev) => {
      if (!Store.matchesCategoryFilter(ev.categoryId)) return;
      (eventsByDate[ev.date] = eventsByDate[ev.date] || []).push(ev);
    });

    days.forEach((d) => {
      const key = Store.dateKey(d);
      const track = el("div", "tg-track" + (key === Store.todayKey() ? " today" : ""));
      track.dataset.date = key;

      for (let h = START_HOUR; h < END_HOUR; h++) {
        const line = el("div", "tg-line");
        line.style.top = `${(h - START_HOUR) * ROW_H}px`;
        track.appendChild(line);
      }

      const dayTasks = byDate[key] || [];
      const recurHere = Store.getTasks()
        .filter((t) => Store.occursOnDate(t, d) && Store.matchesCategoryFilter(t.categoryId));
      const dayEvents = eventsByDate[key] || [];

      // 時刻未設定タスク・終日予定は上部にまとめて表示(ドラッグでブロック化できる)
      const untimedTasks = dayTasks.filter((t) => !t.scheduledTime);
      const alldayEvents = dayEvents.filter((ev) => !ev.time);
      if (untimedTasks.length || alldayEvents.length) {
        const bar = el("div", "tg-untimed");
        untimedTasks.forEach((t) => bar.appendChild(UI.makeChip(t)));
        alldayEvents.forEach((ev) => bar.appendChild(UI.makeEventChip(ev)));
        track.appendChild(bar);
      }

      // 時刻設定済み・定時タスク → 開始時刻×所要時間でブロック配置
      dayTasks.filter((t) => t.scheduledTime).concat(recurHere).forEach((t) => {
        const time = Store.timeOf(t);
        const startMin = Store.timeToMinutes(time) - START_HOUR * 60;
        const top = (startMin / 60) * ROW_H;
        const height = Math.max(18, (t.totalMinutes / 60) * ROW_H - 2);
        track.appendChild(UI.makeTimeBlock(t, { top, height, dateCtx: key }));
      });

      // 時刻設定済みの予定も同様にブロック配置
      dayEvents.filter((ev) => ev.time).forEach((ev) => {
        const startMin = Store.timeToMinutes(ev.time) - START_HOUR * 60;
        const top = (startMin / 60) * ROW_H;
        const height = Math.max(18, (ev.minutes / 60) * ROW_H - 2);
        track.appendChild(UI.makeEventBlock(ev, { top, height }));
      });

      makeDroppable(track, (drag, e) => {
        const rect = track.getBoundingClientRect();
        const rawMin = ((e.clientY - rect.top) / ROW_H) * 60 + START_HOUR * 60;
        // 30分ごとの枠に吸い寄せる
        const snapped = Math.max(
          START_HOUR * 60,
          Math.min(END_HOUR * 60 - 30, Math.round(rawMin / 30) * 30)
        );
        const snappedTime = Store.minutesToTime(snapped);
        if (drag.type === "e") Store.updateEvent(drag.id, { date: key, time: snappedTime });
        else Store.updateTask(drag.id, { scheduledDate: key, scheduledTime: snappedTime });
        UI.toast(`${snappedTime} に設定しました`);
        App.refresh();
      });

      body.appendChild(track);
    });

    scrollInner.appendChild(body);
    inner.appendChild(scrollInner);
    scrollOuter.appendChild(inner);
    timegrid.appendChild(scrollOuter);

    // 現在時刻の少し手前が見えるようにスクロール位置を合わせる
    const targetHour = Math.max(START_HOUR, new Date().getHours() - 1);
    scrollInner.scrollTop = (targetHour - START_HOUR) * ROW_H;
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /* ---------- 今日やるリスト(優先度順) ---------- */
  function renderToday() {
    todayList.innerHTML = "";
    const tKey = Store.todayKey();
    const today = new Date();
    const scheduled = Store.getTasks()
      .filter((t) => !t.done && !t.recurrence && t.scheduledDate && t.scheduledDate <= tKey);
    const recurToday = Store.getTasks()
      .filter((t) => Store.occursOnDate(t, today) && !Store.isDoneOn(t, tKey));
    const list = scheduled.concat(recurToday)
      .filter((t) => Store.matchesCategoryFilter(t.categoryId))
      .sort((a, b) => Store.effectiveScore(b) - Store.effectiveScore(a));

    if (list.length === 0) {
      todayList.innerHTML = '<div class="today-empty">今日のタスクはありません。カレンダーにドラッグして予定を組みましょう。</div>';
      return;
    }
    list.forEach((t, i) => {
      todayList.appendChild(UI.makeListItem(t, {
        rank: i + 1,
        tag: (!t.recurrence && t.scheduledDate < tKey) ? "持ち越し" : null,
        dateCtx: tKey,
      }));
    });
  }

  function render() {
    Categories.renderFilterBar(catFilterEl);
    modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    monthView.classList.toggle("hidden", mode !== "month");
    timegrid.classList.toggle("hidden", mode === "month");
    renderTray();
    renderMain();
    renderToday();
  }

  /* ---------- ナビゲーション(モードに応じて移動幅を変える) ---------- */
  document.getElementById("cal-prev").addEventListener("click", () => {
    if (mode === "month") cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    else if (mode === "week") cursor = Store.addDays(cursor, -7);
    else cursor = Store.addDays(cursor, -1);
    renderMain();
  });
  document.getElementById("cal-next").addEventListener("click", () => {
    if (mode === "month") cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    else if (mode === "week") cursor = Store.addDays(cursor, 7);
    else cursor = Store.addDays(cursor, 1);
    renderMain();
  });
  document.getElementById("cal-today").addEventListener("click", () => {
    cursor = new Date();
    renderMain();
  });

  // 表示中の日付(日ビューはその日、それ以外は今日)を初期値にして予定フォームを開く
  document.getElementById("cal-add-event").addEventListener("click", () => {
    const presetDate = mode === "day" ? Store.dateKey(cursor) : Store.todayKey();
    UI.openEventForm(null, presetDate);
  });

  return { render };
})();
