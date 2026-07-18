/* ============================================================
 * store.js — データモデル・スコアリング・永続化
 * ============================================================ */
const Store = (() => {
  const LS_TASKS = "ponTodo.tasks";
  const LS_EVENTS = "ponTodo.events";
  const LS_CATEGORIES = "ponTodo.categories";
  const LS_SETTINGS = "ponTodo.settings";
  const LS_SESSION = "ponTodo.session";

  // カテゴリ(セクション)に使える色パレット
  const CATEGORY_COLORS = ["#5b5bd6", "#f59e0b", "#10b981", "#e5484d", "#0ea5e9", "#a855f7", "#64748b", "#ec4899"];

  /* --- 重要度(3段階・自己申告) ---
   * score は内部の並び替えにのみ使用し、画面上には数値を出さない。
   */
  const IMPORTANCE = {
    high: {
      score: 5.3, label: "高",
      desc: "これをやらないと、他や全体が止まる",
      examples: [
        "これが終わらないと次の作業に進めない",
        "明日の会議資料 — ないと会議自体が成立しない",
        "相手に提出・返信しないと待たせてしまう",
        "このバグを直さないとリリースできない",
      ],
    },
    mid: {
      score: 4.2, label: "中",
      desc: "多少遅れても他でカバーできる、質や効率に関わる",
      examples: [
        "資料の見直し・ブラッシュアップ",
        "テストやレビューで精度を上げる",
        "手順書・ドキュメントの整備",
        "急ぎではないが、やっておくと後が楽になる",
      ],
    },
    low: {
      score: 3.1, label: "低",
      desc: "後回しにしても、他のタスクに影響しない",
      examples: [
        "経費精算・事務手続き",
        "デスク・ファイルの整理",
        "細かい見た目の調整",
        "急ぎではない情報収集・雑務",
      ],
    },
  };

  /* --- 緊急度(5段階・締切から自動算出) --- */
  const URGENCY_LABELS = {
    5: "今日中", 4: "3日以内", 3: "1週間以内", 2: "1カ月以内", 1: "いつでも",
  };

  const FOCUS_OPTIONS = [15, 25, 30, 45, 60];
  const BREAK_OPTIONS = [3, 5, 8, 10, 15, 20];

  const STAGE_LABELS = { early: "序盤", mid: "中盤", late: "終盤" };
  const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

  let tasks = [];
  let events = [];
  let categories = [];
  let settings = {
    focusMin: 25, breakMin: 5, semiAuto: false, calendarView: "month", tutorialDone: false,
    categoryFilter: [],      // 空配列 = フィルターなし(すべて表示)
    statusFilter: "pending", // pending(未完了) | done(完了) | all(すべて)
    soundEnabled: true,      // タイマーの通知音のON/OFF
  };

  /* ---------- 永続化 ---------- */
  function load() {
    try {
      const t = JSON.parse(localStorage.getItem(LS_TASKS));
      if (Array.isArray(t)) tasks = t;
    } catch (e) { /* 破損時は初期化 */ }
    try {
      const ev = JSON.parse(localStorage.getItem(LS_EVENTS));
      if (Array.isArray(ev)) events = ev;
    } catch (e) { /* 破損時は初期化 */ }
    try {
      const c = JSON.parse(localStorage.getItem(LS_CATEGORIES));
      if (Array.isArray(c)) categories = c;
    } catch (e) { /* 破損時は初期化 */ }
    try {
      const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
      if (s && typeof s === "object") settings = Object.assign(settings, s);
    } catch (e) { /* noop */ }
  }
  function saveTasks() { localStorage.setItem(LS_TASKS, JSON.stringify(tasks)); }
  function saveEvents() { localStorage.setItem(LS_EVENTS, JSON.stringify(events)); }
  function saveCategories() { localStorage.setItem(LS_CATEGORIES, JSON.stringify(categories)); }
  function saveSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }

  function saveSession(session) {
    if (session) localStorage.setItem(LS_SESSION, JSON.stringify(session));
    else localStorage.removeItem(LS_SESSION);
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(LS_SESSION)); }
    catch (e) { return null; }
  }

  /* ---------- タスクCRUD ---------- */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function addTask(data) {
    const durationType = data.durationType || "fixed"; // fixed | unknown | vague
    const totalMinutes = resolveDurationMinutes(durationType, data.totalMinutes, data.durationMin, data.durationMax);
    const task = {
      id: uid(),
      name: data.name,
      deadline: data.deadline || null,       // ISO文字列 or null
      totalMinutes,
      durationType,
      durationMin: durationType === "vague" ? Math.max(1, Number(data.durationMin) || 60) : null,
      durationMax: durationType === "vague" ? Math.max(Number(data.durationMin) || 60, Number(data.durationMax) || 120) : null,
      importance: data.importance || "mid",  // high | mid | low
      stage: data.stage || "mid",            // early | mid | late(半自動用・暫定)
      categoryId: data.categoryId || null,   // カテゴリ(セクション)のid or null(未分類)
      scheduledDate: null,                   // "YYYY-MM-DD" or null
      scheduledTime: null,                   // "HH:MM" or null(週/日ビューでの開始時刻)
      recurrence: null,                      // { weekdays: [0-6], time: "HH:MM" } or null(定時タスク)
      completedDates: [],                    // 定時タスクの完了済み日付("YYYY-MM-DD"の配列)
      done: false,
      completedAt: null,                     // 完了した日時(ISO文字列)。完了済みタスク一覧の並び替えに使う
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    saveTasks();
    return task;
  }

  /* ---------- 所要時間(固定 / 不明 / 不明瞭) ----------
   * totalMinutes には常に「実際に計算・スケジューリングに使える数値」を入れておき、
   * 不明/不明瞭のときは durationType と表示用ラベルで区別する。
   * これによりタイマーの分割やカレンダーのブロック配置など、既存のロジックは
   * durationType を意識せずそのまま動く。
   */
  function resolveDurationMinutes(durationType, fixedMinutes, rangeMin, rangeMax) {
    if (durationType === "vague") {
      const lo = Math.max(1, Number(rangeMin) || 60);
      const hi = Math.max(lo, Number(rangeMax) || 120);
      return Math.round((lo + hi) / 2);
    }
    if (durationType === "unknown") return 30; // フォールバック値。タイマー開始時などに上書き可能
    return Math.max(1, Number(fixedMinutes) || 30);
  }
  function durationLabel(task) {
    if (task.durationType === "vague") return `約${task.durationMin}〜${task.durationMax}分`;
    if (task.durationType === "unknown") return "不明";
    return `${task.totalMinutes}分`;
  }
  // タスク詳細からの「所要時間を変更する」用
  function setDuration(id, durationType, { minutes, rangeMin, rangeMax } = {}) {
    const resolved = resolveDurationMinutes(durationType, minutes, rangeMin, rangeMax);
    return updateTask(id, {
      durationType,
      totalMinutes: resolved,
      durationMin: durationType === "vague" ? Math.max(1, Number(rangeMin) || 60) : null,
      durationMax: durationType === "vague" ? Math.max(Number(rangeMin) || 60, Number(rangeMax) || 120) : null,
    });
  }

  // タスクを指定分数単位で分割し、元タスクを独立した複数タスクに置き換える
  function splitTask(id, chunkMinutes) {
    const idx = tasks.findIndex((x) => x.id === id);
    if (idx === -1) return [];
    const original = tasks[idx];
    const segs = splitMinutes(original.totalMinutes, chunkMinutes);
    if (segs.length < 2) return [original]; // これ以上分割できない

    const pieces = segs.map((mins, i) => ({
      id: uid(),
      name: `${original.name}(${i + 1}/${segs.length})`,
      deadline: original.deadline,
      totalMinutes: mins,
      durationType: "fixed", // 分割後は具体的な分数になるため固定値として扱う
      durationMin: null,
      durationMax: null,
      importance: original.importance,
      stage: original.stage,
      categoryId: original.categoryId || null,
      scheduledDate: null,
      scheduledTime: null,
      recurrence: null,
      completedDates: [],
      done: false,
      completedAt: null,
      createdAt: new Date().toISOString(),
    }));
    tasks.splice(idx, 1, ...pieces);
    saveTasks();
    return pieces;
  }

  // 開始時刻(維持)から新しい終了時刻を受け取り、合計所要時間を逆算して更新する
  function setEndTime(id, endTime) {
    const t = tasks.find((x) => x.id === id);
    if (!t || !t.scheduledTime) return null;
    let mins = timeToMinutes(endTime) - timeToMinutes(t.scheduledTime);
    if (mins <= 0) mins += 1440; // 日をまたぐ場合の簡易対応
    return updateTask(id, {
      totalMinutes: Math.max(5, mins),
      durationType: "fixed",
      durationMin: null,
      durationMax: null,
    });
  }

  // 終了時刻が過ぎても完了していないタスクを自動的に未スケジュールへ戻す
  function releaseOverdueTasks(now = new Date()) {
    const todayKeyStr = dateKey(now);
    let count = 0;
    tasks.forEach((t) => {
      if (t.done || t.recurrence || !t.scheduledDate || !t.scheduledTime) return;
      if (t.scheduledDate > todayKeyStr) return; // 未来の予定はまだ対象外
      const endTime = addMinutesToTime(t.scheduledTime, t.totalMinutes);
      const endDt = new Date(`${t.scheduledDate}T${endTime}:00`);
      if (isNaN(endDt) || endDt.getTime() >= now.getTime()) return;
      t.scheduledDate = null;
      t.scheduledTime = null;
      count++;
    });
    if (count > 0) saveTasks();
    return count;
  }

  /* ---------- 定時タスク(曜日×時刻で繰り返す) ---------- */
  // 定時化すると、個別の日付予定(scheduledDate/Time)は使わず曜日×時刻で自動的に出現する
  function setRecurrence(id, weekdays, time) {
    return updateTask(id, {
      recurrence: { weekdays: weekdays.slice().sort(), time },
      scheduledDate: null,
      scheduledTime: null,
    });
  }
  function clearRecurrence(id) {
    return updateTask(id, { recurrence: null, completedDates: [] });
  }
  function occursOnDate(task, date) {
    return !!task.recurrence && task.recurrence.weekdays.includes(date.getDay());
  }
  // そのタスクの「時刻」(通常タスクはscheduledTime、定時タスクは曜日ルールのtime)
  function timeOf(task) {
    return task.recurrence ? task.recurrence.time : task.scheduledTime;
  }
  // 指定日の完了状態(定時タスクはcompletedDates、通常タスクはdoneで判定)
  function isDoneOn(task, dateKeyStr) {
    if (task.recurrence) return (task.completedDates || []).includes(dateKeyStr);
    return task.done;
  }
  // 完了/未完了を切り替え(定時タスクは指定日のみ、通常タスクは全体)
  function toggleOccurrence(id, dateKeyStr) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    if (t.recurrence) {
      const set = new Set(t.completedDates || []);
      if (set.has(dateKeyStr)) set.delete(dateKeyStr);
      else set.add(dateKeyStr);
      t.completedDates = Array.from(set);
    } else {
      t.done = !t.done;
      t.completedAt = t.done ? new Date().toISOString() : null;
    }
    saveTasks();
    return t;
  }
  // 完了として確定(タイマー完了時など、常に「完了」に倒したい場面用)
  function markDone(id, dateKeyStr) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    if (t.recurrence) {
      const set = new Set(t.completedDates || []);
      set.add(dateKeyStr);
      t.completedDates = Array.from(set);
    } else {
      t.done = true;
      t.completedAt = new Date().toISOString();
    }
    saveTasks();
    return t;
  }
  // 並び替え用の実効スコア。定時タスクは「今日出現していれば今日中(緊急度5)」扱い
  function effectiveScore(task, now = new Date()) {
    if (task.recurrence) return IMPORTANCE[task.importance].score + 5;
    return scoreOf(task, now);
  }

  function updateTask(id, patch) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    saveTasks();
    return t;
  }

  function deleteTask(id) {
    tasks = tasks.filter((x) => x.id !== id);
    saveTasks();
  }

  function getTask(id) { return tasks.find((x) => x.id === id) || null; }
  function getTasks() { return tasks.slice(); }

  /* ---------- 予定(イベント)CRUD ----------
   * タスクと違い、重要度・緊急度・タイマー実行は持たない「ただの予定」。
   * カレンダー(月/週/日)にのみ表示し、やることリストのスコアリングには関与しない。
   */
  const EVENT_MAX_SPAN_DAYS = 60; // 誤入力で極端に長い範囲になるのを防ぐ安全弁

  // 予定フォームの入力値から保存用フィールド一式を組み立てる(追加・編集共通)
  function computeEventFields(data) {
    const hasTime = !!data.time;
    const endUnknown = hasTime && !!data.endUnknown;
    let endDate = (data.endDate && data.endDate >= data.date) ? data.endDate : data.date;
    const spanDays = Math.round((new Date(endDate) - new Date(data.date)) / 86400000);
    if (spanDays > EVENT_MAX_SPAN_DAYS) endDate = dateKey(addDays(new Date(data.date), EVENT_MAX_SPAN_DAYS));
    const endTime = hasTime && !endUnknown ? (data.endTime || null) : null;
    let minutes = null;
    if (hasTime && !endUnknown && endTime) {
      const startDt = new Date(`${data.date}T${data.time}:00`);
      const endDt = new Date(`${endDate}T${endTime}:00`);
      minutes = Math.max(5, Math.round((endDt - startDt) / 60000));
    }
    return {
      title: data.title,
      date: data.date,                     // "YYYY-MM-DD"(必須・開始日)
      endDate,                             // "YYYY-MM-DD"(終了日。単日ならdateと同じ)
      time: data.time || null,             // "HH:MM" or null(終日予定)
      endTime,                             // "HH:MM" or null(終日/終了時刻未定)
      minutes,                             // 参考用の合計所要時間(分)
      endUnknown,                          // 終了時刻が未定の予定(時刻はあるが所要時間なし)
      categoryId: data.categoryId || null, // カテゴリ(セクション)のid or null(未分類)
      memo: data.memo || "",
    };
  }

  function addEvent(data) {
    const ev = Object.assign(
      { id: uid(), done: false, createdAt: new Date().toISOString() },
      computeEventFields(data)
    );
    events.push(ev);
    saveEvents();
    return ev;
  }
  // 予定フォームでの編集保存用:日時関連フィールドを丸ごと再計算する
  function updateEventFull(id, data) {
    const ev = events.find((x) => x.id === id);
    if (!ev) return null;
    Object.assign(ev, computeEventFields(data));
    saveEvents();
    return ev;
  }
  // ドラッグ移動やチェック切り替えなど、指定フィールドだけを部分的に書き換える
  function updateEvent(id, patch) {
    const ev = events.find((x) => x.id === id);
    if (!ev) return null;
    Object.assign(ev, patch);
    saveEvents();
    return ev;
  }
  // ドラッグ&ドロップでの移動:複数日にまたがる予定は終了日も同じ日数だけ一緒にずらす
  function moveEvent(id, newDate, newTime) {
    const ev = events.find((x) => x.id === id);
    if (!ev) return null;
    const dayDelta = Math.round((new Date(newDate) - new Date(ev.date)) / 86400000);
    const patch = { date: newDate };
    patch.endDate = (ev.endDate && ev.endDate !== ev.date)
      ? dateKey(addDays(new Date(ev.endDate), dayDelta))
      : newDate;
    if (newTime !== undefined) patch.time = newTime;
    Object.assign(ev, patch);
    saveEvents();
    return ev;
  }
  function deleteEvent(id) {
    events = events.filter((x) => x.id !== id);
    saveEvents();
  }
  function toggleEventDone(id) {
    const ev = events.find((x) => x.id === id);
    if (!ev) return null;
    ev.done = !ev.done;
    saveEvents();
    return ev;
  }
  function getEvent(id) { return events.find((x) => x.id === id) || null; }
  function getEvents() { return events.slice(); }
  // 指定した日付(YYYY-MM-DD)がその予定の開始日〜終了日の範囲に含まれるか
  function eventOccursOnDate(ev, dateKeyStr) {
    return dateKeyStr >= ev.date && dateKeyStr <= (ev.endDate || ev.date);
  }

  /* ---------- カテゴリ(セクション)CRUD ----------
   * タスク・予定を「仕事」「個人」などに分類し、色で見分けられるようにする。
   * 削除すると、そのカテゴリを使っていたタスク・予定は未分類(categoryId: null)に戻る。
   */
  function addCategory(data) {
    const cat = {
      id: uid(),
      name: data.name,
      color: data.color || CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
      createdAt: new Date().toISOString(),
    };
    categories.push(cat);
    saveCategories();
    return cat;
  }
  function updateCategory(id, patch) {
    const c = categories.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, patch);
    saveCategories();
    return c;
  }
  function deleteCategory(id) {
    categories = categories.filter((x) => x.id !== id);
    let affected = 0;
    tasks.forEach((t) => { if (t.categoryId === id) { t.categoryId = null; affected++; } });
    events.forEach((e) => { if (e.categoryId === id) { e.categoryId = null; affected++; } });
    saveCategories();
    saveTasks();
    saveEvents();
    // 使っていたタスク・予定は未分類に戻すだけで、フィルターにも残さない
    settings.categoryFilter = (settings.categoryFilter || []).filter((cid) => cid !== id);
    saveSettings();
    return affected;
  }
  function getCategory(id) { return categories.find((x) => x.id === id) || null; }
  function getCategories() { return categories.slice(); }

  // 現在のカテゴリフィルターに一致するか(フィルター未設定なら常にtrue = すべて表示)
  function matchesCategoryFilter(categoryId) {
    const filter = settings.categoryFilter;
    if (!filter || filter.length === 0) return true;
    return filter.includes(categoryId);
  }

  /* ---------- 他端末から受信したデータで丸ごと置き換える(メール連携の同期用) ---------- */
  function replaceTasks(newTasks) {
    if (!Array.isArray(newTasks)) return;
    tasks = newTasks;
    saveTasks();
  }
  function replaceEvents(newEvents) {
    if (!Array.isArray(newEvents)) return;
    events = newEvents;
    saveEvents();
  }
  function replaceCategories(newCategories) {
    if (!Array.isArray(newCategories)) return;
    categories = newCategories;
    saveCategories();
  }
  function replaceSettings(newSettings) {
    if (!newSettings || typeof newSettings !== "object") return;
    settings = Object.assign(settings, newSettings);
    saveSettings();
  }

  /* ---------- スコアリング ---------- */
  // 締切から緊急度(1〜5)を自動算出
  function urgencyOf(deadline, now = new Date()) {
    if (!deadline) return 1;
    const d = new Date(deadline);
    if (isNaN(d)) return 1;
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (d <= endOfToday) return 5; // 今日中(超過含む)
    const days = (d - now) / 86400000;
    if (days <= 3) return 4;
    if (days <= 7) return 3;
    if (days <= 30) return 2;
    return 1;
  }

  function scoreOf(task, now = new Date()) {
    return IMPORTANCE[task.importance].score + urgencyOf(task.deadline, now);
  }

  // スコア(4.1〜10.3)を 0〜1 に正規化(色の強調用)
  function scoreRatio(score) {
    return Math.min(1, Math.max(0, (score - 4.1) / (10.3 - 4.1)));
  }

  /* ---------- 半自動モード:重要度の提案 ----------
   * 締切(緊急度) / 所要時間 / プロジェクトの段階 の3軸から提案。
   * ※段階の区分は暫定(汎用3段階)。最終決定は常にユーザーのワンタップ。
   */
  function suggestImportanceDetail({ deadline, totalMinutes, stage }) {
    const u = urgencyOf(deadline);
    const urgencyPts = u >= 4 ? 2 : u === 3 ? 1 : 0;
    const total = Number(totalMinutes) || 0;
    const durationPts = total >= 120 ? 2 : total >= 60 ? 1 : 0;
    const stagePts = stage === "early" ? 2 : stage === "mid" ? 1 : 0;
    const pts = urgencyPts + durationPts + stagePts;
    const result = pts >= 4 ? "high" : pts >= 2 ? "mid" : "low";
    return { result, pts, urgencyPts, durationPts, stagePts };
  }
  function suggestImportance(args) {
    return suggestImportanceDetail(args).result;
  }

  /* ---------- セグメント分割 ---------- */
  // 合計時間を集中時間単位で機械的に分割(余りは端数セグメント)
  function splitMinutes(total, focus) {
    const segs = [];
    let rest = Math.max(1, Math.round(total));
    while (rest > focus) {
      segs.push(focus);
      rest -= focus;
    }
    segs.push(rest);
    return segs;
  }

  // 休憩は集中時間の1/3が上限
  function allowedBreaks(focusMin) {
    return BREAK_OPTIONS.filter((b) => b <= focusMin / 3);
  }

  /* ---------- 日付ユーティリティ ---------- */
  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function todayKey() { return dateKey(new Date()); }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay()); // 日曜始まり
    return x;
  }

  function formatDeadline(iso) {
    if (!iso) return "なし";
    const d = new Date(iso);
    if (isNaN(d)) return "なし";
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  /* ---------- 時刻ユーティリティ(週/日ビューの時間割り当て用) ---------- */
  function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function minutesToTime(total) {
    const t = ((total % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }
  function addMinutesToTime(hhmm, addMin) {
    return minutesToTime(timeToMinutes(hhmm) + addMin);
  }

  load();

  return {
    IMPORTANCE, URGENCY_LABELS, FOCUS_OPTIONS, BREAK_OPTIONS, STAGE_LABELS, WEEKDAY_LABELS,
    CATEGORY_COLORS,
    addTask, updateTask, deleteTask, getTask, getTasks, splitTask,
    addEvent, updateEvent, updateEventFull, moveEvent, deleteEvent, toggleEventDone, getEvent, getEvents, eventOccursOnDate,
    addCategory, updateCategory, deleteCategory, getCategory, getCategories, matchesCategoryFilter,
    replaceTasks, replaceEvents, replaceCategories, replaceSettings,
    resolveDurationMinutes, durationLabel, setDuration, setEndTime, releaseOverdueTasks,
    urgencyOf, scoreOf, scoreRatio, effectiveScore, suggestImportance, suggestImportanceDetail,
    splitMinutes, allowedBreaks,
    dateKey, todayKey, addDays, startOfWeek, formatDeadline,
    timeToMinutes, minutesToTime, addMinutesToTime, timeOf,
    setRecurrence, clearRecurrence, occursOnDate, isDoneOn, toggleOccurrence, markDone,
    saveSession, loadSession,
    get settings() { return settings; },
    setSetting(key, value) { settings[key] = value; saveSettings(); },
  };
})();
