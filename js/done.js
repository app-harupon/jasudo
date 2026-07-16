/* ============================================================
 * done.js — 完了したタスクの一覧(完了日時の新しい順)
 * 定時タスクの各日の完了状況はカレンダー上(取り消し線)で確認できるため、
 * ここでは通常タスク(一度きりの完了)だけを対象にする。
 * ============================================================ */
const Done = (() => {
  const list = document.getElementById("done-list");

  function formatCompletedAt(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return `${d.getMonth() + 1}/${d.getDate()} 完了`;
  }

  function render() {
    list.innerHTML = "";
    const items = Store.getTasks()
      .filter((t) => !t.recurrence && t.done)
      .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));

    if (items.length === 0) {
      list.innerHTML = '<div class="today-empty">まだ完了したタスクはありません。</div>';
      return;
    }
    items.forEach((t) => list.appendChild(UI.makeListItem(t, { tag: formatCompletedAt(t.completedAt) })));
  }

  return { render };
})();
