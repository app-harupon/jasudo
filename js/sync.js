/* ============================================================
 * sync.js — メールアドレスとの連携(複数端末でのデータ同期)
 *
 * Firebase Authentication(メールリンク・パスワード不要)+ Firestore を使い、
 * tasks / events / settings をまるごと1つのドキュメントとして同期する。
 * FIREBASE_CONFIG が未設定(js/firebase-config.js 参照)の場合は何もせず、
 * アプリは今まで通りこの端末だけのローカル動作になる。
 * ============================================================ */
const Sync = (() => {
  const LS_PENDING_EMAIL = "ponTodo.pendingEmail";

  let auth = null;
  let db = null;
  let user = null;
  let unsubscribeSnapshot = null;
  let pushTimer = null;
  let receivingRemote = false;
  let lastSyncedAt = null; // 送信・受信いずれかが成功するたび更新(連携状態を目に見えるようにするため)
  const statusListeners = [];

  function isConfigured() {
    return typeof FIREBASE_CONFIG !== "undefined"
      && FIREBASE_CONFIG.apiKey
      && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY"
      && typeof firebase !== "undefined";
  }

  function init() {
    if (!isConfigured()) return;
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      db.enablePersistence().catch(() => { /* 複数タブ等で失敗しても致命的ではない */ });
    } catch (e) {
      return; // 設定不備などは連携機能を無効化するだけでアプリは通常通り動かす
    }

    // メール内のリンクから戻ってきた場合の処理
    if (auth.isSignInWithEmailLink(window.location.href)) {
      let email = localStorage.getItem(LS_PENDING_EMAIL);
      if (!email) email = window.prompt("確認のため、登録したメールアドレスを入力してください");
      if (email) {
        auth.signInWithEmailLink(email, window.location.href)
          .then(() => {
            localStorage.removeItem(LS_PENDING_EMAIL);
            history.replaceState(null, "", window.location.pathname);
          })
          .catch(() => UI.toast("ログインリンクが無効か期限切れです"));
      }
    }

    auth.onAuthStateChanged((u) => {
      user = u;
      if (u) startListening();
      else stopListening();
      notifyStatus();
    });
  }

  /* ---------- 認証 ---------- */
  function sendLoginLink(email) {
    if (!auth) return Promise.reject(new Error("not configured"));
    const actionCodeSettings = {
      url: window.location.href.split("?")[0].split("#")[0],
      handleCodeInApp: true,
    };
    return auth.sendSignInLinkToEmail(email, actionCodeSettings)
      .then(() => localStorage.setItem(LS_PENDING_EMAIL, email));
  }

  function signOut() {
    if (auth) auth.signOut();
  }

  /* ---------- 同期(受信) ---------- */
  function startListening() {
    if (!user || !db) return;
    unsubscribeSnapshot = db.collection("syncData").doc(user.uid).onSnapshot(
      (snap) => {
        if (!snap.exists) {
          pushNow(); // 初回連携:このタスク端末のデータをそのままアップロード
          return;
        }
        const data = snap.data();
        receivingRemote = true;
        Store.replaceTasks(data.tasks || []);
        Store.replaceEvents(data.events || []);
        Store.replaceCategories(data.categories || []);
        Store.replaceSettings(data.settings || {});
        App.refresh();
        receivingRemote = false;
        lastSyncedAt = new Date();
        notifyStatus();
      },
      () => UI.toast("同期でエラーが発生しました")
    );
  }

  function stopListening() {
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  }

  /* ---------- 同期(送信) ----------
   * App.refresh() のたびに呼ばれる想定。実際の書き込みは少し待って1回にまとめる(デバウンス)。
   * リモートから受信した直後(receivingRemote中)は送り返さない。
   */
  function schedulePush() {
    if (!user || !db || receivingRemote) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 1200);
  }

  function pushNow() {
    if (!user || !db) return;
    db.collection("syncData").doc(user.uid).set({
      tasks: Store.getTasks(),
      events: Store.getEvents(),
      categories: Store.getCategories(),
      settings: Store.settings,
      updatedAt: new Date().toISOString(),
    })
      .then(() => { lastSyncedAt = new Date(); notifyStatus(); })
      .catch(() => UI.toast("同期に失敗しました(オフラインの可能性があります)"));
  }

  /* ---------- 状態通知(アカウントモーダルのUI更新用) ---------- */
  function notifyStatus() { statusListeners.forEach((fn) => fn(user)); }
  function onStatusChange(fn) { statusListeners.push(fn); }
  function currentUser() { return user; }
  function getLastSyncedAt() { return lastSyncedAt; }

  return {
    init, isConfigured, sendLoginLink, signOut, schedulePush, onStatusChange, currentUser,
    getLastSyncedAt,
  };
})();

/* ============================================================
 * アカウントモーダルのUI配線
 * ============================================================ */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const modalAccount = $("#modal-account");
  const signedOutBox = $("#acct-signed-out");
  const signedInBox = $("#acct-signed-in");
  const accountDot = $("#account-dot");
  let liveInterval = null;

  // 「たった今」「3分前」のような相対時刻(連携できているかを一目でわかるようにするため)
  function formatRelativeTime(date) {
    if (!date) return "まだ同期していません";
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 5) return "たった今";
    if (sec < 60) return `${sec}秒前`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}分前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}時間前`;
    return `${Math.floor(hr / 24)}日前`;
  }

  function render(user) {
    const configured = Sync.isConfigured();
    signedOutBox.classList.toggle("hidden", !!user);
    signedInBox.classList.toggle("hidden", !user);
    $("#acct-unconfigured-note").classList.toggle("hidden", configured);
    $("#acct-send").disabled = !configured;
    accountDot.classList.toggle("hidden", !user);
    if (user) {
      $("#acct-email-display").textContent = user.email;
      $("#acct-sync-status").textContent = "✔ この端末は連携中です。他の端末でも同じメールアドレスでログインすると、タスクが自動で同期されます。";
      $("#acct-last-synced").textContent = `最終同期: ${formatRelativeTime(Sync.getLastSyncedAt())}`;
    }
  }

  document.getElementById("account-btn").addEventListener("click", () => {
    $("#acct-sent-note").classList.add("hidden");
    $("#acct-email").value = "";
    render(Sync.currentUser());
    UI.openModal(modalAccount);
    // モーダルを開いている間は「最終同期」の相対時刻を生きたまま更新する
    clearInterval(liveInterval);
    liveInterval = setInterval(() => render(Sync.currentUser()), 5000);
  });
  $("#acct-close").addEventListener("click", () => {
    UI.closeModal();
    clearInterval(liveInterval);
  });

  $("#acct-send").addEventListener("click", () => {
    const email = $("#acct-email").value.trim();
    if (!email || !email.includes("@")) { UI.toast("メールアドレスを入力してください"); return; }
    $("#acct-send").disabled = true;
    Sync.sendLoginLink(email)
      .then(() => {
        $("#acct-sent-note").classList.remove("hidden");
        UI.toast("メールを送信しました");
      })
      .catch((err) => {
        // エラーコードをそのまま出す(原因の切り分けをすぐできるようにするため)
        const code = err && err.code ? err.code : "unknown";
        UI.toast(`送信に失敗しました(${code})`);
      })
      .finally(() => { $("#acct-send").disabled = false; });
  });

  $("#acct-signout").addEventListener("click", () => {
    if (!confirm("連携を解除しますか?(この端末のデータはそのまま残ります)")) return;
    Sync.signOut();
    UI.toast("連携を解除しました");
    UI.closeModal();
  });

  Sync.onStatusChange(render);
  Sync.init();
})();
