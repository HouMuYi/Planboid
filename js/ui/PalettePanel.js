/**
 * PalettePanel.js - 通用調色盤 (自動確保 active 高亮狀態)
 */

export class PalettePanel {
    /**
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     */
    constructor(stateManager) {
        this.state = stateManager;
        this.container = document.getElementById("palette-container");
        this.labelInput = document.getElementById("input-tile-label");
        this.tileInfoDisplay = document.getElementById("selected-tile-info");
        this.btnEnableSelect = document.getElementById("btn-enable-select");

        // 色塊 Modal 元件
        this.editModal = document.getElementById("modal-palette-edit");
        this.modalTitle = document.getElementById("palette-modal-title");
        this.editIdInput = document.getElementById("edit-palette-id");
        this.editNameInput = document.getElementById("edit-palette-name");
        this.editColorInput = document.getElementById("edit-palette-color");
        this.btnDeletePalette = document.getElementById("btn-delete-palette");

        this.init();
    }

    init() {
        this.renderPalette();

        window.addEventListener("statechange", () => {
            this.renderPalette();
            this.updateSelectedTileInfo();
        });

        // 點擊「👆 點擊選取地塊」按鈕
        this.btnEnableSelect?.addEventListener("click", () => {
            this.state.activeTool = "select";
            document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
            this.btnEnableSelect.classList.add("btn-primary");
            this.btnEnableSelect.classList.remove("btn-secondary");

            if (this.tileInfoDisplay) {
                this.tileInfoDisplay.textContent = "請在畫布上點擊目標地塊...";
            }
        });

        // 新增色塊
        const btnAdd = document.getElementById("btn-add-palette");
        btnAdd?.addEventListener("click", () => {
            this.openAddModal();
        });

        // 儲存色塊
        const btnSavePalette = document.getElementById("btn-save-palette");
        btnSavePalette?.addEventListener("click", () => {
            const id = this.editIdInput.value;
            const name = this.editNameInput.value.trim() || "通用色塊";
            const color = this.editColorInput.value;

            if (!id) {
                const newId = "color_" + Date.now();
                this.state.scheme.palette[newId] = { color, name };
                this.state.activeColorId = newId;
                this.state.pushHistory();
                this.state.notifyStateChange();
            } else {
                this.state.updatePaletteItem(id, { name, color });
            }

            this.editModal?.close();
        });

        // 刪除色塊
        this.btnDeletePalette?.addEventListener("click", () => {
            const id = this.editIdInput.value;
            if (id && confirm("確定要刪除此色塊嗎？")) {
                this.state.deletePaletteItem(id);
                this.editModal?.close();
            }
        });

        // 關閉 Modal
        const btnClosePaletteModal = document.getElementById("btn-close-palette-modal");
        btnClosePaletteModal?.addEventListener("click", () => {
            this.editModal?.close();
        });

        // 標籤輸入
        this.labelInput?.addEventListener("input", (e) => {
            if (this.state.selectedCell) {
                const { x, y } = this.state.selectedCell;
                this.state.setTileLabel(x, y, e.target.value);
            }
        });
    }

    updateSelectedTileInfo() {
        if (this.state.activeTool !== "select" && this.btnEnableSelect) {
            this.btnEnableSelect.classList.remove("btn-primary");
            this.btnEnableSelect.classList.add("btn-secondary");
        }

        if (!this.state.selectedCell) {
            if (this.tileInfoDisplay && this.state.activeTool !== "select") {
                this.tileInfoDisplay.textContent = "未選擇地塊 (點擊上方按鈕進入選取)";
            }
            if (this.labelInput) {
                this.labelInput.value = "";
                this.labelInput.disabled = true;
            }
            return;
        }

        const { x, y } = this.state.selectedCell;
        const z = this.state.currentZLevel;
        const key = `${x},${y},${z}`;
        const tile = this.state.scheme.tiles[key];

        if (this.tileInfoDisplay) {
            this.tileInfoDisplay.textContent = `已選取地塊: (${x + 1}, ${y + 1}), 樓層: ${z}F`;
        }

        if (this.labelInput) {
            this.labelInput.disabled = false;
            this.labelInput.value = (tile && tile.label) ? tile.label : "";
        }
    }

    renderPalette() {
        if (!this.container) return;
        this.container.innerHTML = "";

        const palette = this.state.scheme.palette;
        const keys = Object.keys(palette);

        // 如果 activeColorId 為空或無效，自動預設第一個色塊
        if ((!this.state.activeColorId || !palette[this.state.activeColorId]) && keys.length > 0) {
            this.state.activeColorId = keys[0];
        }

        Object.entries(palette).forEach(([id, item]) => {
            const isSelected = (id === this.state.activeColorId);
            const div = document.createElement("div");
            div.className = `palette-item ${isSelected ? "active" : ""}`;

            const swatch = document.createElement("div");
            swatch.className = "palette-swatch";
            swatch.style.backgroundColor = item.color;

            const name = document.createElement("span");
            name.className = "palette-name";
            name.textContent = item.name;

            const btnEdit = document.createElement("button");
            btnEdit.className = "btn-palette-edit";
            btnEdit.textContent = "✏️ 編輯";
            btnEdit.addEventListener("click", (e) => {
                e.stopPropagation();
                this.openEditModal(id, item);
            });

            div.appendChild(swatch);
            div.appendChild(name);
            div.appendChild(btnEdit);

            div.addEventListener("click", () => {
                this.state.activeColorId = id;
                if (this.state.activeTool === "select") {
                    this.state.activeTool = "pencil";
                    document.getElementById("tool-pencil")?.classList.add("active");
                }
                this.renderPalette();
            });

            this.container.appendChild(div);
        });
    }

    openAddModal() {
        if (!this.editModal) return;
        if (this.modalTitle) this.modalTitle.textContent = "新增通用色塊";
        this.editIdInput.value = "";
        this.editNameInput.value = "新色塊";
        this.editColorInput.value = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");

        if (this.btnDeletePalette) this.btnDeletePalette.style.display = "none";
        this.editModal.showModal();
    }

    openEditModal(id, item) {
        if (!this.editModal) return;
        if (this.modalTitle) this.modalTitle.textContent = "編輯通用色塊";
        this.editIdInput.value = id;
        this.editNameInput.value = item.name;
        this.editColorInput.value = item.color;

        if (this.btnDeletePalette) this.btnDeletePalette.style.display = "inline-flex";
        this.editModal.showModal();
    }
}
