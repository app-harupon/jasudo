/* ============================================================
 * tutorial.js — 実際に操作しながら覚えるチュートリアル
 *
 * 各ステップは本物のUI要素をハイライトする。
 * - waitFor が無いステップ:説明を読んで「次へ」で進む(画面全体をブロックし誤操作を防ぐ)
 * - waitFor があるステップ:対象要素だけ操作可能にし、実際にタップ/クリックするまで進まない
 * いつでも「スキップ」で終了でき、二度と自動表示しない(ヘッダーの「？」からいつでも再生可能)。
 * ============================================================ */
const Tutorial = (() => {
  const overlay = document.getElementById("tut-overlay");
  const dimTop = document.getElementById("tut-dim-top");
  const dimBottom = document.getElementById("tut-dim-bottom");
  const dimLeft = document.getElementById("tut-dim-left");
  const dimRight = document.getElementById("tut-dim-right");
  const ring = document.getElementById("tut-ring");
  const card = document.getElementById("tut-card");
  const progressEl = document.getElementById("tut-progress");
  const textEl = document.getElementById("tut-text");
  const hintEl = document.getElementById("tut-hint");
  const nextBtn = document.getElementById("tut-next");
  const skipBtn = document.getElementById("tut-skip");

  const $ = (sel) => document.querySelector(sel);

  let steps = [];
  let idx = 0;
  let active = false;
  let currentCleanup = null; // 表示中ステップのイベント購読解除
  let demoTaskId = null;     // チュートリアル中に作った本物のサンプルタスク

  function buildSteps() {
    return [
      {
        text: "ジャスドゥーへようこそ🎉\n実際に操作しながら、使い方を覚えましょう。",
      },
      {
        before: () => { App.switchView("matrix"); UI.closeModal(); },
        target: "#fab-add",
        text: "右下の「＋」をタップして、タスクを追加してみましょう。",
        hint: "＋ボタンをタップ",
        waitFor: { el: "#fab-add", event: "click" },
      },
      {
        target: "#f-importance",
        text: "重要度は「高・中・低」から選びます。下に判断の具体例が出るので、迷ったらそれを見てタップしてください。",
      },
      {
        before: () => { if (!$("#f-name").value.trim()) $("#f-name").value = "サンプルタスク"; },
        target: "#f-save",
        text: "タスク名(そのままでもOK)と重要度が決まったら、「保存」をタップしましょう。",
        hint: "保存をタップ",
        waitFor: { el: "#f-save", event: "click" },
        after: () => {
          const list = Store.getTasks();
          const last = list[list.length - 1];
          if (last) demoTaskId = last.id;
        },
      },
      {
        target: "#todo-list",
        text: "追加されました!ここが「やることリスト」です。重要度と締切から自動計算したスコアが高い順に並ぶので、あなたは上から順にやるだけでOKです。",
      },
      {
        target: '.tab[data-view="calendar"]',
        text: "カレンダータブをタップしてみましょう。",
        hint: "カレンダーをタップ",
        waitFor: { el: '.tab[data-view="calendar"]', event: "click" },
      },
      {
        target: ".cal-mode-switch",
        text: "月・週・日でビューを切り替えられます。週・日ビューでは時間帯ごとにタスクを配置できます。",
      },
      {
        target: "#cal-add-event",
        text: "タスクとは別に、重要度やタイマーを必要としない「ただの予定」(歯医者・飲み会など)もここから登録できます。",
      },
      {
        before: () => { UI.closeModal(); },
        target: '.tab[data-view="timer"]',
        text: "タイマータブをタップしましょう。",
        hint: "タイマーをタップ",
        waitFor: { el: '.tab[data-view="timer"]', event: "click" },
        after: () => { if (demoTaskId && Store.getTask(demoTaskId)) Timer.setupFor(demoTaskId); },
      },
      {
        target: "#t-focus",
        text: "集中する時間の基準を選びます。休憩時間はその1/3までに自動で制限されます。",
      },
      {
        target: "#t-preview",
        text: "合計時間を入れると、集中時間の単位で機械的に分割されます。細かい調整はできない仕様です — 迷う時間を減らすためです。",
      },
      {
        target: "#t-start",
        text: "「▶ スタート」を押すと、俯瞰タイム→集中→休憩のセグメントが自動で始まります。押してみましょう!",
        hint: "スタートをタップ",
        waitFor: { el: "#t-start", event: "click" },
      },
      {
        text: "これで一通り体験できました🎉\nこのままタイマーを続けられます。使い方に迷ったら、右上の「？」からいつでもこのチュートリアルを見返せます。",
      },
    ];
  }

  function start(force = false) {
    if (!force && Store.settings.tutorialDone) return;
    steps = buildSteps();
    idx = 0;
    demoTaskId = null;
    active = true;
    overlay.classList.remove("hidden");
    window.addEventListener("resize", reposition);
    // モーダル内をスクロールしたときもリングと穴の位置を追従させる(scrollは捕捉フェーズで拾う)
    document.addEventListener("scroll", handleScroll, true);
    showStep();
  }

  function handleScroll() {
    if (active) reposition();
  }

  function showStep() {
    if (currentCleanup) { currentCleanup(); currentCleanup = null; }
    const step = steps[idx];
    if (step.before) step.before();

    progressEl.textContent = `${idx + 1} / ${steps.length}`;
    textEl.textContent = step.text;
    hintEl.textContent = step.hint || "";
    hintEl.classList.toggle("hidden", !step.hint);
    nextBtn.classList.toggle("hidden", !!step.waitFor);

    // getBoundingClientRect() はレイアウトを同期的に確定させるため、
    // before() の直後にそのまま呼んでよい(requestAnimationFrame待ちにすると
    // 環境によっては描画が遅延し、穴が開く前にボタンを押せてしまうことがある)
    reposition();

    if (step.waitFor) {
      const target = document.querySelector(step.waitFor.el);
      if (!target) { advance(); return; } // 対象が無ければ詰まらせず先に進める
      const handler = () => {
        if (step.after) step.after();
        advance();
      };
      target.addEventListener(step.waitFor.event, handler, { once: true });
      currentCleanup = () => target.removeEventListener(step.waitFor.event, handler);
    }
  }

  // ハイライトと暗転を計算する。
  // 「次へ」待ちの説明ステップは画面全体をブロックして誤操作を防ぎ、
  // 「実際に操作する」ステップだけ対象要素の周りに穴を開けて本物のUIを触らせる。
  function reposition() {
    if (!active) return;
    const step = steps[idx];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const targetEl = step.target ? document.querySelector(step.target) : null;
    const rect = targetEl ? targetEl.getBoundingClientRect() : null;

    if (!rect) {
      setRect(dimTop, 0, 0, vw, vh);
      setRect(dimBottom, 0, vh, vw, 0);
      setRect(dimLeft, 0, 0, 0, vh);
      setRect(dimRight, vw, 0, 0, vh);
      ring.classList.add("hidden");
      card.classList.add("tut-card-center");
      card.classList.remove("tut-card-top-pos");
      return;
    }

    card.classList.remove("tut-card-center");
    const pad = 6;
    const top = Math.max(0, rect.top - pad);
    const left = Math.max(0, rect.left - pad);
    const right = Math.min(vw, rect.right + pad);
    const bottom = Math.min(vh, rect.bottom + pad);

    // リングは常に対象そのものを囲んで見た目のガイドにする
    ring.classList.remove("hidden");
    setRect(ring, left, top, right - left, bottom - top);
    card.classList.toggle("tut-card-top-pos", vh - rect.top < 280);

    // 対象がモーダルの中にある場合は、モーダル全体を穴にする。
    // ボタン周りだけに穴を絞ると、モーダル内のスクロールや他の入力欄が
    // 暗転で塞がれてしまい、下の方にある「保存」などに手が届かなくなるため。
    const modalEl = targetEl.closest(".modal");
    const openModal = modalEl && !modalEl.classList.contains("hidden") ? modalEl : null;
    const holeRect = openModal ? openModal.getBoundingClientRect() : rect;

    if (step.waitFor || openModal) {
      const hTop = Math.max(0, holeRect.top - pad);
      const hLeft = Math.max(0, holeRect.left - pad);
      const hRight = Math.min(vw, holeRect.right + pad);
      const hBottom = Math.min(vh, holeRect.bottom + pad);
      setRect(dimTop, 0, 0, vw, hTop);
      setRect(dimBottom, 0, hBottom, vw, Math.max(0, vh - hBottom));
      setRect(dimLeft, 0, hTop, hLeft, hBottom - hTop);
      setRect(dimRight, hRight, hTop, Math.max(0, vw - hRight), hBottom - hTop);
    } else {
      // 説明のみ:全画面ブロック(ハイライトは見た目だけ)
      setRect(dimTop, 0, 0, vw, vh);
      setRect(dimBottom, 0, vh, vw, 0);
      setRect(dimLeft, 0, 0, 0, vh);
      setRect(dimRight, vw, 0, 0, vh);
    }
  }

  function setRect(el, x, y, w, h) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${Math.max(0, w)}px`;
    el.style.height = `${Math.max(0, h)}px`;
  }

  function advance() {
    if (!active) return;
    idx++;
    if (idx >= steps.length) { finish(); return; }
    showStep();
  }

  function finish() {
    active = false;
    if (currentCleanup) { currentCleanup(); currentCleanup = null; }
    window.removeEventListener("resize", reposition);
    document.removeEventListener("scroll", handleScroll, true);
    overlay.classList.add("hidden");
    Store.setSetting("tutorialDone", true);
  }

  nextBtn.addEventListener("click", advance);
  skipBtn.addEventListener("click", finish);

  return { start };
})();
