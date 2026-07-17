/* ============================================================
 * done.js — 完了したタスクの一覧(完了日時の新しい順)
 * 定時タスクの各日の完了状況はカレンダー上(取り消し線)で確認できるため、
 * ここでは通常タスク(一度きりの完了)だけを対象にする。
 * ============================================================ */
const Done = (() => {
  const list = document.getElementById("done-list");
  const summary = document.getElementById("done-summary");

  function formatCompletedAt(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return `${d.getMonth() + 1}/${d.getDate()} 完了`;
  }

  function formatMinutes(total) {
    if (total < 60) return `${total}分`;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h}時間${m}分` : `${h}時間`;
  }

  function render() {
    list.innerHTML = "";
    const items = Store.getTasks()
      .filter((t) => !t.recurrence && t.done)
      .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));

    if (items.length === 0) {
      summary.classList.add("hidden");
      list.innerHTML = '<div class="today-empty">まだ完了したタスクはありません。</div>';
      return;
    }

    const todayKey = Store.todayKey();
    const todayItems = items.filter((t) => (t.completedAt || "").slice(0, 10) === todayKey);
    const totalMinutes = items.reduce((sum, t) => sum + (t.totalMinutes || 0), 0);
    summary.classList.remove("hidden");
    summary.innerHTML = `
      <span class="done-summary-item"><b>${todayItems.length}</b>件 今日完了</span>
      <span class="done-summary-item"><b>${items.length}</b>件 累計</span>
      <span class="done-summary-item">合計 <b>${formatMinutes(totalMinutes)}</b></span>
    `;

    items.forEach((t) => list.appendChild(UI.makeListItem(t, { tag: formatCompletedAt(t.completedAt) })));
  }

  return { render };
})();
