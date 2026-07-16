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
    Done.render();
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
  Done.render();
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

  /* ---------- ホーム画面に追加ボタン ---------- */
  const installBtn = document.getElementById("install-btn");
  let deferredInstallPrompt = null;

  // Android/Chrome等: ブラウザが「インストール可能」と判断した時にボタンを出す
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.classList.remove("hidden");
  });
  window.addEventListener("appinstalled", () => {
    installBtn.classList.add("hidden");
    deferredInstallPrompt = null;
  });

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  // iOSはbeforeinstallpromptが存在しないため、未インストールなら手順を案内するボタンを出しておく
  if (isIOS && !isStandalone) installBtn.classList.remove("hidden");

  installBtn.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installBtn.classList.add("hidden");
    } else if (isIOS) {
      UI.toast("共有ボタン→「ホーム画面に追加」で入れられます");
    } else {
      UI.toast("お使いのブラウザでは追加できませんでした");
    }
  });

  // タブを閉じる/離れるときに、実行中のタイマーがあれば一言確認する
  // (データ自体は操作のたびに保存済みだが、タイマーを離れる意図しない中断を防ぐため)
  window.addEventListener("beforeunload", (e) => {
    if (!Timer.isRunning()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // 初回起動時のみチュートリアルを自動開始(初期描画が落ち着いてから)
  if (!Store.settings.tutorialDone) {
    setTimeout(() => Tutorial.start(), 400);
  }

  return { switchView, refresh };
})();
