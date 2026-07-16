/* ============================================================
 * matrix.js — やることリスト
 * 重要度(自己申告)×緊急度(締切から自動算出)は内部でスコア化し、
 * 並び替えにのみ使う。画面には数値やマス目は出さず、
 * 優先度順の一本のリストとして見せる。
 * 定時タスク(曜日×時刻で繰り返す)は、今日が該当曜日の場合のみ含める。
 * ============================================================ */
const Matrix = (() => {
  const list = document.getElementById("todo-list");
  const catFilterEl = document.getElementById("matrix-cat-filter");
  const statusFilterEl = document.getElementById("matrix-status-filter");

  // 未完了/完了/すべて の切り替え(カテゴリフィルターと同じ見た目で常時表示)
  function renderStatusFilter() {
    const current = Store.settings.statusFilter || "pending";
    const options = [["pending", "未完了"], ["done", "完了"], ["all", "すべて"]];
    statusFilterEl.innerHTML = "";
    options.forEach(([val, label]) => {
      const b = document.createElement("button");
      b.className = "cat-chip cat-all" + (current === val ? " on" : "");
      b.textContent = label;
      b.addEventListener("click", () => {
        Store.setSetting("statusFilter", val);
        App.refresh();
      });
      statusFilterEl.appendChild(b);
    });
  }

  function emptyMessage(statusFilter) {
    if (statusFilter === "done") return "まだ完了したタスクはありません。";
    if (statusFilter === "all") return "タスクがありません。右下の＋から追加しましょう。";
    return "やることはありません。右下の＋から追加しましょう。";
  }

  function render() {
    Categories.renderFilterBar(catFilterEl);
    renderStatusFilter();
    list.innerHTML = "";
    const todayKey = Store.todayKey();
    const today = new Date();
    const statusFilter = Store.settings.statusFilter || "pending";

    const tasks = Store.getTasks()
      .filter((t) => {
        if (t.recurrence) {
          if (!Store.occursOnDate(t, today)) return false;
          const doneToday = Store.isDoneOn(t, todayKey);
          if (statusFilter === "pending") return !doneToday;
          if (statusFilter === "done") return doneToday;
          return true; // all
        }
        if (statusFilter === "pending") return !t.done;
        if (statusFilter === "done") return t.done;
        return true; // all
      })
      .filter((t) => Store.matchesCategoryFilter(t.categoryId))
      .sort((a, b) => Store.effectiveScore(b) - Store.effectiveScore(a));

    if (tasks.length === 0) {
      list.innerHTML = `<div class="today-empty">${emptyMessage(statusFilter)}</div>`;
      return;
    }
    tasks.forEach((t, i) => list.appendChild(UI.makeListItem(t, { rank: i + 1, dateCtx: todayKey })));
  }

  return { render };
})();
