/**
 * UISelectionState.js - Transient UI 選區、貼上預覽與剪貼簿狀態管理器
 * 從 StateManager 中解耦，使核心領域模型保持極致純粹
 */

export class UISelectionState {
    constructor() {
        this.selectedCell = null;   // { x, y }
        this.selectionBox = null;   // { minX, minY, maxX, maxY }
        this.clipboard = null;      // { width, height, tiles: {} }
        this.isPastingMode = false;
    }

    clearSelection() {
        this.selectedCell = null;
        this.selectionBox = null;
    }

    setSingleSelection(x, y) {
        this.selectedCell = { x, y };
        this.selectionBox = null;
    }

    setBoxSelection(minX, minY, maxX, maxY) {
        this.selectionBox = { minX, minY, maxX, maxY };
        this.selectedCell = { x: minX, y: minY };
    }

    setClipboard(data) {
        this.clipboard = data;
        console.log("📋 剪貼簿更新，包含地塊數:", Object.keys(data.tiles || {}).length);
    }
}
