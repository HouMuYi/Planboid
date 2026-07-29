/**
 * StateManager.js - 核心狀態管理器 (含剪貼簿 Ctrl+C / Ctrl+V / Delete)
 */

import { StorageManager } from "./StorageManager.js";

export class StateManager {
    constructor() {
        const storedData = StorageManager.loadData();
        this.schemes = storedData.schemes || [];
        this.activeSchemeId = storedData.activeSchemeId;

        this.scheme = this.schemes.find(s => s.id === this.activeSchemeId) || this.schemes[0];
        if (!this.scheme) {
            this.scheme = StorageManager.getDefaultScheme();
            this.schemes = [this.scheme];
            this.activeSchemeId = this.scheme.id;
        }

        // 目前編輯狀態
        this.currentZLevel = this.scheme.currentLevel || 0;
        this.activeTool = "pencil";         // "pencil" | "eraser" | "select"
        this.shapeMode = "single";          // "single" | "line" | "box"
        this.brushType = "floor";           // "floor" | "wall"
        this.selectedCell = null;           // { x, y }
        this.selectionBox = null;           // { minX, minY, maxX, maxY }

        // 強制預設選取第一個色塊
        const paletteKeys = Object.keys(this.scheme.palette || {});
        this.activeColorId = (paletteKeys.length > 0) ? paletteKeys[0] : "";

        // 剪貼簿 (Clipboard for Copy/Paste)
        this.clipboard = null;              // { originX, originY, tiles: { "relX,relY": tileData } }
        this.isPastingMode = false;

        // 視覺與遊戲開關
        this.ghostLayerEnabled = true;
        this.visualOffsetEnabled = true;
        this.is3DWallsEnabled = true;

        // Undo / Redo
        this.maxHistory = 30;
        this.undoStack = [];
        this.redoStack = [];

        this.pushHistory();
    }

    pushHistory() {
        const snapshot = JSON.stringify(this.scheme);
        if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) {
            return;
        }
        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.persist();
    }

    undo() {
        if (this.undoStack.length <= 1) return false;
        const currentSnap = this.undoStack.pop();
        this.redoStack.push(currentSnap);

        const prevSnap = this.undoStack[this.undoStack.length - 1];
        this.scheme = JSON.parse(prevSnap);

        const paletteKeys = Object.keys(this.scheme.palette || {});
        if (!this.scheme.palette[this.activeColorId] && paletteKeys.length > 0) {
            this.activeColorId = paletteKeys[0];
        }

        this.persist();
        this.notifyStateChange();
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) return false;
        const nextSnap = this.redoStack.pop();
        this.undoStack.push(nextSnap);
        this.scheme = JSON.parse(nextSnap);

        const paletteKeys = Object.keys(this.scheme.palette || {});
        if (!this.scheme.palette[this.activeColorId] && paletteKeys.length > 0) {
            this.activeColorId = paletteKeys[0];
        }

        this.persist();
        this.notifyStateChange();
        return true;
    }

    persist() {
        const idx = this.schemes.findIndex(s => s.id === this.scheme.id);
        if (idx !== -1) {
            this.schemes[idx] = this.scheme;
        }
        StorageManager.saveData({
            activeSchemeId: this.activeSchemeId,
            schemes: this.schemes
        });
    }

    notifyStateChange() {
        window.dispatchEvent(new CustomEvent("statechange", { detail: { scheme: this.scheme } }));
    }

    setZLevel(level) {
        this.currentZLevel = Math.max(-2, Math.min(8, level));
        this.scheme.currentLevel = this.currentZLevel;
        this.notifyStateChange();
    }

    setWorldOrigin(x, y) {
        this.scheme.worldOriginX = x;
        this.scheme.worldOriginY = y;
        this.pushHistory();
        this.notifyStateChange();
    }

    renameScheme(id, newName) {
        const target = this.schemes.find(s => s.id === id);
        if (target) {
            target.name = newName;
            this.persist();
            this.notifyStateChange();
        }
    }

    deleteScheme(id) {
        if (this.schemes.length <= 1) {
            alert("必須保留至少一個方案！");
            return false;
        }
        this.schemes = this.schemes.filter(s => s.id !== id);
        if (this.activeSchemeId === id) {
            this.scheme = this.schemes[0];
            this.activeSchemeId = this.scheme.id;
            this.currentZLevel = 0;
            this.pushHistory();
        }
        this.persist();
        this.notifyStateChange();
        return true;
    }

    // --------------------------------------------------------------------------
    // 剪貼簿 (Copy / Paste / Delete Selection)
    // --------------------------------------------------------------------------

    copySelection() {
        if (!this.selectionBox) {
            if (this.selectedCell) {
                // 單點複製
                const { x, y } = this.selectedCell;
                this.selectionBox = { minX: x, minY: y, maxX: x, maxY: y };
            } else {
                return false;
            }
        }

        const { minX, minY, maxX, maxY } = this.selectionBox;
        const z = this.currentZLevel;
        const copiedTiles = {};

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                const key = `${x},${y},${z}`;
                if (this.scheme.tiles[key]) {
                    const relX = x - minX;
                    const relY = y - minY;
                    copiedTiles[`${relX},${relY}`] = JSON.parse(JSON.stringify(this.scheme.tiles[key]));
                }
            }
        }

        this.clipboard = {
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            tiles: copiedTiles
        };

        console.log("📋 成功複製選區至剪貼簿！包含地塊數:", Object.keys(copiedTiles).length);
        return true;
    }

    pasteSelection(targetX, targetY) {
        if (!this.clipboard || !this.clipboard.tiles) return false;

        const z = this.currentZLevel;
        this.batchOperation(() => {
            Object.entries(this.clipboard.tiles).forEach(([relKey, tileData]) => {
                const [rx, ry] = relKey.split(",").map(Number);
                const destX = targetX + rx;
                const destY = targetY + ry;

                if (destX >= 0 && destX < this.scheme.width && destY >= 0 && destY < this.scheme.height) {
                    const destKey = `${destX},${destY},${z}`;
                    this.scheme.tiles[destKey] = JSON.parse(JSON.stringify(tileData));
                }
            });
        });

        this.isPastingMode = false;
        console.log("📌 成功貼上剪貼簿內容至:", targetX, targetY);
        return true;
    }

    deleteSelection() {
        if (!this.selectionBox) {
            if (this.selectedCell) {
                const { x, y } = this.selectedCell;
                this.removeTile(x, y);
                this.pushHistory();
                this.notifyStateChange();
                return true;
            }
            return false;
        }

        const { minX, minY, maxX, maxY } = this.selectionBox;
        this.batchOperation(() => {
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    this.removeTile(x, y);
                }
            }
        });

        this.selectionBox = null;
        return true;
    }

    // --------------------------------------------------------------------------
    // Tile Mutations
    // --------------------------------------------------------------------------

    setTileFloor(x, y, colorId) {
        const key = `${x},${y},${this.currentZLevel}`;
        if (!this.scheme.tiles[key]) {
            this.scheme.tiles[key] = { walls: {} };
        }
        this.scheme.tiles[key].floorColorId = colorId;
    }

    setTileWall(x, y, edge, colorId) {
        const key = `${x},${y},${this.currentZLevel}`;
        if (!this.scheme.tiles[key]) {
            this.scheme.tiles[key] = { walls: {} };
        }
        if (!this.scheme.tiles[key].walls) {
            this.scheme.tiles[key].walls = {};
        }
        if (colorId === null) {
            delete this.scheme.tiles[key].walls[edge];
        } else {
            this.scheme.tiles[key].walls[edge] = colorId;
        }
    }

    removeTile(x, y) {
        const key = `${x},${y},${this.currentZLevel}`;
        if (this.scheme.tiles[key]) {
            delete this.scheme.tiles[key];
        }
    }

    batchOperation(callback) {
        callback();
        this.pushHistory();
        this.notifyStateChange();
    }

    setTileLabel(x, y, label) {
        const key = `${x},${y},${this.currentZLevel}`;
        if (!this.scheme.tiles[key]) {
            this.scheme.tiles[key] = { walls: {} };
        }
        this.scheme.tiles[key].label = label;
        this.pushHistory();
        this.notifyStateChange();
    }

    updatePaletteItem(id, { name, color }) {
        if (this.scheme.palette[id]) {
            this.scheme.palette[id] = { name, color };
            this.pushHistory();
            this.notifyStateChange();
        }
    }

    deletePaletteItem(id) {
        if (this.scheme.palette[id]) {
            delete this.scheme.palette[id];
            const paletteKeys = Object.keys(this.scheme.palette);
            if (this.activeColorId === id || !this.scheme.palette[this.activeColorId]) {
                this.activeColorId = paletteKeys.length > 0 ? paletteKeys[0] : "";
            }
            this.pushHistory();
            this.notifyStateChange();
        }
    }
}
