/* ============================================================
 * app.js — ナビゲーション・初期化
 * ============================================================ */
const App = (() => {
  const tabs = document.querySelectorAll(".tab");
  const views = document.querySelectorAll(".view");

  function switchView(name) {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    views.forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  }

  tabs.forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

  document.getElementById("fab-add").addEventListener("click", () => UI.openTaskForm());
  document.getElementById("help-btn").addEventListener("click", () => Tutorial.start(true));

  // データ変更後に全ビューを再描画し、連携中ならリモートへも同期する
  function refresh() {
    Matrix.render();
    Calendar.render();
    if (!Timer.isRunning()) Timer.renderSetup();
    if (typeof Sync !== "undefined") Sync.schedulePush();
  }

  // 終了時刻を過ぎても完了していないタスクを未スケジュールへ自動的に戻す
  function checkOverdueTasks() {
    const count = Store.releaseOverdueTasks();
    if (count > 0) {
      UI.toast(`${count}件のタスクを未スケジュールに戻しました`);
      refresh();
    }
  }

  /* ---------- 初期化 ---------- */
  Matrix.render();
  Calendar.render();
  if (!Timer.restore()) {
    Timer.renderSetup();
  } else {
    switchView("timer"); // 実行中セッションがあればタイマーへ
  }

  checkOverdueTasks();
  setInterval(checkOverdueTasks, 60000); // 開きっぱなしでも1分ごとに追従

  // PWA化(ホーム画面への追加・オフライン起動に対応)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // 初回起動時のみチュートリアルを自動開始(初期描画が落ち着いてから)
  if (!Store.settings.tutorialDone) {
    setTimeout(() => Tutorial.start(), 400);
  }

  return { switchView, refresh };
})();
