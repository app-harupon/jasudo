/* ============================================================
 * categories.js — カテゴリ(セクション)分け・フィルター・管理モーダル
 *
 * タスク・予定に「仕事」「個人」のようなカテゴリを付け、色で見分けたり
 * やることリスト/カレンダーを絞り込んだりできるようにする。
 * ============================================================ */
const Categories = (() => {
  // タスク/予定フォーム共通:「なし」+各カテゴリのボタンをコンテナにレンダリングする
  function renderPicker(container, selectedId, onChange) {
    container.innerHTML = "";
    const noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.textContent = "なし";
    noneBtn.classList.toggle("on", !selectedId);
    noneBtn.addEventListener("click", () => onChange(null));
    container.appendChild(noneBtn);

    Store.getCategories().forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.classList.toggle("on", selectedId === c.id);
      b.innerHTML = `<span class="cat-dot" style="background:${c.color}"></span>${UI.escapeHtml(c.name)}`;
      b.addEventListener("click", () => onChange(c.id));
      container.appendChild(b);
    });

    // その場でカテゴリが無いことに気づいても、モーダルを閉じずに管理画面へ行ける導線
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "cat-add-inline";
    addBtn.textContent = "+ 新規カテゴリ";
    addBtn.addEventListener("click", () => Categories.openManageModal());
    container.appendChild(addBtn);
  }

  // 一覧・詳細画面用の小さな色付きバッジ(該当カテゴリが無ければ空文字)
  function badge(categoryId) {
    const c = Store.getCategory(categoryId);
    if (!c) return "";
    return `<span class="badge cat-badge" style="background:${c.color}22;color:${c.color}"><span class="cat-dot" style="background:${c.color}"></span>${UI.escapeHtml(c.name)}</span>`;
  }

  // チップ/ブロックの左ボーダー色を上書きするためのインラインstyle文字列
  function borderStyle(categoryId) {
    const c = Store.getCategory(categoryId);
    return c ? `border-left-color:${c.color}` : "";
  }

  /* ---------- フィルターバー(やることリスト/カレンダー共通) ---------- */
  function renderFilterBar(container) {
    const cats = Store.getCategories();
    if (cats.length === 0) {
      container.classList.add("hidden");
      container.innerHTML = "";
      return;
    }
    container.classList.remove("hidden");
    const filter = Store.settings.categoryFilter || [];
    container.innerHTML = "";

    const allBtn = document.createElement("button");
    allBtn.className = "cat-chip cat-all" + (filter.length === 0 ? " on" : "");
    allBtn.textContent = "すべて";
    allBtn.addEventListener("click", () => {
      Store.setSetting("categoryFilter", []);
      App.refresh();
    });
    container.appendChild(allBtn);

    cats.forEach((c) => {
      const b = document.createElement("button");
      b.className = "cat-chip cat-colored" + (filter.includes(c.id) ? " on" : "");
      b.style.setProperty("--cat-color", c.color);
      b.textContent = c.name;
      b.addEventListener("click", () => {
        const cur = Store.settings.categoryFilter || [];
        const next = cur.includes(c.id) ? cur.filter((id) => id !== c.id) : cur.concat(c.id);
        Store.setSetting("categoryFilter", next);
        App.refresh();
      });
      container.appendChild(b);
    });
  }

  return { renderPicker, badge, borderStyle, renderFilterBar };
})();

/* ============================================================
 * カテゴリ管理モーダルのUI配線
 * ============================================================ */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const modalCategories = $("#modal-categories");
  let selectedNewColor = Store.CATEGORY_COLORS[0];

  function renderColorSwatches(container, current, onPick) {
    container.innerHTML = Store.CATEGORY_COLORS.map((col) =>
      `<button type="button" class="color-swatch${col === current ? " on" : ""}" data-color="${col}" style="background:${col}"></button>`
    ).join("");
    container.querySelectorAll(".color-swatch").forEach((b) => {
      b.addEventListener("click", () => onPick(b.dataset.color));
    });
  }

  function refreshNewColorSwatches() {
    renderColorSwatches($("#cat-new-color"), selectedNewColor, (color) => {
      selectedNewColor = color;
      refreshNewColorSwatches();
    });
  }

  function renderCategoryList() {
    const list = $("#cat-list");
    const cats = Store.getCategories();
    if (cats.length === 0) {
      list.innerHTML = '<div class="cat-empty">まだカテゴリがありません。下から追加してください。</div>';
      return;
    }
    list.innerHTML = cats.map((c) => `
      <div class="cat-row" data-id="${c.id}">
        <div class="cat-row-top">
          <input type="text" class="cat-name-input" value="${UI.escapeHtml(c.name)}">
          <button class="cat-delete danger-ghost">削除</button>
        </div>
        <div class="color-swatch-row"></div>
      </div>
    `).join("");

    list.querySelectorAll(".cat-row").forEach((row) => {
      const id = row.dataset.id;
      const cat = Store.getCategory(id);
      renderColorSwatches(row.querySelector(".color-swatch-row"), cat.color, (color) => {
        Store.updateCategory(id, { color });
        renderCategoryList();
        App.refresh();
      });
      row.querySelector(".cat-name-input").addEventListener("change", (e) => {
        const name = e.target.value.trim();
        if (!name) { e.target.value = cat.name; return; }
        Store.updateCategory(id, { name });
        App.refresh();
      });
      row.querySelector(".cat-delete").addEventListener("click", () => {
        if (!confirm(`「${cat.name}」を削除しますか? このカテゴリを使っているタスク・予定は未分類に戻ります。`)) return;
        Store.deleteCategory(id);
        renderCategoryList();
        App.refresh();
        UI.toast("削除しました");
      });
    });
  }

  function openManageModal() {
    UI.closeModal();
    renderCategoryList();
    selectedNewColor = Store.CATEGORY_COLORS[Store.getCategories().length % Store.CATEGORY_COLORS.length];
    refreshNewColorSwatches();
    $("#cat-new-name").value = "";
    UI.openModal(modalCategories);
  }
  Categories.openManageModal = openManageModal;

  document.getElementById("menu-categories").addEventListener("click", openManageModal);
  $("#cat-close").addEventListener("click", () => UI.closeModal());

  $("#cat-add").addEventListener("click", () => {
    const name = $("#cat-new-name").value.trim();
    if (!name) { UI.toast("カテゴリ名を入力してください"); return; }
    Store.addCategory({ name, color: selectedNewColor });
    $("#cat-new-name").value = "";
    renderCategoryList();
    selectedNewColor = Store.CATEGORY_COLORS[Store.getCategories().length % Store.CATEGORY_COLORS.length];
    refreshNewColorSwatches();
    UI.toast("カテゴリを追加しました");
    App.refresh();
  });
})();
