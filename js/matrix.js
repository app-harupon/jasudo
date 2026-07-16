/* ============================================================
 * matrix.js — やることリスト
 * 重要度(自己申告)×緊急度(締切から自動算出)は内部でスコア化し、
 * 並び替えにのみ使う。画面には数値やマス目は出さず、
 * 優先度順の一本のリストとして見せる。
 * 定時タスク(曜日×時刻で繰り返す)は、今日が該当曜日かつ未完了の場合のみ含める。
 * ============================================================ */
const Matrix = (() => {
  const list = document.getElementById("todo-list");
  const catFilterEl = document.getElementById("matrix-cat-filter");

  function render() {
    Categories.renderFilterBar(catFilterEl);
    list.innerHTML = "";
    const todayKey = Store.todayKey();
    const today = new Date();

    const tasks = Store.getTasks()
      .filter((t) => t.recurrence
        ? Store.occursOnDate(t, today) && !Store.isDoneOn(t, todayKey)
        : !t.done)
      .filter((t) => Store.matchesCategoryFilter(t.categoryId))
      .sort((a, b) => Store.effectiveScore(b) - Store.effectiveScore(a));

    if (tasks.length === 0) {
      list.innerHTML = '<div class="today-empty">やることはありません。右下の＋から追加しましょう。</div>';
      return;
    }
    tasks.forEach((t, i) => list.appendChild(UI.makeListItem(t, { rank: i + 1, dateCtx: todayKey })));
  }

  return { render };
})();
