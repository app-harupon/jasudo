/* ============================================================
 * ui.js — モーダル・タスクフォーム・詳細・トースト
 * ============================================================ */
const UI = (() => {
  const $ = (sel) => document.querySelector(sel);

  const backdrop = $("#modal-backdrop");
  let openModalEl = null;

  /* ---------- モーダル開閉 ---------- */
  function openModal(el, opts = {}) {
    closeModal();
    openModalEl = el;
    el.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    backdrop.onclick = opts.persistent ? null : closeModal;
  }
  function closeModal() {
    if (openModalEl) openModalEl.classList.add("hidden");
    openModalEl = null;
    backdrop.classList.add("hidden");
    backdrop.onclick = null;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openModalEl && backdrop.onclick) closeModal();
  });

  /* ---------- トースト ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  /* ============================================================
   * タスクフォーム(追加・編集)
   * ============================================================ */
  const modalTask = $("#modal-task");
  let editingId = null;         // 編集中タスクid(null = 新規)
  let selectedImp = "mid";      // 選択中の重要度
  let selectedStage = "mid";    // 選択中の段階
  let selectedDurationType = "fixed"; // fixed | unknown | vague
  let selectedCategoryId = null; // 選択中のカテゴリ
  let userOverrode = false;     // 提案をユーザーが上書きしたか

  function openTaskForm(task = null) {
    editingId = task ? task.id : null;
    userOverrode = !!task; // 既存タスクは現状の重要度を尊重
    $("#task-form-title").textContent = task ? "タスクを編集" : "タスクを追加";
    $("#f-name").value = task ? task.name : "";
    $("#f-deadline").value = task && task.deadline ? task.deadline.slice(0, 16) : "";
    selectedDurationType = task ? (task.durationType || "fixed") : "fixed";
    $("#f-total").value = task ? task.totalMinutes : 30;
    $("#f-total-min").value = task && task.durationMin ? task.durationMin : 60;
    $("#f-total-max").value = task && task.durationMax ? task.durationMax : 120;
    $("#f-semiauto").checked = Store.settings.semiAuto;
    selectedImp = task ? task.importance : "mid";
    selectedStage = task ? (task.stage || "mid") : "mid";
    selectedCategoryId = task ? (task.categoryId || null) : null;
    syncStageRow();
    renderDurationTypeButtons();
    syncDurationRows();
    renderImpButtons();
    renderStageButtons();
    renderCategoryPicker();
    updateImportanceDesc();
    updateUrgencyNote();
    updateSuggestion();
    openModal(modalTask);
    setTimeout(() => $("#f-name").focus(), 50);
  }

  function syncStageRow() {
    $("#f-stage-row").classList.toggle("hidden", !$("#f-semiauto").checked);
  }

  function renderCategoryPicker() {
    Categories.renderPicker($("#f-category"), selectedCategoryId, (id) => {
      selectedCategoryId = id;
      renderCategoryPicker();
    });
  }

  function renderDurationTypeButtons() {
    modalTask.querySelectorAll("#f-duration-type button").forEach((b) => {
      b.classList.toggle("on", b.dataset.dt === selectedDurationType);
    });
  }
  function syncDurationRows() {
    $("#f-total-row").classList.toggle("hidden", selectedDurationType !== "fixed");
    $("#f-vague-row").classList.toggle("hidden", selectedDurationType !== "vague");
    $("#f-unknown-row").classList.toggle("hidden", selectedDurationType !== "unknown");
  }
  // フォーム上の入力から「今選んでいる合計所要時間(分)」を解決する(不明/不明瞭も含めて実数値化)
  function getFormDurationMinutes() {
    return Store.resolveDurationMinutes(
      selectedDurationType,
      $("#f-total").value,
      $("#f-total-min").value,
      $("#f-total-max").value
    );
  }
  modalTask.querySelectorAll("#f-duration-type button").forEach((b) => {
    b.addEventListener("click", () => {
      selectedDurationType = b.dataset.dt;
      renderDurationTypeButtons();
      syncDurationRows();
      updateSuggestion();
    });
  });
  $("#f-total-min").addEventListener("input", updateSuggestion);
  $("#f-total-max").addEventListener("input", updateSuggestion);

  function renderImpButtons(suggested = null) {
    modalTask.querySelectorAll("#f-importance button").forEach((b) => {
      b.classList.toggle("on", b.dataset.imp === selectedImp);
      b.classList.toggle("suggested", suggested !== null && b.dataset.imp === suggested);
    });
  }
  function renderStageButtons() {
    modalTask.querySelectorAll("#f-stage button").forEach((b) => {
      b.classList.toggle("on", b.dataset.stage === selectedStage);
    });
  }

  // 選択中の重要度の判断基準・具体例を表示(数値ではなく言葉で判断してもらう)
  function updateImportanceDesc() {
    const info = Store.IMPORTANCE[selectedImp];
    $("#f-importance-desc").innerHTML = `
      <div class="imp-desc-title">${info.label}: ${info.desc}</div>
      <ul>${info.examples.map((ex) => `<li>${escapeHtml(ex)}</li>`).join("")}</ul>
    `;
  }

  function updateUrgencyNote() {
    const dl = $("#f-deadline").value;
    const u = Store.urgencyOf(dl || null);
    $("#f-urgency-note").textContent = `緊急度: ${Store.URGENCY_LABELS[u]} — 締切から自動判定`;
  }

  // 半自動モード:提案を計算して反映(ユーザー上書きが優先)
  function updateSuggestion() {
    const semiAuto = $("#f-semiauto").checked;
    const note = $("#f-suggest-note");
    if (!semiAuto) {
      note.textContent = "";
      renderImpButtons(null);
      return;
    }
    const suggested = Store.suggestImportance({
      deadline: $("#f-deadline").value || null,
      totalMinutes: getFormDurationMinutes(),
      stage: selectedStage,
    });
    if (!userOverrode) selectedImp = suggested;
    note.textContent = `提案: ${Store.IMPORTANCE[suggested].label}(タップで上書きできます)`;
    renderImpButtons(suggested);
    updateImportanceDesc();
  }

  /* --- フォームイベント --- */
  $("#f-semiauto").addEventListener("change", () => {
    Store.setSetting("semiAuto", $("#f-semiauto").checked);
    userOverrode = false;
    syncStageRow();
    updateSuggestion();
  });
  $("#f-deadline").addEventListener("input", () => { updateUrgencyNote(); updateSuggestion(); });
  $("#f-total").addEventListener("input", updateSuggestion);

  modalTask.querySelectorAll("#f-importance button").forEach((b) => {
    b.addEventListener("click", () => {
      selectedImp = b.dataset.imp;
      userOverrode = true;
      renderImpButtons($("#f-semiauto").checked
        ? Store.suggestImportance({
            deadline: $("#f-deadline").value || null,
            totalMinutes: getFormDurationMinutes(),
            stage: selectedStage,
          })
        : null);
      updateImportanceDesc();
    });
  });
  modalTask.querySelectorAll("#f-stage button").forEach((b) => {
    b.addEventListener("click", () => {
      selectedStage = b.dataset.stage;
      renderStageButtons();
      updateSuggestion();
    });
  });

  $("#f-cancel").addEventListener("click", closeModal);
  $("#f-save").addEventListener("click", () => {
    const name = $("#f-name").value.trim();
    if (!name) { toast("タスク名を入力してください"); return; }
    const data = {
      name,
      deadline: $("#f-deadline").value || null,
      durationType: selectedDurationType,
      totalMinutes: getFormDurationMinutes(),
      durationMin: selectedDurationType === "vague" ? Math.max(1, Number($("#f-total-min").value) || 60) : null,
      durationMax: selectedDurationType === "vague" ? Math.max(Number($("#f-total-min").value) || 60, Number($("#f-total-max").value) || 120) : null,
      importance: selectedImp,
      stage: selectedStage,
      categoryId: selectedCategoryId,
    };
    if (editingId) {
      Store.updateTask(editingId, data);
      toast("更新しました");
    } else {
      Store.addTask(data);
      toast("追加しました");
    }
    closeModal();
    App.refresh();
  });

  /* ============================================================
   * タスク詳細モーダル
   * ============================================================ */
  const modalDetail = $("#modal-detail");

  function openTaskDetail(id) {
    const t = Store.getTask(id);
    if (!t) return;
    const today = Store.todayKey();
    const doneNow = Store.isDoneOn(t, today);
    const u = Store.urgencyOf(t.deadline);

    const badges = [`<span class="badge imp-${t.importance}">重要度: ${Store.IMPORTANCE[t.importance].label}</span>`];
    if (t.categoryId) badges.push(Categories.badge(t.categoryId));
    if (t.recurrence) {
      const wdLabel = t.recurrence.weekdays.map((w) => Store.WEEKDAY_LABELS[w]).join("・");
      badges.push(`<span class="badge recur">🔁 定時: ${wdLabel} ${t.recurrence.time}</span>`);
    } else {
      badges.push(`<span class="badge urg">緊急度: ${Store.URGENCY_LABELS[u]}</span>`);
    }
    if (doneNow) badges.push(`<span class="badge">✔ ${t.recurrence ? "今日は完了" : "完了"}</span>`);

    modalDetail.innerHTML = `
      <h2>${escapeHtml(t.name)}</h2>
      <div class="detail-badges">${badges.join("")}</div>
      <div class="detail-row"><span class="k">締切</span><span>${Store.formatDeadline(t.deadline)}</span></div>
      <div class="detail-row">
        <span class="k">合計所要時間</span>
        <span class="duration-edit-row">
          <span class="badge">${Store.durationLabel(t)}</span>
          <button id="d-duration-btn" class="ghost-btn">変更</button>
        </span>
      </div>
      ${t.recurrence ? "" : `
        <div class="detail-row">
          <span class="k">実行日</span>
          <input type="date" id="d-date" value="${t.scheduledDate || ""}">
        </div>
        <div class="toggle-row">
          <span>終日</span>
          <label class="switch"><input id="d-allday" type="checkbox" ${t.scheduledTime ? "" : "checked"}><span class="slider"></span></label>
        </div>
        <div id="d-time-row" class="${t.scheduledTime ? "" : "hidden"}">
          <div class="detail-row">
            <span class="k">開始時刻</span>
            <input type="time" id="d-time" step="300" value="${t.scheduledTime || ""}" ${t.scheduledDate ? "" : "disabled"}>
          </div>
          <div class="detail-row">
            <span class="k">終了時刻</span>
            <input type="time" id="d-end-time" step="300" value="${t.scheduledTime ? Store.addMinutesToTime(t.scheduledTime, t.totalMinutes) : ""}" ${t.scheduledTime ? "" : "disabled"}>
          </div>
        </div>
      `}
      <div class="detail-actions">
        ${doneNow ? "" : '<button id="d-start" class="primary big">▶ タイマーで開始</button>'}
        <div class="row2">
          <button id="d-edit" class="ghost-btn">編集</button>
          <button id="d-toggle-done" class="ghost-btn">${doneNow ? "未完了に戻す" : "完了にする"}</button>
          <button id="d-delete" class="danger-ghost">削除</button>
        </div>
        <div class="row2">
          ${t.recurrence ? "" : '<button id="d-split" class="ghost-btn">✂ 分割する</button>'}
          <button id="d-recur" class="ghost-btn">🔁 ${t.recurrence ? "定時設定を編集" : "定時タスクにする"}</button>
        </div>
        ${t.recurrence ? '<button id="d-recur-clear" class="danger-ghost">定時化を解除</button>' : ""}
      </div>
      <div id="d-duration-box" class="inline-box hidden">
        <label class="field-label">合計所要時間</label>
        <div class="seg" id="d-duration-type">
          <button data-dt="fixed">時間を指定</button>
          <button data-dt="unknown">不明</button>
          <button data-dt="vague">不明瞭</button>
        </div>
        <div id="d-total-row">
          <input id="d-total" type="number" min="1" step="5" value="${t.durationType === "fixed" ? t.totalMinutes : 30}">
        </div>
        <div id="d-vague-row" class="hidden">
          <div class="vague-range-row">
            <input id="d-total-min" type="number" min="1" step="5" value="${t.durationMin || 60}">
            <span>分 〜</span>
            <input id="d-total-max" type="number" min="1" step="5" value="${t.durationMax || 120}">
            <span>分</span>
          </div>
        </div>
        <button id="d-duration-confirm" class="primary">この内容に変更する</button>
      </div>
      ${t.recurrence ? "" : `
        <div id="d-split-box" class="inline-box hidden">
          <label class="field-label">何分ずつに分ける?</label>
          <input id="d-split-min" type="number" min="5" step="5" value="${Store.settings.focusMin}">
          <div id="d-split-preview" class="preview"></div>
          <button id="d-split-confirm" class="primary">この単位で分割する</button>
        </div>
      `}
      <div id="d-recur-box" class="inline-box hidden">
        <label class="field-label">曜日(複数選択可)</label>
        <div class="seg wd-seg" id="d-recur-wd">
          ${Store.WEEKDAY_LABELS.map((w, i) => `<button data-wd="${i}">${w}</button>`).join("")}
        </div>
        <label class="field-label">時刻</label>
        <input id="d-recur-time" type="time" step="300" value="${t.recurrence ? t.recurrence.time : "09:00"}">
        <button id="d-recur-confirm" class="primary">この内容で定時タスクにする</button>
      </div>
    `;
    openModal(modalDetail);

    const dateInput = modalDetail.querySelector("#d-date");
    if (dateInput) dateInput.addEventListener("change", (e) => {
      const newDate = e.target.value || null;
      const patch = { scheduledDate: newDate };
      if (!newDate) patch.scheduledTime = null; // 日付を外したら時刻も外す
      Store.updateTask(id, patch);
      toast(newDate ? "実行日を設定しました" : "実行日を外しました");
      App.refresh();
      openTaskDetail(id);
    });
    // 終日:ONにすると時刻欄を隠し、時刻が入っていれば外す(予定の「終日」と同じ考え方)
    const alldayCheckbox = modalDetail.querySelector("#d-allday");
    if (alldayCheckbox) alldayCheckbox.addEventListener("change", (e) => {
      const isAllDay = e.target.checked;
      modalDetail.querySelector("#d-time-row").classList.toggle("hidden", isAllDay);
      if (isAllDay && t.scheduledTime) {
        Store.updateTask(id, { scheduledTime: null });
        toast("終日に設定しました");
        App.refresh();
        openTaskDetail(id);
      }
    });
    const timeInput = modalDetail.querySelector("#d-time");
    if (timeInput) timeInput.addEventListener("change", (e) => {
      const newTime = e.target.value || null;
      const patch = { scheduledTime: newTime };
      if (newTime && !t.scheduledDate) patch.scheduledDate = Store.todayKey(); // 時刻だけ設定したら実行日は今日に
      Store.updateTask(id, patch);
      toast(newTime ? `${newTime} に設定しました` : "時刻を外しました");
      App.refresh();
      openTaskDetail(id);
    });
    // 終了時刻を直接指定すると、開始時刻はそのままに合計所要時間を逆算する
    const endTimeInput = modalDetail.querySelector("#d-end-time");
    if (endTimeInput) endTimeInput.addEventListener("change", (e) => {
      const newEnd = e.target.value;
      if (!newEnd) return;
      const updated = Store.setEndTime(id, newEnd);
      if (updated) {
        toast(`終了時刻を ${newEnd} に設定しました(${updated.totalMinutes}分)`);
        App.refresh();
        openTaskDetail(id);
      }
    });
    const startBtn = modalDetail.querySelector("#d-start");
    if (startBtn) startBtn.addEventListener("click", () => {
      closeModal();
      Timer.setupFor(id);
      App.switchView("timer");
    });
    modalDetail.querySelector("#d-edit").addEventListener("click", () => openTaskForm(t));
    modalDetail.querySelector("#d-toggle-done").addEventListener("click", () => {
      Store.toggleOccurrence(id, today);
      toast(doneNow ? "未完了に戻しました" : "完了にしました");
      closeModal();
      App.refresh();
    });
    modalDetail.querySelector("#d-delete").addEventListener("click", () => {
      if (!confirm(`「${t.name}」を削除しますか?`)) return;
      Store.deleteTask(id);
      toast("削除しました");
      closeModal();
      App.refresh();
    });

    /* ---- 分割 ---- */
    const splitBox = modalDetail.querySelector("#d-split-box");
    const splitBtn = modalDetail.querySelector("#d-split");
    if (splitBtn && splitBox) {
      const splitMinInput = modalDetail.querySelector("#d-split-min");
      const splitPreview = modalDetail.querySelector("#d-split-preview");
      const updateSplitPreview = () => {
        const chunk = Math.max(5, Number(splitMinInput.value) || 5);
        const segs = Store.splitMinutes(t.totalMinutes, chunk);
        splitPreview.innerHTML = segs.length < 2
          ? '<span class="sub">これ以上分割されません</span>'
          : segs.map((m) => `<span class="seg-pill">${m}分</span>`).join("<span>+</span>");
      };
      updateSplitPreview();
      splitMinInput.addEventListener("input", updateSplitPreview);
      splitBtn.addEventListener("click", () => {
        modalDetail.querySelector("#d-recur-box").classList.add("hidden");
        modalDetail.querySelector("#d-duration-box").classList.add("hidden");
        splitBox.classList.toggle("hidden");
      });
      modalDetail.querySelector("#d-split-confirm").addEventListener("click", () => {
        const chunk = Math.max(5, Number(splitMinInput.value) || 5);
        const pieces = Store.splitTask(id, chunk);
        if (pieces.length < 2) {
          toast("合計時間より短い値にしてください");
          return;
        }
        toast(`${pieces.length}個のタスクに分割しました`);
        closeModal();
        App.refresh();
      });
    }

    /* ---- 定時化 ---- */
    const recurBox = modalDetail.querySelector("#d-recur-box");
    const selectedWd = new Set(t.recurrence ? t.recurrence.weekdays : [new Date().getDay()]);
    const renderWdButtons = () => {
      recurBox.querySelectorAll("#d-recur-wd button").forEach((b) => {
        b.classList.toggle("on", selectedWd.has(Number(b.dataset.wd)));
      });
    };
    renderWdButtons();
    recurBox.querySelectorAll("#d-recur-wd button").forEach((b) => {
      b.addEventListener("click", () => {
        const wd = Number(b.dataset.wd);
        if (selectedWd.has(wd)) selectedWd.delete(wd);
        else selectedWd.add(wd);
        renderWdButtons();
      });
    });
    modalDetail.querySelector("#d-recur").addEventListener("click", () => {
      if (splitBox) splitBox.classList.add("hidden");
      modalDetail.querySelector("#d-duration-box").classList.add("hidden");
      recurBox.classList.toggle("hidden");
    });
    modalDetail.querySelector("#d-recur-confirm").addEventListener("click", () => {
      if (selectedWd.size === 0) { toast("曜日を選んでください"); return; }
      const time = modalDetail.querySelector("#d-recur-time").value || "09:00";
      Store.setRecurrence(id, Array.from(selectedWd), time);
      toast("定時タスクにしました");
      closeModal();
      App.refresh();
    });
    const recurClearBtn = modalDetail.querySelector("#d-recur-clear");
    if (recurClearBtn) recurClearBtn.addEventListener("click", () => {
      if (!confirm("定時化を解除しますか?")) return;
      Store.clearRecurrence(id);
      toast("定時化を解除しました");
      closeModal();
      App.refresh();
    });

    /* ---- 所要時間の変更(固定/不明/不明瞭) ---- */
    const durationBox = modalDetail.querySelector("#d-duration-box");
    let selectedDetailDurationType = t.durationType || "fixed";
    const renderDetailDurationButtons = () => {
      durationBox.querySelectorAll("#d-duration-type button").forEach((b) => {
        b.classList.toggle("on", b.dataset.dt === selectedDetailDurationType);
      });
      durationBox.querySelector("#d-total-row").classList.toggle("hidden", selectedDetailDurationType !== "fixed");
      durationBox.querySelector("#d-vague-row").classList.toggle("hidden", selectedDetailDurationType !== "vague");
    };
    renderDetailDurationButtons();
    durationBox.querySelectorAll("#d-duration-type button").forEach((b) => {
      b.addEventListener("click", () => {
        selectedDetailDurationType = b.dataset.dt;
        renderDetailDurationButtons();
      });
    });
    modalDetail.querySelector("#d-duration-btn").addEventListener("click", () => {
      if (splitBox) splitBox.classList.add("hidden");
      recurBox.classList.add("hidden");
      durationBox.classList.toggle("hidden");
    });
    modalDetail.querySelector("#d-duration-confirm").addEventListener("click", () => {
      Store.setDuration(id, selectedDetailDurationType, {
        minutes: modalDetail.querySelector("#d-total").value,
        rangeMin: modalDetail.querySelector("#d-total-min").value,
        rangeMax: modalDetail.querySelector("#d-total-max").value,
      });
      toast("所要時間を変更しました");
      App.refresh();
      openTaskDetail(id);
    });
  }

  /* ---------- 共通:定時タスクを考慮した「その日の状態」を解決 ---------- */
  function resolveOccurrence(task, dateCtx) {
    const isRecurring = !!task.recurrence;
    return {
      time: Store.timeOf(task),
      doneOn: isRecurring ? Store.isDoneOn(task, dateCtx) : task.done,
      isRecurring,
    };
  }

  /* ---------- 共通:タスクチップ生成(カレンダー用・小さい表示) ---------- */
  function makeChip(task, { showTime = false, dateCtx = null } = {}) {
    const ctx = dateCtx || Store.todayKey();
    const { time, doneOn, isRecurring } = resolveOccurrence(task, ctx);
    const chip = document.createElement("div");
    chip.className = "chip" + (doneOn ? " done" : "") + (isRecurring ? " recurring" : "");
    chip.draggable = !isRecurring && !doneOn;
    chip.dataset.id = task.id;
    if (task.categoryId) chip.style.cssText += Categories.borderStyle(task.categoryId);
    const label = (doneOn ? "✅ " : isRecurring ? "🔁 " : "") + (showTime && time ? `${time} ${task.name}` : task.name);
    chip.textContent = label;
    chip.title = label;
    chip.addEventListener("click", () => openTaskDetail(task.id));
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", `t:${task.id}`);
      e.dataTransfer.effectAllowed = "move";
    });
    return chip;
  }

  /* ---------- 共通:やることリスト行(優先度順・数値は出さない) ---------- */
  function makeListItem(task, { rank = null, tag = null, dateCtx = null } = {}) {
    const ctx = dateCtx || Store.todayKey();
    const { time, doneOn, isRecurring } = resolveOccurrence(task, ctx);
    const row = document.createElement("div");
    row.className = "todo-item" + (doneOn ? " done" : "");
    row.draggable = !isRecurring && !doneOn;
    row.dataset.id = task.id;

    const u = (!isRecurring && task.deadline) ? Store.urgencyOf(task.deadline) : null;
    const impLabel = Store.IMPORTANCE[task.importance].label;

    let scheduleBadge;
    if (isRecurring) {
      scheduleBadge = `<span class="badge recur">🔁 定時 ${time}〜${Store.addMinutesToTime(time, task.totalMinutes)}</span>`;
    } else if (time) {
      scheduleBadge = `<span class="badge time">${time}〜${Store.addMinutesToTime(time, task.totalMinutes)}</span>`;
    } else {
      scheduleBadge = `<span class="badge min">${Store.durationLabel(task)}</span>`;
    }

    row.innerHTML = `
      ${rank !== null ? `<div class="todo-rank">${rank}</div>` : ""}
      <div class="todo-main">
        <div class="todo-name">${doneOn ? "✅ " : ""}${escapeHtml(task.name)}${tag ? ` <span class="sub">(${escapeHtml(tag)})</span>` : ""}</div>
        <div class="todo-badges">
          <span class="badge imp-${task.importance}">重要度 ${impLabel}</span>
          ${task.categoryId ? Categories.badge(task.categoryId) : ""}
          ${u !== null ? `<span class="badge urg">${Store.URGENCY_LABELS[u]}</span>` : ""}
          ${scheduleBadge}
        </div>
      </div>
      ${doneOn ? "" : '<button class="todo-start" title="タイマーで開始">▶</button>'}
    `;

    row.addEventListener("click", (e) => {
      if (e.target.closest(".todo-start")) return;
      openTaskDetail(task.id);
    });
    const startBtn = row.querySelector(".todo-start");
    if (startBtn) startBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      Timer.setupFor(task.id);
      App.switchView("timer");
    });
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", `t:${task.id}`);
      e.dataTransfer.effectAllowed = "move";
    });
    return row;
  }

  /* ---------- 共通:週/日ビューの時間ブロック(開始時刻×所要時間で配置) ---------- */
  function makeTimeBlock(task, { top, height, dateCtx = null } = {}) {
    const ctx = dateCtx || Store.todayKey();
    const { time, doneOn, isRecurring } = resolveOccurrence(task, ctx);
    const block = document.createElement("div");
    block.className = `tg-block imp-${task.importance}` + (isRecurring ? " recurring" : "") + (doneOn ? " done" : "");
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    if (task.categoryId) block.style.cssText += Categories.borderStyle(task.categoryId);
    block.draggable = !isRecurring;
    block.dataset.id = task.id;
    const end = Store.addMinutesToTime(time, task.totalMinutes);
    block.innerHTML = `
      <div class="tg-block-name">${doneOn ? "✅ " : isRecurring ? "🔁 " : ""}${escapeHtml(task.name)}</div>
      <div class="tg-block-time">${time}〜${end}</div>
    `;
    block.title = `${task.name}(${time}〜${end})`;
    block.addEventListener("click", (e) => {
      e.stopPropagation();
      openTaskDetail(task.id);
    });
    block.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", `t:${task.id}`);
      e.dataTransfer.effectAllowed = "move";
    });
    return block;
  }

  /* ---------- 共通:予定(イベント)チップ生成(カレンダー用・小さい表示) ---------- */
  function makeEventChip(ev) {
    const chip = document.createElement("div");
    chip.className = "chip event";
    chip.draggable = true;
    chip.dataset.id = ev.id;
    if (ev.categoryId) chip.style.cssText += Categories.borderStyle(ev.categoryId);
    const label = (ev.time ? `${ev.time} ` : "") + `📅 ${ev.title}`;
    chip.textContent = label;
    chip.title = label;
    chip.addEventListener("click", () => openEventForm(ev));
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", `e:${ev.id}`);
      e.dataTransfer.effectAllowed = "move";
    });
    return chip;
  }

  /* ---------- 共通:予定(イベント)の週/日ビュー時間ブロック ---------- */
  function makeEventBlock(ev, { top, height } = {}) {
    const block = document.createElement("div");
    block.className = "tg-block event";
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    if (ev.categoryId) block.style.cssText += Categories.borderStyle(ev.categoryId);
    block.draggable = true;
    block.dataset.id = ev.id;
    const end = Store.addMinutesToTime(ev.time, ev.minutes);
    block.innerHTML = `
      <div class="tg-block-name">📅 ${escapeHtml(ev.title)}</div>
      <div class="tg-block-time">${ev.time}〜${end}</div>
    `;
    block.title = `${ev.title}(${ev.time}〜${end})`;
    block.addEventListener("click", (e) => {
      e.stopPropagation();
      openEventForm(ev);
    });
    block.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", `e:${ev.id}`);
      e.dataTransfer.effectAllowed = "move";
    });
    return block;
  }

  /* ============================================================
   * 予定(イベント)フォーム(追加・編集) — タスクと違い重要度・タイマーは持たない
   * ============================================================ */
  const modalEvent = $("#modal-event");
  let editingEventId = null;
  let selectedEventCategoryId = null;

  function renderEventCategoryPicker() {
    Categories.renderPicker($("#e-category"), selectedEventCategoryId, (id) => {
      selectedEventCategoryId = id;
      renderEventCategoryPicker();
    });
  }

  function openEventForm(ev = null, presetDate = null) {
    editingEventId = ev ? ev.id : null;
    $("#event-form-title").textContent = ev ? "予定を編集" : "予定を追加";
    $("#e-title").value = ev ? ev.title : "";
    $("#e-date").value = ev ? ev.date : (presetDate || Store.todayKey());
    $("#e-allday").checked = ev ? !ev.time : false;
    $("#e-time").value = ev && ev.time ? ev.time : "09:00";
    $("#e-minutes").value = ev && ev.minutes ? ev.minutes : 30;
    $("#e-memo").value = ev ? ev.memo : "";
    selectedEventCategoryId = ev ? (ev.categoryId || null) : null;
    renderEventCategoryPicker();
    syncEventTimeRow();
    $("#e-delete").classList.toggle("hidden", !ev);
    openModal(modalEvent);
    setTimeout(() => $("#e-title").focus(), 50);
  }

  function syncEventTimeRow() {
    $("#e-time-row").classList.toggle("hidden", $("#e-allday").checked);
  }
  $("#e-allday").addEventListener("change", syncEventTimeRow);

  $("#e-cancel").addEventListener("click", closeModal);
  $("#e-save").addEventListener("click", () => {
    const title = $("#e-title").value.trim();
    if (!title) { toast("タイトルを入力してください"); return; }
    const date = $("#e-date").value;
    if (!date) { toast("日付を入力してください"); return; }
    const allDay = $("#e-allday").checked;
    const data = {
      title,
      date,
      time: allDay ? null : ($("#e-time").value || "09:00"),
      minutes: allDay ? null : Math.max(5, Number($("#e-minutes").value) || 30),
      memo: $("#e-memo").value.trim(),
      categoryId: selectedEventCategoryId,
    };
    if (editingEventId) {
      Store.updateEvent(editingEventId, data);
      toast("更新しました");
    } else {
      Store.addEvent(data);
      toast("予定を追加しました");
    }
    closeModal();
    App.refresh();
  });
  $("#e-delete").addEventListener("click", () => {
    if (!editingEventId) return;
    if (!confirm("この予定を削除しますか?")) return;
    Store.deleteEvent(editingEventId);
    toast("削除しました");
    closeModal();
    App.refresh();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  return {
    openModal, closeModal, toast, openTaskForm, openTaskDetail,
    makeChip, makeListItem, makeTimeBlock, escapeHtml,
    openEventForm, makeEventChip, makeEventBlock,
  };
})();
