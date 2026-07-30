/**
 * SchemeModal.js - 方案管理視窗 (極簡 Dense Flat Tuple 格式、零原生彈窗、剪貼簿與內建盒體導入導出)
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

        // 內建文字貼上盒體 (零原生彈窗)
        this.boxTextImport = document.getElementById("box-text-import");
        this.inputTextSchemeData = document.getElementById("input-text-scheme-data");
        this.btnCancelTextImport = document.getElementById("btn-cancel-text-import");
        this.btnSubmitTextImport = document.getElementById("btn-submit-text-import");

        this.editingSchemeId = null; // null 表示建立新方案模式

        this.init();
    }

    init() {
        const btnOpenModal = document.getElementById("btn-scheme-modal");
        const btnCloseModal = document.getElementById("btn-close-scheme-modal");

        btnOpenModal?.addEventListener("click", () => {
            this.resetEditorToCreateMode();
            this.hideTextImportBox();
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
            this.hideTextImportBox();
            this.renderSchemeList();
            this.modal?.showModal();
        };

        activeNameEl?.addEventListener("click", handleOpenCurrentSchemeEdit);
        activeDimEl?.addEventListener("click", handleOpenCurrentSchemeEdit);

        // 取消編輯按鈕
        this.btnCancelEdit?.addEventListener("click", () => {
            this.resetEditorToCreateMode();
            this.renderSchemeList();
        });

        // 建立 / 編輯 儲存按鈕
        this.btnSaveEditor?.addEventListener("click", () => {
            const name = this.inputName.value.trim() || i18n.t("modal_schemes_name_placeholder");
            const width = parseInt(this.inputW.value, 10) || 64;
            const height = parseInt(this.inputH.value, 10) || 64;

            if (this.editingSchemeId) {
                this.state.updateSchemeDetails(this.editingSchemeId, name, width, height);
                ToastNotification.show("方案修改成功！", "success");
                this.resetEditorToCreateMode();
            } else {
                const newScheme = {
                    id: "scheme_" + Date.now(),
                    name,
                    width: Math.max(10, Math.min(300, width)),
                    height: Math.max(10, Math.min(300, height)),
                    currentLevel: 0,
                    palette: StorageManager.getDefaultScheme().palette,
                    tiles: {}
                };
                this.state.schemes.push(newScheme);
                this.state.activeSchemeId = newScheme.id;
                this.state.scheme = newScheme;
                this.state.currentZLevel = 0;
                this.state.pushHistory();
                this.state.persist();
                this.state.notifyStateChange();
                ToastNotification.show(i18n.t("toast_scheme_created") || "新方案建立成功！", "success");
                this.resetEditorToCreateMode();
            }

            this.renderSchemeList();
            this.updateHeaderInfo();
        });

        // 💾 匯出 JSON 檔案 (採用極簡平鋪結構)
        const btnExportJson = document.getElementById("btn-export-json") || document.getElementById("btn-export");
        btnExportJson?.addEventListener("click", () => {
            const compactObj = SchemeModal.compactScheme(this.state.scheme);
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(compactObj, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `${this.state.scheme.name}_planboid.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });

        // 📂 匯入 JSON 檔案
        const btnImportJson = document.getElementById("btn-import-json") || document.getElementById("btn-import");
        btnImportJson?.addEventListener("click", () => {
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".json";
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const rawObj = JSON.parse(event.target.result);
                        this.processImportSchemeObj(rawObj);
                        ToastNotification.show(i18n.t("toast_scheme_imported") || "方案匯入成功！", "success");
                    } catch (err) {
                        ToastNotification.show("讀取 JSON 檔案失敗，請檢查格式", "error");
                    }
                };
                reader.readAsText(file);
            };
            fileInput.click();
        });

        // 📋 複製極簡文字至剪貼簿
        const btnExportClip = document.getElementById("btn-export-clipboard");
        btnExportClip?.addEventListener("click", async () => {
            try {
                const compactObj = SchemeModal.compactScheme(this.state.scheme);
                const jsonStr = JSON.stringify(compactObj);
                await navigator.clipboard.writeText(jsonStr);
                ToastNotification.show(i18n.t("toast_clipboard_exported") || "已成功將方案文字複製至剪貼簿！", "success");
            } catch (err) {
                ToastNotification.show("複製至剪貼簿失敗，請檢查權限", "error");
            }
        });

        // 📝 貼上/輸入極簡文字匯入 (零原生 prompt 彈窗)
        const btnImportText = document.getElementById("btn-import-text");
        btnImportText?.addEventListener("click", async () => {
            let clipboardText = "";
            try {
                if (navigator.clipboard && navigator.clipboard.readText) {
                    clipboardText = await navigator.clipboard.readText();
                }
            } catch (e) {
                // Ignore clipboard read error
            }

            // 優先嘗試直接解析剪貼簿中合法的 JSON 內容
            if (clipboardText && clipboardText.trim()) {
                try {
                    const rawObj = JSON.parse(clipboardText.trim());
                    this.processImportSchemeObj(rawObj);
                    ToastNotification.show(i18n.t("toast_text_imported") || "已自動從剪貼簿成功匯入方案！", "success");
                    return;
                } catch (e) {
                    // 非合法 JSON，開盒體讓使用者確認/貼上
                }
            }

            // 若自動讀取失敗或剪貼簿內容非方案，開啟內建 Modal 盒體
            this.showTextImportBox(clipboardText);
            this.renderSchemeList();
            this.modal?.showModal();
        });

        // 內建盒體事件綁定
        this.btnCancelTextImport?.addEventListener("click", () => {
            this.hideTextImportBox();
        });

        this.btnSubmitTextImport?.addEventListener("click", () => {
            const val = this.inputTextSchemeData?.value || "";
            if (!val.trim()) return;

            try {
                const rawObj = JSON.parse(val.trim());
                this.processImportSchemeObj(rawObj);
                this.hideTextImportBox();
                this.modal?.close();
                ToastNotification.show(i18n.t("toast_text_imported") || "方案文字匯入成功！", "success");
            } catch (err) {
                ToastNotification.show(i18n.t("toast_text_import_invalid") || "無效的方案文字內容！", "error");
            }
        });

        this.updateHeaderInfo();
    }

    showTextImportBox(prefillText = "") {
        if (this.boxTextImport) {
            this.boxTextImport.style.display = "flex";
            if (this.inputTextSchemeData) {
                this.inputTextSchemeData.value = prefillText;
                this.inputTextSchemeData.focus();
            }
        }
    }

    hideTextImportBox() {
        if (this.boxTextImport) {
            this.boxTextImport.style.display = "none";
            if (this.inputTextSchemeData) this.inputTextSchemeData.value = "";
        }
    }

    processImportSchemeObj(rawObj) {
        const scheme = SchemeModal.decompactScheme(rawObj);
        scheme.id = "scheme_" + Date.now();
        this.state.normalizeSchemeTiles(scheme);

        const existingIdx = this.state.schemes.findIndex(s => s.name === scheme.name);
        if (existingIdx === -1) {
            this.state.schemes.push(scheme);
        } else {
            this.state.schemes[existingIdx] = scheme;
        }

        this.state.activeSchemeId = scheme.id;
        this.state.scheme = scheme;
        this.state.currentZLevel = scheme.currentLevel || 0;
        this.state.pushHistory();
        this.state.persist();
        this.state.notifyStateChange();

        this.renderSchemeList();
        this.updateHeaderInfo();
    }

    /**
     * 將 scheme 轉換為極簡平鋪陣列 (Dense Flat Tuple List) 結構
     * d: [ [x, y, z, type, val], ... ]
     * type: 0 = 塊 (floor), 1 = 北牆 (north wall), 2 = 西牆 (west wall), 3 = 標籤 (label)
     */
    static compactScheme(scheme) {
        const paletteMap = {};
        const paletteList = [];
        if (scheme.palette) {
            Object.entries(scheme.palette).forEach(([id, item], idx) => {
                paletteMap[id] = idx;
                paletteList.push({ n: item.name, c: item.color });
            });
        }

        const denseTuples = [];
        if (scheme.tiles) {
            Object.entries(scheme.tiles).forEach(([key, tile]) => {
                const [x, y, z] = key.split(',').map(Number);
                if (tile.floorColorId !== undefined && paletteMap[tile.floorColorId] !== undefined) {
                    denseTuples.push([x, y, z, 0, paletteMap[tile.floorColorId]]);
                }
                if (tile.walls) {
                    if (tile.walls.north && paletteMap[tile.walls.north] !== undefined) {
                        denseTuples.push([x, y, z, 1, paletteMap[tile.walls.north]]);
                    }
                    if (tile.walls.west && paletteMap[tile.walls.west] !== undefined) {
                        denseTuples.push([x, y, z, 2, paletteMap[tile.walls.west]]);
                    }
                }
                if (tile.label) {
                    denseTuples.push([x, y, z, 3, tile.label]);
                }
            });
        }

        return {
            n: scheme.name,
            w: scheme.width,
            h: scheme.height,
            ox: scheme.worldOriginX || 10500,
            oy: scheme.worldOriginY || 9200,
            p: paletteList,
            d: denseTuples
        };
    }

    /**
     * 將極簡平鋪陣列 (Dense Flat Tuple List) 還原為標準 Scheme 結構 (相容舊版結構)
     */
    static decompactScheme(compactObj) {
        if (compactObj.tiles || compactObj.width) {
            return compactObj; // 舊版 Full Scheme 相容
        }

        const palette = {};
        const paletteIdMap = {};
        if (Array.isArray(compactObj.p)) {
            compactObj.p.forEach((item, idx) => {
                const id = "p_" + idx;
                paletteIdMap[idx] = id;
                palette[id] = { name: item.n, color: item.c };
            });
        } else if (compactObj.p) {
            Object.assign(palette, compactObj.p);
        }

        const tiles = {};
        if (Array.isArray(compactObj.d)) {
            compactObj.d.forEach(tuple => {
                const [x, y, z, type, val] = tuple;
                const key = `${x},${y},${z}`;
                if (!tiles[key]) tiles[key] = {};

                if (type === 0) {
                    const colorId = paletteIdMap[val] !== undefined ? paletteIdMap[val] : val;
                    tiles[key].floorColorId = colorId;
                } else if (type === 1 || type === 2) {
                    if (!tiles[key].walls) tiles[key].walls = {};
                    const colorId = paletteIdMap[val] !== undefined ? paletteIdMap[val] : val;
                    const wallEdge = type === 1 ? "north" : "west";
                    tiles[key].walls[wallEdge] = colorId;
                } else if (type === 3) {
                    tiles[key].label = val;
                }
            });
        }

        return {
            id: "scheme_" + Date.now(),
            name: compactObj.n || "匯入方案",
            width: compactObj.w || 64,
            height: compactObj.h || 64,
            worldOriginX: compactObj.ox || 10500,
            worldOriginY: compactObj.oy || 9200,
            palette,
            tiles
        };
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

    updateHeaderInfo() {
        const nameEl = document.getElementById("active-scheme-name");
        const dimEl = document.getElementById("active-scheme-dim");
        if (nameEl) nameEl.textContent = this.state.scheme.name;
        if (dimEl) dimEl.textContent = `(${this.state.scheme.width} x ${this.state.scheme.height})`;
    }

    renderSchemeList() {
        if (!this.schemeListContainer) return;
        this.schemeListContainer.innerHTML = "";

        this.state.schemes.forEach(scheme => {
            const isUsing = (scheme.id === this.state.activeSchemeId);
            const itemDiv = document.createElement("div");
            itemDiv.className = `scheme-item ${isUsing ? "active" : ""}`;

            const infoDiv = document.createElement("div");
            infoDiv.className = "scheme-info";

            const nameSpan = document.createElement("span");
            nameSpan.className = "scheme-name";
            nameSpan.textContent = scheme.name;

            const sizeSpan = document.createElement("span");
            sizeSpan.className = "scheme-size";
            sizeSpan.textContent = `${scheme.width} x ${scheme.height}`;

            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(sizeSpan);

            const actionsDiv = document.createElement("div");
            actionsDiv.className = "scheme-actions";

            const btnEdit = document.createElement("button");
            btnEdit.className = "btn";
            btnEdit.textContent = i18n.t("modal_schemes_btn_edit_details", {}, "zh") || "✏️ 編輯";
            btnEdit.addEventListener("click", () => {
                this.setEditorToEditMode(scheme.id);
                this.renderSchemeList();
            });
            actionsDiv.appendChild(btnEdit);

            if (isUsing) {
                const badge = document.createElement("span");
                badge.className = "badge badge-active";
                badge.textContent = i18n.t("modal_schemes_btn_using");
                actionsDiv.appendChild(badge);
            } else {
                const btnSwitch = document.createElement("button");
                btnSwitch.className = "btn";
                btnSwitch.textContent = i18n.t("modal_schemes_btn_switch");
                btnSwitch.addEventListener("click", () => {
                    this.state.activeSchemeId = scheme.id;
                    this.state.scheme = scheme;
                    this.state.currentZLevel = scheme.currentLevel || 0;
                    this.state.pushHistory();
                    this.state.persist();
                    this.state.notifyStateChange();
                    this.renderSchemeList();
                    this.updateHeaderInfo();
                    ToastNotification.show(`已切換至方案: ${scheme.name}`, "info");
                });
                actionsDiv.appendChild(btnSwitch);

                if (this.state.schemes.length > 1) {
                    const btnDel = document.createElement("button");
                    btnDel.className = "btn btn-danger";
                    btnDel.textContent = "🗑️";
                    btnDel.title = i18n.t("modal_schemes_btn_delete_title", {}, "zh") || "刪除方案";
                    btnDel.addEventListener("click", async () => {
                        const confirmed = await ConfirmModal.show(`確定要刪除方案「${scheme.name}」嗎？`);
                        if (confirmed) {
                            this.state.deleteScheme(scheme.id);
                            this.renderSchemeList();
                            this.updateHeaderInfo();
                            ToastNotification.show("方案已刪除", "info");
                        }
                    });
                    actionsDiv.appendChild(btnDel);
                }
            }

            itemDiv.appendChild(infoDiv);
            itemDiv.appendChild(actionsDiv);
            this.schemeListContainer.appendChild(itemDiv);
        });
    }
}
