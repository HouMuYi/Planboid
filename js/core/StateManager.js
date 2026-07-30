/**
 * StateManager.js - 核心領域模型與持久化狀態管理器 (支援 PZ 牆面正規化、舊版 4 方向相容與動態方案調整)
 */

import { StorageManager } from "./StorageManager.js";
import { UISelectionState } from "./UISelectionState.js";
import { ShapeStrokeEngine } from "../renderer/ShapeStrokeEngine.js";

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

        // 相容性正規化舊版 JSON 牆體
        this.normalizeSchemeTiles(this.scheme);

        // 獨立 UI Transient 狀態
        this.uiState = new UISelectionState();

        // 目前編輯狀態
        this.currentZLevel = this.scheme.currentLevel || 0;
        this.activeTool = "pencil";         // "pencil" | "erase-floor" | "erase-wall" | "select"
        this.shapeMode = "single";          // "single" | "line" | "box"
        this.brushType = "floor";           // "floor" | "wall"

        // 強制預設選取第一個色塊
        const paletteKeys = Object.keys(this.scheme.palette || {});
        this.activeColorId = (paletteKeys.length > 0) ? paletteKeys[0] : "";

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

    // 舊版 4 方向 JSON 相向相容：讀取舊檔案的 south 與 east 時，自動無損轉化為標準的 north 與 west
    normalizeSchemeTiles(scheme) {
        if (!scheme || !scheme.tiles) return;

        const updatedTiles = {};
        Object.entries(scheme.tiles).forEach(([key, tile]) => {
            const [xStr, yStr, zStr] = key.split(",");
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);

            if (tile.walls) {
                Object.entries(tile.walls).forEach(([edge, colorId]) => {
                    if (colorId) {
                        const norm = ShapeStrokeEngine.normalizeWallEdge(x, y, edge);
                        const normKey = `${norm.x},${norm.y},${zStr}`;
                        if (!updatedTiles[normKey]) {
                            updatedTiles[normKey] = { walls: {} };
                        }
                        if (!updatedTiles[normKey].walls) {
                            updatedTiles[normKey].walls = {};
                        }
                        updatedTiles[normKey].walls[norm.edge] = colorId;
                    }
                });
            }

            if (tile.floorColorId || tile.label) {
                if (!updatedTiles[key]) {
                    updatedTiles[key] = { walls: {} };
                }
                if (tile.floorColorId) updatedTiles[key].floorColorId = tile.floorColorId;
                if (tile.label) updatedTiles[key].label = tile.label;
            }
        });

        scheme.tiles = updatedTiles;
    }

    // 快捷 getters/setters
    get selectedCell() { return this.uiState.selectedCell; }
    set selectedCell(val) { this.uiState.selectedCell = val; }
    get selectionBox() { return this.uiState.selectionBox; }
    set selectionBox(val) { this.uiState.selectionBox = val; }
    get clipboard() { return this.uiState.clipboard; }
    set clipboard(val) { this.uiState.clipboard = val; }
    get isPastingMode() { return this.uiState.isPastingMode; }
    set isPastingMode(val) { this.uiState.isPastingMode = val; }

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

    // 動態調整方案尺寸與名稱
    updateSchemeDetails(id, newName, newWidth, newHeight) {
        const target = this.schemes.find(s => s.id === id);
        if (target) {
            target.name = newName;
            target.width = Math.max(10, Math.min(300, newWidth));
            target.height = Math.max(10, Math.min(300, newHeight));
            this.persist();
            this.notifyStateChange();
        }
    }

    deleteScheme(id) {
        if (this.schemes.length <= 1) {
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
                const { x, y } = this.selectedCell;
                this.uiState.setBoxSelection(x, y, x, y);
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

        this.uiState.setClipboard({
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            tiles: copiedTiles
        });

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

                if (destX >= 0 && destX <= this.scheme.width && destY >= 0 && destY <= this.scheme.height) {
                    const destKey = `${destX},${destY},${z}`;
                    this.scheme.tiles[destKey] = JSON.parse(JSON.stringify(tileData));
                }
            });
        });

        this.isPastingMode = false;
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

        this.uiState.clearSelection();
        return true;
    }

    // --------------------------------------------------------------------------
    // Tile Mutations (正規化寫入)
    // --------------------------------------------------------------------------

    setTileFloor(x, y, colorId) {
        if (x < 0 || x >= this.scheme.width || y < 0 || y >= this.scheme.height) return;
        const key = `${x},${y},${this.currentZLevel}`;
        if (!this.scheme.tiles[key]) {
            this.scheme.tiles[key] = { walls: {} };
        }
        this.scheme.tiles[key].floorColorId = colorId;
    }

    setTileWall(x, y, edge, colorId) {
        // PZ 邊界正規化 (South ->下格 North, East ->右格 West)
        const norm = ShapeStrokeEngine.normalizeWallEdge(x, y, edge);
        if (norm.x < 0 || norm.x > this.scheme.width || norm.y < 0 || norm.y > this.scheme.height) return;

        const key = `${norm.x},${norm.y},${this.currentZLevel}`;
        if (!this.scheme.tiles[key]) {
            this.scheme.tiles[key] = { walls: {} };
        }
        if (!this.scheme.tiles[key].walls) {
            this.scheme.tiles[key].walls = {};
        }

        if (colorId === null) {
            delete this.scheme.tiles[key].walls[norm.edge];
            this.cleanupEmptyTile(key);
        } else {
            this.scheme.tiles[key].walls[norm.edge] = colorId;
        }
    }

    removeFloor(x, y) {
        const key = `${x},${y},${this.currentZLevel}`;
        if (this.scheme.tiles[key]) {
            delete this.scheme.tiles[key].floorColorId;
            this.cleanupEmptyTile(key);
        }
    }

    removeWall(x, y, edge) {
        const norm = ShapeStrokeEngine.normalizeWallEdge(x, y, edge);
        const key = `${norm.x},${norm.y},${this.currentZLevel}`;
        if (this.scheme.tiles[key] && this.scheme.tiles[key].walls) {
            delete this.scheme.tiles[key].walls[norm.edge];
            this.cleanupEmptyTile(key);
        }
    }

    cleanupEmptyTile(key) {
        const tile = this.scheme.tiles[key];
        if (!tile) return;
        const hasFloor = !!tile.floorColorId;
        const hasWalls = tile.walls && Object.keys(tile.walls).length > 0;
        const hasLabel = !!tile.label;
        if (!hasFloor && !hasWalls && !hasLabel) {
            delete this.scheme.tiles[key];
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
