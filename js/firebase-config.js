/* ============================================================
 * firebase-config.js — メール連携(複数端末同期)の接続先設定
 *
 * ここに自分のFirebaseプロジェクトの設定値を貼り付けてください。
 * 値を入れるまでは連携機能が無効なだけで、アプリ自体は今まで通り
 * ローカル(この端末だけ)で問題なく動きます。
 *
 * 取得手順:
 * 1. https://console.firebase.google.com/ にアクセスし、プロジェクトを作成
 * 2. 「構築」→「Authentication」→「Sign-in method」で
 *    「メールリンク(パスワードなしでログイン)」を有効化
 * 3. 「構築」→「Firestore Database」でデータベースを作成(本番環境モードでOK)
 *    → 「ルール」タブを開き、このプロジェクト内の firestore.rules の内容を貼り付けて公開
 * 4. 「プロジェクトの概要」→ 歯車アイコン →「プロジェクトの設定」→ 下部の「マイアプリ」→
 *    ウェブアプリを追加(</> アイコン)→ 表示される firebaseConfig の中身を
 *    下のFIREBASE_CONFIGにそのままコピーしてください
 * 5. 「Authentication」→「Settings」→「承認済みドメイン」に、
 *    実際にこのアプリを公開するドメイン(例: あなたの名前.github.io)を追加
 * ============================================================ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD_m5pFg_XcxZjC0XTlno5yCKfjCId8b-A",
  authDomain: "just-do-ed405.firebaseapp.com",
  projectId: "just-do-ed405",
  storageBucket: "just-do-ed405.firebasestorage.app",
  messagingSenderId: "413247343531",
  appId: "1:413247343531:web:ffc012d2e26f087f2720ee",
};
