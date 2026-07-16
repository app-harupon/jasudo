/* ============================================================
 * touch-drag.js — スマホなどタッチ操作でのドラッグ&ドロップ対応
 *
 * HTML5標準のドラッグ&ドロップ(draggable属性)はマウス操作にしか
 * 反応せず、タッチではそもそも発火しない。そのため長押しでドラッグを
 * 開始するタッチ専用の仕組みをPointer Eventsで別途用意し、
 * calendar.js の makeDroppable が登録した本物の処理(_dropHandler)を
 * そのまま呼び出す(判定ロジックを二重に持たないようにするため)。
 * ============================================================ */
(() => {
  const LONG_PRESS_MS = 350; // これより短い接触はタップ扱い(詳細を開く)
  const MOVE_CANCEL_PX = 10; // 長押し確定前にこれ以上動いたらスクロールとみなして中止

  let pressTimer = null;
  let candidateEl = null;
  let dragId = null;       // { type: "t"|"e", id }
  let startX = 0, startY = 0;
  let dragging = false;
  let ghost = null;
  let lastTarget = null;
  let suppressNextClick = false;

  function findDraggable(el) {
    return el.closest ? el.closest('[draggable="true"]') : null;
  }
  function idOf(el) {
    return { type: el.classList.contains("event") ? "e" : "t", id: el.dataset.id };
  }
  function findDropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest(".cal-cell, .tg-track, .tray-list") : null;
  }

  function onPointerDown(e) {
    if (e.pointerType !== "touch") return; // マウス/ペンは既存のHTML5 DnDに任せる
    const el = findDraggable(e.target);
    if (!el) return;
    candidateEl = el;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => beginDrag(e), LONG_PRESS_MS);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
    document.addEventListener("pointercancel", onPointerCancel, { once: true });
  }

  function beginDrag(e) {
    if (!candidateEl) return;
    dragging = true;
    dragId = idOf(candidateEl);
    const rect = candidateEl.getBoundingClientRect();
    ghost = candidateEl.cloneNode(true);
    ghost.className = candidateEl.className + " touch-drag-ghost";
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);
    candidateEl.classList.add("touch-drag-source");
    moveGhost(e.clientX, e.clientY);
    if (navigator.vibrate) navigator.vibrate(15); // 対応端末では軽い振動でつかんだことを知らせる
  }

  function moveGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
  }

  function onPointerMove(e) {
    if (!candidateEl) return;
    if (!dragging) {
      const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (moved > MOVE_CANCEL_PX) {
        clearTimeout(pressTimer);
        cleanup();
      }
      return;
    }
    e.preventDefault(); // ドラッグ確定後だけスクロールを止める
    moveGhost(e.clientX, e.clientY);
    const target = findDropTarget(e.clientX, e.clientY);
    if (target !== lastTarget) {
      if (lastTarget) lastTarget.classList.remove("drag-over");
      if (target) target.classList.add("drag-over");
      lastTarget = target;
    }
  }

  function onPointerUp(e) {
    clearTimeout(pressTimer);
    document.removeEventListener("pointermove", onPointerMove);
    if (dragging) {
      e.preventDefault();
      const target = findDropTarget(e.clientX, e.clientY);
      if (target && target._dropHandler && dragId) {
        target._dropHandler(dragId, { clientY: e.clientY });
      }
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 80);
    }
    cleanup();
  }

  function onPointerCancel() {
    clearTimeout(pressTimer);
    document.removeEventListener("pointermove", onPointerMove);
    cleanup();
  }

  function cleanup() {
    if (ghost) { ghost.remove(); ghost = null; }
    if (lastTarget) { lastTarget.classList.remove("drag-over"); lastTarget = null; }
    if (candidateEl) candidateEl.classList.remove("touch-drag-source");
    candidateEl = null;
    dragging = false;
    dragId = null;
  }

  document.addEventListener("pointerdown", onPointerDown, { passive: true });
  // 長押しドラッグの直後に発生する「タップとしてのクリック」を1回だけ握りつぶす
  // (詳細モーダルが誤って開いてしまうのを防ぐため)
  document.addEventListener("click", (e) => {
    if (suppressNextClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);
})();
