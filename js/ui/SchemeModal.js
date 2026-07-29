/**
 * SchemeModal.js - 方案管理視窗 (支援自訂尺寸動態調整、重新命名與刪除)
 */

import { StorageManager } from "../core/StorageManager.js";

export class SchemeModal {
    /**
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     */
    constructor(stateManager) {
        this.state = stateManager;
        this.modal = document.getElementById("modal-schemes");
        this.schemeListContainer = document.getElementById("scheme-list-container");

        this.init();
    }

    init() {
        const btnOpenModal = document.getElementById("btn-scheme-modal");
        const btnCloseModal = document.getElementById("btn-close-scheme-modal");

        btnOpenModal?.addEventListener("click", () => {
            this.renderSchemeList();
            this.modal?.showModal();
        });

        btnCloseModal?.addEventListener("click", () => {
            this.modal?.close();
        });

        // 頂部方案名稱與尺寸點擊可直接修改名稱與寬高尺寸
        const activeNameEl = document.getElementById("active-scheme-name");
        const activeDimEl = document.getElementById("active-scheme-dim");

        const handleEditCurrentScheme = () => {
            const currentName = this.state.scheme.name;
            const currentW = this.state.scheme.width;
            const currentH = this.state.scheme.height;

            const newName = prompt("方案名稱:", currentName);
            if (newName === null) return;

            const newWStr = prompt("方案寬度 (10~300):", currentW);
            if (newWStr === null) return;

            const newHStr = prompt("方案高度 (10~300):", currentH);
            if (newHStr === null) return;

            const name = newName.trim() || currentName;
            const w = Math.max(10, Math.min(300, parseInt(newWStr, 10) || currentW));
            const h = Math.max(10, Math.min(300, parseInt(newHStr, 10) || currentH));

            this.state.updateSchemeDetails(this.state.scheme.id, name, w, h);
            this.updateHeaderInfo();
        };

        activeNameEl?.addEventListener("click", handleEditCurrentScheme);
        activeDimEl?.addEventListener("click", handleEditCurrentScheme);

        // 建立自訂新方案 (可調名稱與尺寸)
        const btnCreate = document.getElementById("btn-create-scheme");
        const inputName = document.getElementById("new-scheme-name");
        const inputW = document.getElementById("new-scheme-width");
        const inputH = document.getElementById("new-scheme-height");

        btnCreate?.addEventListener("click", () => {
            const name = inputName.value.trim() || "自訂規劃方案";
            const width = Math.max(10, Math.min(300, parseInt(inputW.value, 10) || 64));
            const height = Math.max(10, Math.min(300, parseInt(inputH.value, 10) || 64));

            const newScheme = StorageManager.getDefaultScheme();
            newScheme.name = name;
            newScheme.width = width;
            newScheme.height = height;

            this.state.schemes.push(newScheme);
            this.state.activeSchemeId = newScheme.id;
            this.state.scheme = newScheme;
            this.state.currentZLevel = 0;
            this.state.pushHistory();

            inputName.value = "";
            this.renderSchemeList();
            this.updateHeaderInfo();
            this.state.notifyStateChange();
        });

        // 匯出 JSON 檔案
        const btnExport = document.getElementById("btn-export");
        btnExport?.addEventListener("click", () => {
            const jsonStr = JSON.stringify(this.state.scheme, null, 2);
            const blob = new Blob([jsonStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `${this.state.scheme.name}_planboid.json`;
            a.click();
            URL.revokeObjectURL(url);
        });

        // 匯入 JSON 檔案 (支援舊版相容性自動正規化)
        const btnImport = document.getElementById("btn-import");
        btnImport?.addEventListener("click", () => {
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".json";

            fileInput.addEventListener("change", (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const importedScheme = JSON.parse(event.target.result);
                        if (!importedScheme.tiles || !importedScheme.palette) {
                            alert("無效的 Planboid JSON 方案檔案格式！");
                            return;
                        }

                        importedScheme.id = "scheme_" + Date.now();
                        this.state.normalizeSchemeTiles(importedScheme);

                        this.state.schemes.push(importedScheme);
                        this.state.activeSchemeId = importedScheme.id;
                        this.state.scheme = importedScheme;
                        this.state.currentZLevel = 0;
                        this.state.pushHistory();

                        this.updateHeaderInfo();
                        this.state.notifyStateChange();
                        alert(`成功匯入方案：「${importedScheme.name}」！`);
                    } catch (err) {
                        alert("讀取檔案失敗：" + err.message);
                    }
                };
                reader.readAsText(file);
            });

            fileInput.click();
        });

        // 分享連結
        const btnShare = document.getElementById("btn-share");
        btnShare?.addEventListener("click", () => {
            const jsonStr = JSON.stringify(this.state.scheme);
            const base64 = btoa(encodeURIComponent(jsonStr));
            const shareUrl = `${location.origin}${location.pathname}#scheme=${base64}`;

            navigator.clipboard.writeText(shareUrl).then(() => {
                alert("已將全方案分享連結複製至剪貼簿！可直接傳送給他人開啟。");
            }).catch(() => {
                prompt("請複製以下分享連結：", shareUrl);
            });
        });

        this.checkUrlHashImport();
        this.updateHeaderInfo();
    }

    checkUrlHashImport() {
        if (location.hash.startsWith("#scheme=")) {
            try {
                const base64 = location.hash.replace("#scheme=", "");
                const jsonStr = decodeURIComponent(atob(base64));
                const scheme = JSON.parse(jsonStr);

                scheme.id = "shared_" + Date.now();
                this.state.normalizeSchemeTiles(scheme);

                this.state.schemes.push(scheme);
                this.state.activeSchemeId = scheme.id;
                this.state.scheme = scheme;
                this.state.pushHistory();
                console.log("成功從 URL 分享連結載入方案:", scheme.name);
            } catch (e) {
                console.error("解析 URL 分享方案失敗:", e);
            }
        }
    }

    updateHeaderInfo() {
        const nameEl = document.getElementById("active-scheme-name");
        const dimEl = document.getElementById("active-scheme-dim");
        if (nameEl) nameEl.textContent = this.state.scheme.name;
        if (dimEl) dimEl.textContent = `(${this.state.scheme.width} x ${this.state.scheme.height})`;
    }

    renderSchemeList() {
        if (!this.schemeListContainer) return;
        this.schemeListContainer.innerHTML = "";

        this.state.schemes.forEach(s => {
            const li = document.createElement("li");
            li.style.display = "flex";
            li.style.alignItems = "center";
            li.style.justifyContent = "space-between";
            li.style.padding = "10px 14px";
            li.style.backgroundColor = s.id === this.state.activeSchemeId ? "rgba(99,102,241,0.2)" : "var(--bg-dark)";
            li.style.borderRadius = "var(--radius-sm)";
            li.style.border = s.id === this.state.activeSchemeId ? "1px solid var(--accent-primary)" : "1px solid var(--border-color)";

            const infoDiv = document.createElement("div");
            infoDiv.style.display = "flex";
            infoDiv.style.alignItems = "center";
            infoDiv.style.gap = "8px";
            infoDiv.innerHTML = `
                <strong style="color: var(--text-primary); cursor: pointer;" title="點擊調整名稱與尺寸">${s.name}</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted);">(${s.width}x${s.height})</span>
            `;

            const btnGroup = document.createElement("div");
            btnGroup.style.display = "flex";
            btnGroup.style.gap = "6px";

            // 調整尺寸與名稱按鈕 ✏️
            const btnRename = document.createElement("button");
            btnRename.className = "btn-palette-edit";
            btnRename.textContent = "✏️ 調整名稱/尺寸";
            btnRename.addEventListener("click", () => {
                const newName = prompt("請輸入方案新名稱:", s.name);
                if (newName === null) return;
                const newWStr = prompt("方案寬度 (10~300):", s.width);
                if (newWStr === null) return;
                const newHStr = prompt("方案高度 (10~300):", s.height);
                if (newHStr === null) return;

                const name = newName.trim() || s.name;
                const w = Math.max(10, Math.min(300, parseInt(newWStr, 10) || s.width));
                const h = Math.max(10, Math.min(300, parseInt(newHStr, 10) || s.height));

                this.state.updateSchemeDetails(s.id, name, w, h);
                this.renderSchemeList();
                this.updateHeaderInfo();
            });

            // 切換按鈕
            const btnSwitch = document.createElement("button");
            btnSwitch.className = "btn btn-sm";
            btnSwitch.textContent = s.id === this.state.activeSchemeId ? "使用中" : "切換";
            btnSwitch.disabled = s.id === this.state.activeSchemeId;
            btnSwitch.addEventListener("click", () => {
                this.state.activeSchemeId = s.id;
                this.state.scheme = s;
                this.state.currentZLevel = 0;
                this.state.pushHistory();
                this.updateHeaderInfo();
                this.renderSchemeList();
                this.state.notifyStateChange();
            });

            // 刪除按鈕 🗑️
            const btnDelete = document.createElement("button");
            btnDelete.className = "btn-palette-edit";
            btnDelete.style.color = "var(--accent-danger)";
            btnDelete.textContent = "🗑️";
            btnDelete.title = "刪除方案";
            btnDelete.addEventListener("click", () => {
                if (confirm(`確定要刪除方案「${s.name}」嗎？`)) {
                    if (this.state.deleteScheme(s.id)) {
                        this.renderSchemeList();
                        this.updateHeaderInfo();
                    }
                }
            });

            btnGroup.appendChild(btnRename);
            btnGroup.appendChild(btnSwitch);
            btnGroup.appendChild(btnDelete);

            li.appendChild(infoDiv);
            li.appendChild(btnGroup);
            this.schemeListContainer.appendChild(li);
        });
    }
}
