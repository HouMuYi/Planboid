/**
 * UISelectionState.js - Transient UI 選區、貼上預覽與剪貼簿狀態管理器
 * 從 StateManager 中解耦，使核心領域模型保持極致純粹
 */

export class UISelectionState {
	constructor() {
		this.selectedCell = null; // { x, y }
		this.selectionBox = null; // { minX, minY, maxX, maxY }
		this.clipboard = null; // { width, height, tiles: {} }
		this.isPastingMode = false;
	}

	clearSelection() {
		this.selectedCell = null;
		this.selectionBox = null;
	}

	setSingleSelection(x, y) {
		const safeX = Number(x);
		const safeY = Number(y);
		if (isNaN(safeX) || isNaN(safeY)) {
			this.selectedCell = null;
			return;
		}
		this.selectedCell = { x: safeX, y: safeY };
		this.selectionBox = null;
	}

	setBoxSelection(minX, minY, maxX, maxY) {
		const numMinX = Number(minX);
		const numMinY = Number(minY);
		const numMaxX = Number(maxX);
		const numMaxY = Number(maxY);

		if ([numMinX, numMinY, numMaxX, numMaxY].some(v => isNaN(v))) {
			this.clearSelection();
			return;
		}

		const realMinX = Math.min(numMinX, numMaxX);
		const realMaxX = Math.max(numMinX, numMaxX);
		const realMinY = Math.min(numMinY, numMaxY);
		const realMaxY = Math.max(numMinY, numMaxY);

		this.selectionBox = { minX: realMinX, minY: realMinY, maxX: realMaxX, maxY: realMaxY };
		this.selectedCell = { x: realMinX, y: realMinY };
	}

	setClipboard(data) {
		if (!data || typeof data !== 'object') {
			this.clipboard = null;
			this.isPastingMode = false;
			console.log('📋 剪貼簿已清空');
			return;
		}

		const tilesObj = data.tiles && typeof data.tiles === 'object' ? data.tiles : {};
		this.clipboard = {
			width: Math.max(1, Number(data.width) || 1),
			height: Math.max(1, Number(data.height) || 1),
			tiles: tilesObj
		};
		console.log('📋 剪貼簿更新，包含地塊數:', Object.keys(tilesObj).length);
	}

	clearClipboard() {
		this.clipboard = null;
		this.isPastingMode = false;
	}

	cancelPaste() {
		this.isPastingMode = false;
	}
}
