/* ============================================================
 * data-tools.js — ファイルへの書き出し/読み込み、議事録からの日程抽出
 *
 * 議事録の抽出は正規表現ベースの簡易パーサーで、AIによる読解ではない。
 * 誤検出・見逃しがある前提で、必ず「候補を見せて確認してから追加する」
 * 流れにしている(自動で勝手に追加はしない)。
 * ============================================================ */
const DataTools = (() => {
  /* ============================================================
   * エクスポート / インポート
   * ============================================================ */
  function exportData() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks: Store.getTasks(),
      events: Store.getEvents(),
      categories: Store.getCategories(),
      settings: Store.settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jasudo-backup-${Store.todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    UI.toast("ファイルに保存しました");
  }

  function importFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch (err) {
        UI.toast("読み込みに失敗しました(JSON形式ではありません)");
        return;
      }
      if (!data || !Array.isArray(data.tasks)) {
        UI.toast("バックアップファイルの形式が正しくありません");
        return;
      }
      const taskCount = data.tasks.length;
      const eventCount = Array.isArray(data.events) ? data.events.length : 0;
      if (!confirm(`タスク${taskCount}件・予定${eventCount}件を読み込みます。今のデータは上書きされます。よろしいですか?`)) return;
      Store.replaceTasks(data.tasks);
      Store.replaceEvents(data.events || []);
      Store.replaceCategories(data.categories || []);
      if (data.settings) Store.replaceSettings(data.settings);
      App.refresh();
      UI.toast("読み込みました");
      UI.closeModal();
    };
    reader.readAsText(file);
  }

  /* ============================================================
   * 議事録からの日程抽出
   * ============================================================ */
  const WEEKDAY_MAP = { "日": 0, "月": 1, "火": 2, "水": 3, "木": 4, "金": 5, "土": 6 };

  function stripTime(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  // 行の中から日付表現を1つ探し、{ date, rest(残りのテキスト) } を返す。無ければ null
  function extractDate(line, baseDate) {
    let m = line.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const year = m[1] ? Number(m[1]) : baseDate.getFullYear();
      let d = new Date(year, Number(m[2]) - 1, Number(m[3]));
      if (!m[1] && d < stripTime(baseDate)) d = new Date(year + 1, Number(m[2]) - 1, Number(m[3]));
      return { date: Store.dateKey(d), rest: line.replace(m[0], " ") };
    }
    m = line.match(/(?<![\d:.])(\d{1,2})\/(\d{1,2})(?!\d)/);
    if (m) {
      let d = new Date(baseDate.getFullYear(), Number(m[1]) - 1, Number(m[2]));
      if (d < stripTime(baseDate)) d = new Date(baseDate.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
      return { date: Store.dateKey(d), rest: line.replace(m[0], " ") };
    }
    const relMap = { "今日": 0, "本日": 0, "明後日": 2, "明日": 1 };
    for (const word in relMap) {
      if (line.includes(word)) {
        return { date: Store.dateKey(Store.addDays(baseDate, relMap[word])), rest: line.replace(word, " ") };
      }
    }
    m = line.match(/(来週|再来週|今週)?(月|火|水|木|金|土|日)曜日?/);
    if (m) {
      const weekOffset = m[1] === "来週" ? 7 : m[1] === "再来週" ? 14 : 0;
      const base = Store.addDays(baseDate, weekOffset);
      let d = Store.addDays(Store.startOfWeek(base), WEEKDAY_MAP[m[2]]);
      if (!m[1] && d < stripTime(baseDate)) d = Store.addDays(d, 7);
      return { date: Store.dateKey(d), rest: line.replace(m[0], " ") };
    }
    return null;
  }

  function normalizeTime(ampm, h, mi) {
    let hour = Number(h);
    const min = mi ? Number(mi) : 0;
    if (ampm === "午後" && hour < 12) hour += 12;
    if (ampm === "午前" && hour === 12) hour = 0;
    if (hour > 23 || min > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  // 残りのテキストから時刻表現を探す。範囲(〜)があれば開始・終了の両方を拾う
  function extractTime(line) {
    let m = line.match(/(午前|午後)?(\d{1,2})[:時](\d{1,2})?分?\s*[〜\-~]\s*(午前|午後)?(\d{1,2})[:時](\d{1,2})?分?/);
    if (m) {
      const start = normalizeTime(m[1], m[2], m[3]);
      const end = normalizeTime(m[4] || m[1], m[5], m[6]);
      if (start) return { start, end, rest: line.replace(m[0], " ") };
    }
    m = line.match(/(午前|午後)?(\d{1,2})[:時](\d{1,2})?分?/);
    if (m) {
      const start = normalizeTime(m[1], m[2], m[3]);
      if (start) return { start, end: null, rest: line.replace(m[0], " ") };
    }
    return null;
  }

  function cleanTitle(text) {
    return text
      .replace(/^[\s\-・※□▪◆●○*#>]+/, "")
      .replace(/^\d+[.\)、]\s*/, "")
      .replace(/^[(（][月火水木金土日][)）]\s*/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // テキスト全体から候補一覧を作る。1行につき最大1件、日付が見つかった行だけ拾う
  function extractCandidates(text, baseDate = new Date()) {
    const lines = text.split(/\r?\n/);
    const candidates = [];
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const dateResult = extractDate(trimmed, baseDate);
      if (!dateResult) return;
      const timeResult = extractTime(dateResult.rest);
      const title = cleanTitle(timeResult ? timeResult.rest : dateResult.rest) || "(タイトル未入力)";
      candidates.push({
        date: dateResult.date,
        time: timeResult ? timeResult.start : null,
        endTime: timeResult ? timeResult.end : null,
        title,
      });
    });
    return candidates;
  }

  return { exportData, importFromFile, extractCandidates };
})();

/* ============================================================
 * メニュー・モーダルのUI配線
 * ============================================================ */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const modalMenu = $("#modal-menu");
  const modalExtract = $("#modal-extract");
  const fileInput = $("#import-file-input");

  document.getElementById("menu-btn").addEventListener("click", () => UI.openModal(modalMenu));
  $("#menu-close").addEventListener("click", () => UI.closeModal());

  $("#menu-export").addEventListener("click", () => {
    DataTools.exportData();
    UI.closeModal();
  });

  $("#menu-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) DataTools.importFromFile(file);
    fileInput.value = "";
  });

  $("#menu-extract").addEventListener("click", () => {
    UI.closeModal();
    $("#ext-input").value = "";
    $("#ext-results").classList.add("hidden");
    $("#ext-list").innerHTML = "";
    UI.openModal(modalExtract);
  });
  $("#ext-close").addEventListener("click", () => UI.closeModal());

  let addType = "task";
  modalExtract.querySelectorAll("#ext-add-type button").forEach((b) => {
    b.addEventListener("click", () => {
      addType = b.dataset.type;
      modalExtract.querySelectorAll("#ext-add-type button").forEach((x) => x.classList.toggle("on", x === b));
    });
  });

  $("#ext-parse").addEventListener("click", () => {
    const text = $("#ext-input").value;
    const candidates = DataTools.extractCandidates(text);
    const list = $("#ext-list");
    list.innerHTML = "";
    if (candidates.length === 0) {
      list.innerHTML = '<div class="ext-empty">日付らしきものが見つかりませんでした。「7/20」「7月20日」「明日」「来週月曜」などの表記を含む行があれば拾えます。</div>';
    } else {
      candidates.forEach((c) => {
        const row = document.createElement("div");
        row.className = "ext-row";
        row.innerHTML = `
          <input type="checkbox" class="ext-check" checked>
          <input type="text" class="ext-title" value="${UI.escapeHtml(c.title)}">
          <input type="date" class="ext-date" value="${c.date}">
          <input type="time" class="ext-time" value="${c.time || ""}">
        `;
        list.appendChild(row);
      });
    }
    $("#ext-results").classList.remove("hidden");
  });

  $("#ext-confirm").addEventListener("click", () => {
    const rows = Array.from($("#ext-list").querySelectorAll(".ext-row"));
    let count = 0;
    rows.forEach((row) => {
      if (!row.querySelector(".ext-check").checked) return;
      const title = row.querySelector(".ext-title").value.trim();
      const date = row.querySelector(".ext-date").value;
      const time = row.querySelector(".ext-time").value || null;
      if (!title || !date) return;
      if (addType === "event") {
        Store.addEvent({ title, date, time, minutes: time ? 30 : null });
      } else {
        const task = Store.addTask({ name: title, importance: "mid", durationType: "unknown" });
        Store.updateTask(task.id, { scheduledDate: date, scheduledTime: time });
      }
      count++;
    });
    if (count === 0) { UI.toast("追加する項目が選択されていません"); return; }
    UI.toast(`${count}件追加しました`);
    App.refresh();
    UI.closeModal();
  });
})();
