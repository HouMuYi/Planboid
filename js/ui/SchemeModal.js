/**
 * SchemeModal.js - 方案管理視窗 (平鋪 i18n 整合)
 */

import { StorageManager } from "../core/StorageManager.js";
import { i18n } from "../core/I18nManager.js";

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

        const activeNameEl = document.getElementById("active-scheme-name");
        const activeDimEl = document.getElementById("active-scheme-dim");

        const handleEditCurrentScheme = () => {
            const currentName = this.state.scheme.name;
            const currentW = this.state.scheme.width;
            const currentH = this.state.scheme.height;

            const newName = prompt(i18n.t("modal_schemes_prompt_scheme_name"), currentName);
            if (newName === null) return;

            const newWStr = prompt(i18n.t("modal_schemes_prompt_scheme_width"), currentW);
            if (newWStr === null) return;

            const newHStr = prompt(i18n.t("modal_schemes_prompt_scheme_height"), currentH);
            if (newHStr === null) return;

            const name = newName.trim() || currentName;
            const w = Math.max(10, Math.min(300, parseInt(newWStr, 10) || currentW));
            const h = Math.max(10, Math.min(300, parseInt(newHStr, 10) || currentH));

            this.state.updateSchemeDetails(this.state.scheme.id, name, w, h);
            this.updateHeaderInfo();
        };

        activeNameEl?.addEventListener("click", handleEditCurrentScheme);
        activeDimEl?.addEventListener("click", handleEditCurrentScheme);

        const btnCreate = document.getElementById("btn-create-scheme");
        const inputName = document.getElementById("new-scheme-name");
        const inputW = document.getElementById("new-scheme-width");
        const inputH = document.getElementById("new-scheme-height");

        btnCreate?.addEventListener("click", () => {
            const name = inputName.value.trim() || i18n.t("defaults_scheme_name");
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
                            alert(i18n.t("modal_schemes_alert_import_invalid"));
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
                        alert(i18n.t("modal_schemes_alert_import_success", { name: importedScheme.name }));
                    } catch (err) {
                        alert(i18n.t("modal_schemes_alert_import_error", { error: err.message }));
                    }
                };
                reader.readAsText(file);
            });

            fileInput.click();
        });

        const btnShare = document.getElementById("btn-share");
        btnShare?.addEventListener("click", () => {
            const jsonStr = JSON.stringify(this.state.scheme);
            const base64 = btoa(encodeURIComponent(jsonStr));
            const shareUrl = `${location.origin}${location.pathname}#scheme=${base64}`;

            navigator.clipboard.writeText(shareUrl).then(() => {
                alert(i18n.t("modal_schemes_alert_share_copied"));
            }).catch(() => {
                prompt(i18n.t("modal_schemes_prompt_share_url"), shareUrl);
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
                <strong style="color: var(--text-primary); cursor: pointer;">${s.name}</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted);">(${s.width}x${s.height})</span>
            `;

            const btnGroup = document.createElement("div");
            btnGroup.style.display = "flex";
            btnGroup.style.gap = "6px";

            const btnRename = document.createElement("button");
            btnRename.className = "btn-palette-edit";
            btnRename.textContent = i18n.t("modal_schemes_btn_edit_details");
            btnRename.addEventListener("click", () => {
                const newName = prompt(i18n.t("modal_schemes_prompt_scheme_name"), s.name);
                if (newName === null) return;
                const newWStr = prompt(i18n.t("modal_schemes_prompt_scheme_width"), s.width);
                if (newWStr === null) return;
                const newHStr = prompt(i18n.t("modal_schemes_prompt_scheme_height"), s.height);
                if (newHStr === null) return;

                const name = newName.trim() || s.name;
                const w = Math.max(10, Math.min(300, parseInt(newWStr, 10) || s.width));
                const h = Math.max(10, Math.min(300, parseInt(newHStr, 10) || s.height));

                this.state.updateSchemeDetails(s.id, name, w, h);
                this.renderSchemeList();
                this.updateHeaderInfo();
            });

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

            const btnDelete = document.createElement("button");
            btnDelete.className = "btn-palette-edit";
            btnDelete.style.color = "var(--accent-danger)";
            btnDelete.textContent = "🗑️";
            btnDelete.title = i18n.t("modal_schemes_btn_delete_title");
            btnDelete.addEventListener("click", () => {
                if (confirm(i18n.t("modal_schemes_confirm_delete", { name: s.name }))) {
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
