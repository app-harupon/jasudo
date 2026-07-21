/* ============================================================
 * timer.js — セグメントタイマー
 * 流れ: 確認(1分固定) → 集中 → 休憩 → … → 完了確認 → 再分割ループ
 * ============================================================ */
const Timer = (() => {
  const $ = (sel) => document.querySelector(sel);
  const OVERVIEW_SEC = 60;
  const RING_LEN = 2 * Math.PI * 88; // SVG円周

  const setupEl = $("#timer-setup");
  const runEl = $("#timer-run");
  const fabAdd = $("#fab-add");

  // 実行中は右下の「＋」を隠す(確認完了ボタンなどでカードが縦に伸びる場面があり、
  // 固定表示のFABが操作ボタンと重なってしまうため。集中中に新規追加を誘う必要もない)
  function setFabVisible(show) {
    fabAdd.classList.toggle("hidden", !show);
  }

  let session = null;   // { taskId, focusMin, breakMin, segments[], idx, phase, endsAt, paused, remainMs, memo }
  let interval = null;
  let phaseTotalMs = 0; // 現フェーズの総時間(リング用)
  let audioCtx = null;
  let wakeLock = null;
  let memoPersistTimer = null;

  /* ============================================================
   * バックグラウンド対応
   * ・Wake Lock: 実行中は画面をスリープさせない(取れなくても致命的ではない)
   * ・visibilitychange: タブ/アプリに戻ってきた瞬間に表示とWake Lockを即同期
   * ・Notification: バックグラウンド中にフェーズが切り替わったら通知する
   * ============================================================ */
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) { /* バッテリー節約モードなどで取得できなくても続行 */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (session && !session.paused && session.phase !== "check") requestWakeLock();
    tick(); // 戻ってきた瞬間に経過時間を即座に反映する(setIntervalの間隔を待たない)
  });

  function notifyPhase(phase) {
    if (!document.hidden) return; // 画面を見ているときはビープ音で十分
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const label = PHASE_INFO[phase] ? PHASE_INFO[phase].label : "";
    try {
      new Notification("Just do", {
        body: `${label}の時間になりました`,
        icon: "icons/icon-192.png",
        tag: "jasudo-timer",
      });
    } catch (e) { /* noop */ }
  }

  /* ============================================================
   * サウンド(WebAudio・素朴なビープ)
   * ============================================================ */
  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* 音なしで続行 */ }
  }
  // セッション復元後など「スタート」ボタンを押さないまま実行画面にいる場合でも、
  // 最初に画面に触れた瞬間に音を有効化しておく(ブラウザはユーザー操作なしに音を鳴らせないため)
  runEl.addEventListener("pointerdown", ensureAudio, { once: false });
  function beep(freq = 880, dur = 0.15, delay = 0) {
    if (!audioCtx) return;
    // ブラウザがバックグラウンド等で自動的にsuspendしていることがあるので、鳴らす直前に毎回確認する
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.28, audioCtx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + delay);
      o.stop(audioCtx.currentTime + delay + dur);
    } catch (e) { /* noop */ }
  }
  function beepFor(phase) {
    if (!Store.settings.soundEnabled) return;
    if (phase === "overview") beep(660, 0.12);
    else if (phase === "focus") { beep(880, 0.12); beep(880, 0.12, 0.2); }
    else if (phase === "break") beep(520, 0.25);
    else if (phase === "check") { beep(880, 0.12); beep(1040, 0.12, 0.18); beep(1320, 0.2, 0.36); }
  }

  /* ---------- サウンドON/OFF切り替え(セットアップ画面・実行画面の両方に表示) ---------- */
  function syncSoundUI() {
    const on = Store.settings.soundEnabled !== false;
    $("#t-sound").checked = on;
    const btn = $("#run-sound-toggle");
    btn.textContent = on ? "🔊" : "🔇";
    btn.classList.toggle("muted", !on);
  }
  function setSoundEnabled(on) {
    Store.setSetting("soundEnabled", on);
    if (on) ensureAudio(); // ONにした操作自体がユーザー操作なので、ここで音を有効化しておく
    syncSoundUI();
  }
  $("#t-sound").addEventListener("change", () => setSoundEnabled($("#t-sound").checked));
  $("#run-sound-toggle").addEventListener("click", () => setSoundEnabled(!(Store.settings.soundEnabled !== false)));

  /* ============================================================
   * セットアップ画面
   * ============================================================ */
  function renderSetup(preferTaskId = null) {
    setFabVisible(true);
    // タスク選択肢(未完了・優先度順)
    const sel = $("#t-task");
    const current = preferTaskId !== null ? preferTaskId : sel.value;
    sel.innerHTML = "";
    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "タスクなしで開始(フリー実行)";
    sel.appendChild(optNone);
    const todayKey = Store.todayKey();
    const today = new Date();
    Store.getTasks()
      .filter((t) => t.recurrence ? (Store.occursOnDate(t, today) && !Store.isDoneOn(t, todayKey)) : !t.done)
      .sort((a, b) => Store.effectiveScore(b) - Store.effectiveScore(a))
      .forEach((t) => {
        const o = document.createElement("option");
        o.value = t.id;
        o.textContent = `${t.recurrence ? "🔁 " : ""}${t.name}(${Store.durationLabel(t)})`;
        sel.appendChild(o);
      });
    if (current && Store.getTask(current)) sel.value = current;

    renderFocusButtons();
    renderBreakButtons();
    syncSoundUI();
    if (preferTaskId && Store.getTask(preferTaskId)) {
      $("#t-total").value = Store.getTask(preferTaskId).totalMinutes;
      $("#t-pomodoro-auto").checked = false; // 特定タスクを指名した場合は自動モードを解除
    }
    updatePreview();
    syncPomodoroAutoUI();
  }

  /* ---------- ポモドーロ自動振り分けモード ---------- */
  function syncPomodoroAutoUI() {
    const on = $("#t-pomodoro-auto").checked;
    $("#t-manual-fields").classList.toggle("hidden", on);
    $("#t-pomodoro-note").classList.toggle("hidden", !on);
  }
  $("#t-pomodoro-auto").addEventListener("change", syncPomodoroAutoUI);

  // 未完了タスクの中から優先度(重要度×緊急度)が一番高いものを選ぶ
  function findTopTask() {
    const today = new Date();
    const todayKey = Store.todayKey();
    return Store.getTasks()
      .filter((t) => t.recurrence ? (Store.occursOnDate(t, today) && !Store.isDoneOn(t, todayKey)) : !t.done)
      .sort((a, b) => Store.effectiveScore(b) - Store.effectiveScore(a))[0] || null;
  }
  // 現在のセッションに次のタスクを割り当てる(自動モード用)
  function pickAutoTask() {
    const top = findTopTask();
    session.taskId = top ? top.id : null;
    session.taskStartedAt = Date.now();
    return session.taskId;
  }

  function renderFocusButtons() {
    const box = $("#t-focus");
    box.innerHTML = "";
    Store.FOCUS_OPTIONS.forEach((min) => {
      const b = document.createElement("button");
      b.textContent = `${min}分`;
      b.classList.toggle("on", Store.settings.focusMin === min);
      b.addEventListener("click", () => {
        Store.setSetting("focusMin", min);
        // 休憩が上限超過なら自動で最大値へ丸める
        const allowed = Store.allowedBreaks(min);
        if (!allowed.includes(Store.settings.breakMin)) {
          Store.setSetting("breakMin", allowed[allowed.length - 1] || 0);
        }
        renderFocusButtons();
        renderBreakButtons();
        updatePreview();
      });
      box.appendChild(b);
    });
  }

  // 上限(集中の1/3)を超える選択肢はそもそも表示しない
  function renderBreakButtons() {
    const box = $("#t-break");
    box.innerHTML = "";
    Store.allowedBreaks(Store.settings.focusMin).forEach((min) => {
      const b = document.createElement("button");
      b.textContent = `${min}分`;
      b.classList.toggle("on", Store.settings.breakMin === min);
      b.addEventListener("click", () => {
        Store.setSetting("breakMin", min);
        renderBreakButtons();
      });
      box.appendChild(b);
    });
  }

  function updatePreview() {
    const total = Math.max(1, Number($("#t-total").value) || 0);
    const segs = Store.splitMinutes(total, Store.settings.focusMin);
    $("#t-preview").innerHTML =
      segs.map((m) => `<span class="seg-pill">${m}分</span>`).join('<span>+</span>') +
      `<span class="sub" style="width:100%">${segs.length}セグメント / 合計${total}分(各セグメント冒頭に確認1分)</span>`;
  }

  $("#t-total").addEventListener("input", updatePreview);
  $("#t-task").addEventListener("change", () => {
    const t = Store.getTask($("#t-task").value);
    if (t) $("#t-total").value = t.totalMinutes;
    updatePreview();
  });

  $("#t-start").addEventListener("click", () => {
    ensureAudio();
    // バックグラウンド中のフェーズ切り替えを通知できるよう、ここで許可を求めておく
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    if ($("#t-pomodoro-auto").checked) {
      startAuto();
      return;
    }
    const total = Math.max(1, Number($("#t-total").value) || 30);
    start({
      taskId: $("#t-task").value || null,
      focusMin: Store.settings.focusMin,
      breakMin: Store.settings.breakMin,
      totalMin: total,
    });
  });

  // マトリクス/カレンダーから「▶開始」で呼ばれる
  function setupFor(taskId) {
    if (session) {
      UI.toast("実行中のタイマーがあります");
      return;
    }
    renderSetup(taskId);
  }

  /* ============================================================
   * セッション制御
   * ============================================================ */
  function start(cfg) {
    session = {
      taskId: cfg.taskId,
      focusMin: cfg.focusMin,
      breakMin: cfg.breakMin,
      segments: Store.splitMinutes(cfg.totalMin, cfg.focusMin),
      idx: 0,
      phase: null,
      endsAt: 0,
      paused: false,
      remainMs: 0,
      memo: "",
      taskStartedAt: Date.now(), // 実績をカレンダーに自動記録するための開始時刻
    };
    setupEl.classList.add("hidden");
    runEl.classList.remove("hidden");
    setFabVisible(false);
    requestWakeLock();
    enterPhase("overview");
  }

  // ポモドーロ自動振り分けモード:優先度1位のタスクを自動で選び、25分集中/5分休憩を繰り返す
  function startAuto() {
    const top = findTopTask();
    if (!top) { UI.toast("やることリストにタスクがありません"); return; }
    session = {
      taskId: top.id,
      focusMin: 25,
      breakMin: 5,
      segments: [25],
      idx: 0,
      phase: null,
      endsAt: 0,
      paused: false,
      remainMs: 0,
      memo: "",
      taskStartedAt: Date.now(),
      pomodoroAuto: true,
      cycleCount: 0,
    };
    setupEl.classList.add("hidden");
    runEl.classList.remove("hidden");
    setFabVisible(false);
    requestWakeLock();
    enterPhase("overview");
  }

  function phaseDurationMs(phase) {
    if (phase === "overview") return OVERVIEW_SEC * 1000;
    if (phase === "focus") return session.segments[session.idx] * 60000;
    if (phase === "break") return session.breakMin * 60000;
    return 0;
  }

  function enterPhase(phase, { silent = false } = {}) {
    session.phase = phase;
    phaseTotalMs = phaseDurationMs(phase);
    session.endsAt = Date.now() + phaseTotalMs;
    session.paused = false;
    session.remainMs = 0;
    if (phase === "overview") session.memo = ""; // メモは都度上書き(蓄積しない)
    persist();
    renderRun();
    startTick();
    if (!silent) { beepFor(phase); notifyPhase(phase); }
    if (phase === "overview") {
      const memoInput = $("#run-memo");
      memoInput.value = "";
      updateMemoCount();
      setTimeout(() => memoInput.focus(), 100);
    }
  }

  function advance() {
    if (session.pomodoroAuto) return advanceAuto();
    if (session.phase === "overview") {
      enterPhase("focus");
    } else if (session.phase === "focus") {
      if (session.idx >= session.segments.length - 1) {
        showCheck(); // 最終セグメント終了 → 完了確認
      } else if (session.breakMin > 0) {
        enterPhase("break");
      } else {
        session.idx++;
        enterPhase("overview");
      }
    } else if (session.phase === "break") {
      session.idx++;
      enterPhase("overview");
    }
  }

  // 自動モードでは「このタスクの合計時間を使い切ったか」ではなく、
  // 25分集中→休憩を淡々と繰り返し、完了はユーザーが「✔完了」を押した時点で判断する
  function advanceAuto() {
    if (session.phase === "overview") {
      enterPhase("focus");
    } else if (session.phase === "focus") {
      session.cycleCount++;
      session.breakMin = (session.cycleCount % 4 === 0) ? 20 : 5;
      enterPhase("break");
    } else if (session.phase === "break") {
      if (!pickAutoTask()) {
        endSession();
        UI.toast("やることリストのタスクがすべて終わりました 🎉");
        return;
      }
      enterPhase("overview");
    }
  }

  /* ---------- tick ---------- */
  function startTick() {
    stopTick();
    interval = setInterval(tick, 250);
    tick();
  }
  function stopTick() {
    if (interval) { clearInterval(interval); interval = null; }
  }
  function tick() {
    if (!session || session.paused || session.phase === "check") return;
    const remain = session.endsAt - Date.now();
    if (remain <= 0) {
      advance();
    } else {
      updateClock(remain);
    }
  }

  /* ---------- 一時停止・再開・中止 ---------- */
  function togglePause() {
    if (!session || session.phase === "check") return;
    ensureAudio(); // 再開したセッション(復元直後など)ではまだ音が用意されていないことがあるため
    if (session.paused) {
      session.endsAt = Date.now() + session.remainMs;
      session.paused = false;
      startTick();
      requestWakeLock();
    } else {
      session.remainMs = Math.max(0, session.endsAt - Date.now());
      session.paused = true;
      stopTick();
      releaseWakeLock();
    }
    persist();
    renderRun();
  }

  function abort() {
    if (!confirm("タイマーを中止しますか?(タスクは残ります)")) return;
    endSession();
    UI.toast("中止しました");
  }

  // タスクを完了として即座に終える(セグメント途中でも「もう終わった」と判断したとき用)
  function completeNow() {
    if (!session) return;
    if (!confirm("このタスクを完了にしますか?")) return;
    if (session.taskId) Store.markDone(session.taskId, Store.todayKey());
    logWorkedTime();
    App.refresh();
    if (session.pomodoroAuto) {
      if (!pickAutoTask()) {
        endSession();
        UI.toast("やることリストのタスクがすべて終わりました 🎉");
        return;
      }
      UI.toast("おつかれさま!次のタスクに移ります 🎉");
      enterPhase("overview");
      return;
    }
    endSession();
    UI.toast("おつかれさま!タスク完了 🎉");
  }

  // 現在のフェーズを延長する(タスクの合計所要時間の1/3。タスク未選択時は現セグメント長の1/3)
  function extend() {
    if (!session || session.phase === "check") return;
    const task = session.taskId ? Store.getTask(session.taskId) : null;
    const baseMinutes = task ? task.totalMinutes : (session.segments[session.idx] || session.focusMin);
    const extendMin = Math.max(1, Math.round(baseMinutes / 3));
    const extendMs = extendMin * 60000;
    if (session.paused) session.remainMs += extendMs;
    else session.endsAt += extendMs;
    phaseTotalMs += extendMs; // リングの基準も伸ばす(残り時間が100%を超えて表示が壊れないように)
    persist();
    renderRun();
    UI.toast(`${extendMin}分延長しました`);
  }

  // 実際に作業していた時間帯(開始〜今)を、そのタスクの実績としてカレンダーに自動で残す
  function logWorkedTime() {
    if (!session || !session.taskId || !session.taskStartedAt) return;
    const task = Store.getTask(session.taskId);
    if (!task) return;
    const start = new Date(session.taskStartedAt);
    const elapsedMin = Math.max(1, Math.round((Date.now() - session.taskStartedAt) / 60000));
    const time = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
    Store.addEvent({
      title: `🕐 ${task.name}`,
      date: Store.dateKey(start),
      time,
      minutes: elapsedMin,
      categoryId: task.categoryId,
      memo: "タイマーでの実績を自動記録しました",
    });
  }

  function endSession() {
    stopTick();
    releaseWakeLock();
    session = null;
    Store.saveSession(null);
    UI.closeModal();
    runEl.classList.add("hidden");
    setupEl.classList.remove("hidden");
    renderSetup();
  }

  /* ============================================================
   * 完了確認 → 再分割ループ
   * ============================================================ */
  function showCheck() {
    session.phase = "check";
    stopTick();
    persist();
    renderRun();
    beepFor("check");
    $("#check-remain").classList.add("hidden");
    $("#check-minutes").value = Math.min(15, session.focusMin);
    UI.openModal($("#modal-check"), { persistent: true });
  }

  $("#check-done").addEventListener("click", () => {
    if (session && session.taskId) {
      Store.markDone(session.taskId, Store.todayKey());
    }
    logWorkedTime();
    endSession();
    UI.toast("おつかれさま!タスク完了 🎉");
    App.refresh();
  });

  $("#check-notyet").addEventListener("click", () => {
    $("#check-remain").classList.remove("hidden");
    updateCheckPreview();
    $("#check-minutes").focus();
  });

  function updateCheckPreview() {
    const remain = Math.max(1, Number($("#check-minutes").value) || 0);
    const segs = Store.splitMinutes(remain, session.focusMin);
    $("#check-preview").innerHTML =
      segs.map((m) => `<span class="seg-pill">${m}分</span>`).join('<span>+</span>');
  }
  $("#check-minutes").addEventListener("input", updateCheckPreview);

  $("#check-continue").addEventListener("click", () => {
    const remain = Math.max(1, Number($("#check-minutes").value) || 15);
    // 残り時間を同じ集中時間単位で自動再分割してセグメント追加
    session.segments = session.segments.concat(Store.splitMinutes(remain, session.focusMin));
    session.idx++;
    UI.closeModal();
    enterPhase("overview"); // 確認タイムから自動で継続
  });

  /* ============================================================
   * 実行画面の描画
   * ============================================================ */
  const PHASE_INFO = {
    overview: { label: "確認", cls: "phase-overview" },
    focus:    { label: "集中", cls: "phase-focus" },
    break:    { label: "休憩", cls: "phase-break" },
    check:    { label: "確認", cls: "phase-focus" },
  };

  function renderRun() {
    if (!session) return;
    syncSoundUI();
    const info = PHASE_INFO[session.phase];
    runEl.classList.remove("phase-overview", "phase-focus", "phase-break");
    runEl.classList.add(info.cls);
    $("#run-phase").textContent = session.paused ? "一時停止中" : info.label;

    const task = session.taskId ? Store.getTask(session.taskId) : null;
    $("#run-task-name").textContent = task ? task.name : "フリー実行";

    $("#run-sub").textContent = session.pomodoroAuto
      ? `🍅 サイクル${session.cycleCount + 1}(次の休憩${(session.cycleCount + 1) % 4 === 0 ? "20" : "5"}分)`
      : `セグメント ${Math.min(session.idx + 1, session.segments.length)}/${session.segments.length}(${session.segments[session.idx]}分)`;

    // 確認タイム中だけメモ入力を表示
    $("#run-overview-box").classList.toggle("hidden", session.phase !== "overview");
    $("#run-memo-view").textContent =
      session.phase === "focus" && session.memo ? `▶ ${session.memo}` : "";

    // セグメントドット(自動モードは1タスクの固定分割ではないため非表示)
    const dots = $("#run-dots");
    dots.innerHTML = "";
    dots.classList.toggle("hidden", !!session.pomodoroAuto);
    if (!session.pomodoroAuto) {
      session.segments.forEach((m, i) => {
        const d = document.createElement("div");
        d.className = "dot" + (i < session.idx ? " done" : i === session.idx ? " now" : "");
        d.title = `${m}分`;
        dots.appendChild(d);
      });
    }

    $("#run-pause").textContent = session.paused ? "▶ 再開" : "⏸ 一時停止";
    // 完了確認モーダル表示中は、下の操作ボタンは無効化しておく(check-done/check-notyetで進める)
    const inCheck = session.phase === "check";
    $("#run-pause").disabled = inCheck;
    $("#run-extend").disabled = inCheck;
    $("#run-complete").disabled = inCheck;

    const remain = session.paused
      ? session.remainMs
      : Math.max(0, session.endsAt - Date.now());
    updateClock(remain);
  }

  function updateClock(remainMs) {
    const sec = Math.ceil(remainMs / 1000);
    $("#run-time").textContent =
      `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
    const ratio = phaseTotalMs > 0 ? remainMs / phaseTotalMs : 0;
    $("#ring-fg").style.strokeDashoffset = String(RING_LEN * (1 - ratio));
  }

  /* ---------- 確認メモ(24文字制限・都度上書き) ---------- */
  const MEMO_MAX = 24;
  function updateMemoCount() {
    const v = $("#run-memo").value;
    const el = $("#memo-count");
    el.textContent = `${v.length}/${MEMO_MAX}`;
    el.classList.toggle("limit", v.length >= MEMO_MAX);
  }
  $("#run-memo").addEventListener("input", () => {
    if (!session) return;
    session.memo = $("#run-memo").value;
    updateMemoCount();
    // 入力の途中経過も少し待ってから保存しておく(タブを閉じても消えないように)
    clearTimeout(memoPersistTimer);
    memoPersistTimer = setTimeout(persist, 400);
  });

  $("#run-pause").addEventListener("click", togglePause);
  $("#run-extend").addEventListener("click", extend);
  $("#run-complete").addEventListener("click", completeNow);
  $("#run-abort").addEventListener("click", abort);
  // 確認(1分の待ち時間)を待たず、すぐに集中フェーズへ進みたい人向け
  $("#run-confirm-done").addEventListener("click", () => {
    if (!session || session.phase !== "overview") return;
    advance();
  });

  /* ============================================================
   * 復元(リロード対応)
   * ============================================================ */
  function persist() {
    if (!session) return;
    const snap = Object.assign({}, session);
    if (!snap.paused && snap.phase !== "check") {
      snap.remainMs = Math.max(0, snap.endsAt - Date.now());
    }
    Store.saveSession(snap);
  }

  function restore() {
    const snap = Store.loadSession();
    if (!snap || !Array.isArray(snap.segments)) return false;
    session = snap;
    setupEl.classList.add("hidden");
    runEl.classList.remove("hidden");
    setFabVisible(false);
    if (session.phase === "check") {
      phaseTotalMs = 0;
      renderRun();
      $("#check-remain").classList.add("hidden");
      UI.openModal($("#modal-check"), { persistent: true });
    } else {
      // 実行中に閉じられていた場合は一時停止状態で復元(勝手に進めない)
      phaseTotalMs = phaseDurationMs(session.phase);
      session.paused = true;
      session.remainMs = Math.max(1000, Math.min(session.remainMs, phaseTotalMs));
      renderRun();
      if (session.phase === "overview") {
        $("#run-memo").value = session.memo || "";
        updateMemoCount();
      }
    }
    return true;
  }

  function isRunning() { return !!session; }

  return { renderSetup, setupFor, restore, isRunning };
})();
