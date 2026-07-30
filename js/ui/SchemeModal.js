/**
 * SchemeModal.js - 方案管理視窗 (零原生彈窗，與建立/編輯方案同 UI 盒體)
 */

import { StorageManager } from "../core/StorageManager.js";
import { i18n } from "../core/I18nManager.js";
import { ToastNotification } from "./ToastNotification.js";
import { ConfirmModal } from "./ConfirmModal.js";

export class SchemeModal {
    /**
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     */
    constructor(stateManager) {
        this.state = stateManager;
        this.modal = document.getElementById("modal-schemes");
        this.schemeListContainer = document.getElementById("scheme-list-container");

        // 方案編輯/建立盒體控制元素
        this.editorIdInput = document.getElementById("scheme-editor-id");
        this.editorTitle = document.getElementById("scheme-editor-title");
        this.btnCancelEdit = document.getElementById("btn-cancel-scheme-editor");
        this.inputName = document.getElementById("new-scheme-name");
        this.inputW = document.getElementById("new-scheme-width");
        this.inputH = document.getElementById("new-scheme-height");
        this.btnSaveEditor = document.getElementById("btn-save-scheme-editor");

        this.editingSchemeId = null; // null 表示建立新方案模式

        this.init();
    }

    init() {
        const btnOpenModal = document.getElementById("btn-scheme-modal");
        const btnCloseModal = document.getElementById("btn-close-scheme-modal");

        btnOpenModal?.addEventListener("click", () => {
            this.resetEditorToCreateMode();
            this.renderSchemeList();
            this.modal?.showModal();
        });

        btnCloseModal?.addEventListener("click", () => {
            this.modal?.close();
        });

        // 頂部方案名稱與尺寸點擊直接切換為編輯模式並開啟 Modal
        const activeNameEl = document.getElementById("active-scheme-name");
        const activeDimEl = document.getElementById("active-scheme-dim");

        const handleOpenCurrentSchemeEdit = () => {
            this.setEditorToEditMode(this.state.scheme.id);
            this.renderSchemeList();
            this.modal?.showModal();
        };

        activeNameEl?.addEventListener("click", handleOpenCurrentSchemeEdit);
        activeDimEl?.addEventListener("click", handleOpenCurrentSchemeEdit);

        // 取消編輯按鈕
        this.btnCancelEdit?.addEventListener("click", () => {
            this.resetEditorToCreateMode();
        });

        // 建立或儲存方案按鈕 (同 UI 盒體)
        this.btnSaveEditor?.addEventListener("click", () => {
            const name = this.inputName.value.trim() || i18n.t("defaults_scheme_name");
            const width = Math.max(10, Math.min(300, parseInt(this.inputW.value, 10) || 64));
            const height = Math.max(10, Math.min(300, parseInt(this.inputH.value, 10) || 64));

            if (!this.editingSchemeId) {
                // 建立新方案模式
                const newScheme = StorageManager.getDefaultScheme();
                newScheme.name = name;
                newScheme.width = width;
                newScheme.height = height;

                this.state.schemes.push(newScheme);
                this.state.activeSchemeId = newScheme.id;
                this.state.scheme = newScheme;
                this.state.currentZLevel = 0;
                this.state.pushHistory();

                ToastNotification.show(i18n.t("modal_schemes_alert_create_success", {}, "zh") || `已成功建立方案：「${name}」！`, "success");
            } else {
                // 編輯既有方案模式
                this.state.updateSchemeDetails(this.editingSchemeId, name, width, height);
                ToastNotification.show(i18n.t("modal_schemes_alert_save_success", {}, "zh") || `已更新方案：「${name}」！`, "success");
            }

            this.resetEditorToCreateMode();
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
            ToastNotification.show("已匯出方案 JSON 檔案！");
        });

        // 匯入 JSON 檔案
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
                            ToastNotification.show(i18n.t("modal_schemes_alert_import_invalid"), "error");
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
                        ToastNotification.show(i18n.t("modal_schemes_alert_import_success", { name: importedScheme.name }), "success");
                    } catch (err) {
                        ToastNotification.show(i18n.t("modal_schemes_alert_import_error", { error: err.message }), "error");
                    }
                };
                reader.readAsText(file);
            });

            fileInput.click();
        });

        // 分享連結 (ToastNotification 提示，無原生 alert/prompt)
        const btnShare = document.getElementById("btn-share");
        btnShare?.addEventListener("click", () => {
            const jsonStr = JSON.stringify(this.state.scheme);
            const base64 = btoa(encodeURIComponent(jsonStr));
            const shareUrl = `${location.origin}${location.pathname}#scheme=${base64}`;

            navigator.clipboard.writeText(shareUrl).then(() => {
                ToastNotification.show(i18n.t("modal_schemes_alert_share_copied"), "success");
            }).catch(() => {
                ToastNotification.show("無法自動寫入剪貼簿，請查看控制台網址", "error");
                console.log("Planboid 分享網址:", shareUrl);
            });
        });

        this.checkUrlHashImport();
        this.updateHeaderInfo();
    }

    resetEditorToCreateMode() {
        this.editingSchemeId = null;
        if (this.editorIdInput) this.editorIdInput.value = "";
        if (this.editorTitle) this.editorTitle.textContent = i18n.t("modal_schemes_create_title");
        if (this.btnSaveEditor) this.btnSaveEditor.textContent = i18n.t("modal_schemes_btn_create");
        if (this.btnCancelEdit) this.btnCancelEdit.style.display = "none";

        if (this.inputName) this.inputName.value = "";
        if (this.inputW) this.inputW.value = 64;
        if (this.inputH) this.inputH.value = 64;
    }

    setEditorToEditMode(schemeId) {
        const target = this.state.schemes.find(s => s.id === schemeId);
        if (!target) return;

        this.editingSchemeId = schemeId;
        if (this.editorIdInput) this.editorIdInput.value = schemeId;
        if (this.editorTitle) this.editorTitle.textContent = i18n.t("modal_schemes_edit_title", {}, "zh") || "編輯方案";
        if (this.btnSaveEditor) this.btnSaveEditor.textContent = i18n.t("modal_palette_btn_save", {}, "zh") || "儲存變更";
        if (this.btnCancelEdit) this.btnCancelEdit.style.display = "inline-flex";

        if (this.inputName) this.inputName.value = target.name;
        if (this.inputW) this.inputW.value = target.width;
        if (this.inputH) this.inputH.value = target.height;
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
            const isEditingThis = (this.editingSchemeId === s.id);
            const li = document.createElement("li");
            li.style.display = "flex";
            li.style.alignItems = "center";
            li.style.justifyContent = "space-between";
            li.style.padding = "10px 14px";
            li.style.backgroundColor = isEditingThis ? "rgba(245,158,11,0.18)" : (s.id === this.state.activeSchemeId ? "rgba(99,102,241,0.2)" : "var(--bg-dark)");
            li.style.borderRadius = "var(--radius-sm)";
            li.style.border = isEditingThis ? "1px solid var(--accent-secondary)" : (s.id === this.state.activeSchemeId ? "1px solid var(--accent-primary)" : "1px solid var(--border-color)");

            const infoDiv = document.createElement("div");
            infoDiv.style.display = "flex";
            infoDiv.style.alignItems = "center";
            infoDiv.style.gap = "8px";
            infoDiv.innerHTML = `
                <strong style="color: var(--text-primary); cursor: pointer;">${s.name}</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted);">(${s.width}x${s.height})</span>
            `;

            const btnGroup = document.createElement("div");
            btnGroup.style.display = "flex";
            btnGroup.style.gap = "6px";

            // 編輯按鈕 (切換同 UI 盒體)
            const btnRename = document.createElement("button");
            btnRename.className = "btn-palette-edit";
            btnRename.textContent = i18n.t("modal_schemes_btn_edit_details");
            btnRename.addEventListener("click", () => {
                this.setEditorToEditMode(s.id);
                this.renderSchemeList();
            });

            // 切換按鈕
            const btnSwitch = document.createElement("button");
            btnSwitch.className = "btn btn-sm";
            btnSwitch.textContent = s.id === this.state.activeSchemeId ? i18n.t("modal_schemes_btn_using") : i18n.t("modal_schemes_btn_switch");
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

            // 刪除按鈕 🗑️ (ConfirmModal 二次確認)
            const btnDelete = document.createElement("button");
            btnDelete.className = "btn-palette-edit";
            btnDelete.style.color = "var(--accent-danger)";
            btnDelete.textContent = "🗑️";
            btnDelete.title = i18n.t("modal_schemes_btn_delete_title");
            btnDelete.addEventListener("click", async () => {
                if (this.state.schemes.length <= 1) {
                    ToastNotification.show(i18n.t("modal_schemes_alert_keep_one"), "error");
                    return;
                }

                const confirmed = await ConfirmModal.show(i18n.t("modal_schemes_confirm_delete", { name: s.name }));
                if (confirmed) {
                    if (this.state.deleteScheme(s.id)) {
                        this.resetEditorToCreateMode();
                        this.renderSchemeList();
                        this.updateHeaderInfo();
                        ToastNotification.show(`已刪除方案：「${s.name}」`, "info");
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
