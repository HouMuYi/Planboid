/**
 * StateManager.js - 核心領域模型與持久化狀態管理器 (方案、樓層、地塊變更與 Undo/Redo)
 */

import { CONFIG } from './Config.js';
import { eventBus, EVENTS } from './EventBus.js';
import { StorageManager } from './StorageManager.js';
import { TileModel } from './TileModel.js';
import { ToolModeState } from './ToolModeState.js';
import { UISelectionState } from './UISelectionState.js';

export class StateManager {
	/**
	 * 方案邊界裁剪：第 width 欄僅保留西牆、第 height 列僅保留北牆，超出範圍與右下角格整格移除
	 * @param {Object} tile
	 * @param {number} width
	 * @param {number} height
	 * @returns {Object|null} 裁剪後仍有內容的地塊
	 */
	static sanitizeBoundaryTile(tile, width, height) {
		const { x, y } = tile;
		if (x > width || y > height || (x === width && y === height)) {
			return null;
		}
		if (x === width) {
			delete tile.floor;
			delete tile.N;
		} else if (y === height) {
			delete tile.floor;
			delete tile.W;
		}
		return TileModel.isTileEmpty(tile) ? null : tile;
	}

	/**
	 * 統計方案中所有色票於地圖中的實體使用數量
	 * @param {Object} scheme
	 * @returns {Record<string, number>}
	 */
	static getPaletteUsageCounts(scheme) {
		const counts = {};
		Object.values(scheme.tiles).forEach(tile => {
			TileModel.SLOTS.forEach(slot => {
				tile[slot]?.forEach(id => {
					if (id) counts[id] = (counts[id] || 0) + 1;
				});
			});
		});
		return counts;
	}

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

		this.uiState = new UISelectionState();
		this.toolState = new ToolModeState();

		this.currentZLevel = this.scheme.currentLevel || 0;

		const paletteKeys = Object.keys(this.scheme.palette);
		if (paletteKeys.length > 0) {
			this.toolState.setActiveColorId(paletteKeys[0]);
		}

		this.maxHistory = CONFIG.HISTORY_MAX_STEPS;
		this.undoStack = [];
		this.redoStack = [];

		this.pushHistory();
	}

	// 快捷 getters/setters 委派
	get selectedCell() {
		return this.uiState.selectedCell;
	}
	set selectedCell(val) {
		this.uiState.selectedCell = val;
	}
	get selectionBox() {
		return this.uiState.selectionBox;
	}
	set selectionBox(val) {
		this.uiState.selectionBox = val;
	}
	get clipboard() {
		return this.uiState.clipboard;
	}
	set clipboard(val) {
		this.uiState.clipboard = val;
	}
	get isPastingMode() {
		return this.uiState.isPastingMode;
	}
	set isPastingMode(val) {
		this.uiState.isPastingMode = val;
	}

	get activeTool() {
		return this.toolState.activeTool;
	}
	set activeTool(val) {
		this.toolState.setActiveTool(val);
	}
	setActiveTool(tool) {
		this.toolState.setActiveTool(tool);
	}

	get brushType() {
		return this.toolState.brushType;
	}
	set brushType(val) {
		this.toolState.setBrushType(val);
	}
	setBrushType(type) {
		this.toolState.setBrushType(type);
	}

	get activeColorId() {
		return this.toolState.activeColorId;
	}
	set activeColorId(val) {
		this.toolState.setActiveColorId(val);
	}
	setActiveColorId(colorId) {
		this.toolState.setActiveColorId(colorId);
	}
	get otherFloorsMode() {
		return this.toolState.otherFloorsMode;
	}
	set otherFloorsMode(val) {
		this.toolState.setOtherFloorsMode(val);
	}
	setOtherFloorsMode(mode) {
		this.toolState.setOtherFloorsMode(mode);
	}
	get visualOffsetEnabled() {
		return this.toolState.visualOffsetEnabled;
	}
	set visualOffsetEnabled(val) {
		this.toolState.visualOffsetEnabled = val;
	}
	get is3DWallsEnabled() {
		return this.toolState.is3DWallsEnabled;
	}
	set is3DWallsEnabled(val) {
		this.toolState.is3DWallsEnabled = val;
	}
	get isCellGridEnabled() {
		return this.toolState.isCellGridEnabled;
	}
	set isCellGridEnabled(val) {
		this.toolState.isCellGridEnabled = !!val;
	}

	clearHistory() {
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
	}

	undo() {
		if (this.undoStack.length <= 1) return false;
		const currentSnap = this.undoStack.pop();
		this.redoStack.push(currentSnap);

		const prevSnapStr = this.undoStack[this.undoStack.length - 1];
		const prevSnap = JSON.parse(prevSnapStr);
		if (prevSnap.id !== this.scheme.id) {
			this.undoStack = [currentSnap];
			this.redoStack = [];
			return false;
		}
		Object.assign(this.scheme, prevSnap);

		const paletteKeys = Object.keys(this.scheme.palette);
		if (!this.scheme.palette[this.activeColorId] && paletteKeys.length > 0) {
			this.activeColorId = paletteKeys[0];
		}

		this.notifyStateChange();
		return true;
	}

	redo() {
		if (this.redoStack.length === 0) return false;
		const nextSnapStr = this.redoStack.pop();
		const nextSnap = JSON.parse(nextSnapStr);
		if (nextSnap.id !== this.scheme.id) {
			this.redoStack = [];
			return false;
		}
		this.undoStack.push(nextSnapStr);
		Object.assign(this.scheme, nextSnap);

		const paletteKeys = Object.keys(this.scheme.palette);
		if (!this.scheme.palette[this.activeColorId] && paletteKeys.length > 0) {
			this.activeColorId = paletteKeys[0];
		}

		this.notifyStateChange();
		return true;
	}

	/**
	 * 將內部 Z 座標轉為顯示 Z 樓層 (0->1, 1->2, -1->-1, -2->-2，不存在0)
	 */
	static toDisplayZ(z) {
		return z >= 0 ? z + 1 : z;
	}

	setZLevel(level) {
		this.currentZLevel = Math.max(CONFIG.Z_LEVEL_MIN, Math.min(CONFIG.Z_LEVEL_MAX, level));
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
			const validW = Math.max(CONFIG.SCHEME_SIZE_MIN, Math.min(CONFIG.SCHEME_SIZE_MAX, newWidth));
			const validH = Math.max(CONFIG.SCHEME_SIZE_MIN, Math.min(CONFIG.SCHEME_SIZE_MAX, newHeight));
			target.width = validW;
			target.height = validH;

			Object.entries(target.tiles).forEach(([key, tile]) => {
				if (!StateManager.sanitizeBoundaryTile(tile, validW, validH)) {
					delete target.tiles[key];
				}
			});

			this.notifyStateChange();
		}
	}

	createScheme({ name, width, height, worldOriginX, worldOriginY }) {
		const validW = Math.max(CONFIG.SCHEME_SIZE_MIN, Math.min(CONFIG.SCHEME_SIZE_MAX, width || CONFIG.DEFAULT_SCHEME_WIDTH));
		const validH = Math.max(CONFIG.SCHEME_SIZE_MIN, Math.min(CONFIG.SCHEME_SIZE_MAX, height || CONFIG.DEFAULT_SCHEME_HEIGHT));
		const validX = worldOriginX ?? CONFIG.DEFAULT_ORIGIN_X;
		const validY = worldOriginY ?? CONFIG.DEFAULT_ORIGIN_Y;

		const newScheme = {
			id: 'scheme_' + Date.now(),
			name: name || '',
			width: validW,
			height: validH,
			currentLevel: 0,
			worldOriginX: validX,
			worldOriginY: validY,
			palette: StorageManager.getDefaultScheme().palette,
			tiles: {},
		};

		this.schemes.push(newScheme);
		this.activeSchemeId = newScheme.id;
		this.scheme = newScheme;
		this.currentZLevel = 0;
		this.clearHistory();
		this.notifyStateChange();
		return newScheme;
	}

	cloneScheme(sourceSchemeId, overrides = {}) {
		const source = this.schemes.find(s => s.id === sourceSchemeId) || this.scheme;
		const validW = Math.max(CONFIG.SCHEME_SIZE_MIN, Math.min(CONFIG.SCHEME_SIZE_MAX, overrides.width || source.width));
		const validH = Math.max(CONFIG.SCHEME_SIZE_MIN, Math.min(CONFIG.SCHEME_SIZE_MAX, overrides.height || source.height));

		const newScheme = {
			id: 'scheme_' + Date.now(),
			name: overrides.name || `${source.name} (Copy)`,
			width: validW,
			height: validH,
			currentLevel: source.currentLevel || 0,
			worldOriginX: overrides.worldOriginX ?? source.worldOriginX,
			worldOriginY: overrides.worldOriginY ?? source.worldOriginY,
			palette: JSON.parse(JSON.stringify(source.palette)),
			tiles: JSON.parse(JSON.stringify(source.tiles)),
		};

		Object.entries(newScheme.tiles).forEach(([key, tile]) => {
			if (!StateManager.sanitizeBoundaryTile(tile, validW, validH)) {
				delete newScheme.tiles[key];
			}
		});

		this.schemes.push(newScheme);
		this.activeSchemeId = newScheme.id;
		this.scheme = newScheme;
		this.currentZLevel = newScheme.currentLevel || 0;
		this.clearHistory();
		this.notifyStateChange();
		return newScheme;
	}

	switchScheme(schemeId) {
		const target = this.schemes.find(s => s.id === schemeId);
		if (!target || target.id === this.activeSchemeId) return false;

		this.activeSchemeId = target.id;
		this.scheme = target;
		this.currentZLevel = target.currentLevel || 0;
		this.clearHistory();
		this.notifyStateChange();
		return true;
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
			this.clearHistory();
		}
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
		const copiedTiles = [];

		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				const tile = this.scheme.tiles[TileModel.tileKey(x, y, z)];
				if (tile) {
					copiedTiles.push({ dx: x - minX, dy: y - minY, tile: JSON.parse(JSON.stringify(tile)) });
				}
			}
		}

		this.uiState.setClipboard({
			width: maxX - minX + 1,
			height: maxY - minY + 1,
			tiles: copiedTiles,
		});

		return true;
	}

	pasteSelection(targetX, targetY) {
		if (!this.clipboard) return false;

		const z = this.currentZLevel;
		this.isPastingMode = false;

		this.batchOperation(() => {
			this.clipboard.tiles.forEach(({ dx, dy, tile: source }) => {
				const destX = targetX + dx;
				const destY = targetY + dy;

				if (destX < 0 || destY < 0) return;

				const tile = TileModel.createTile(destX, destY, z);
				TileModel.SLOTS.forEach(slot => {
					if (source[slot]?.length > 0) tile[slot] = [...source[slot]];
				});

				if (StateManager.sanitizeBoundaryTile(tile, this.scheme.width, this.scheme.height)) {
					this.scheme.tiles[TileModel.tileKey(destX, destY, z)] = tile;
				}
			});
		});

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
	// Tile Mutations (槽位寫入 & 物件圖層)
	// --------------------------------------------------------------------------

	_getOrCreateTile(x, y) {
		const z = this.currentZLevel;
		const key = TileModel.tileKey(x, y, z);
		return this.scheme.tiles[key] || (this.scheme.tiles[key] = TileModel.createTile(x, y, z));
	}

	setTileFloor(x, y, colorId, isExclusive = false) {
		if (x < 0 || x >= this.scheme.width || y < 0 || y >= this.scheme.height) return;
		if (!colorId) {
			this.removeFloor(x, y);
			return;
		}
		const tile = this._getOrCreateTile(x, y);
		tile.floor = TileModel.applySlotPaint(tile.floor, colorId, this.scheme.palette, isExclusive);
		this.cleanupEmptyTile(TileModel.tileKey(x, y, this.currentZLevel));
	}

	setTileWall(x, y, edge, colorId, isExclusive = false) {
		const norm = TileModel.normalizeEdge(x, y, edge);
		if (norm.x < 0 || norm.x > this.scheme.width || norm.y < 0 || norm.y > this.scheme.height) return;
		if (colorId === null || colorId === undefined) {
			this.removeWall(x, y, edge);
			return;
		}

		const tile = this._getOrCreateTile(norm.x, norm.y);
		tile[norm.edge] = TileModel.applySlotPaint(tile[norm.edge], colorId, this.scheme.palette, isExclusive);
		this.cleanupEmptyTile(TileModel.tileKey(norm.x, norm.y, this.currentZLevel));
	}

	removeFloor(x, y, colorId = null, isForceAll = false) {
		const key = TileModel.tileKey(x, y, this.currentZLevel);
		const tile = this.scheme.tiles[key];
		if (!tile) return;

		tile.floor = TileModel.removeSlotPaint(tile.floor, colorId, this.scheme.palette, isForceAll);
		this.cleanupEmptyTile(key);
	}

	removeWall(x, y, edge, colorId = null, isForceAll = false) {
		const norm = TileModel.normalizeEdge(x, y, edge);
		const key = TileModel.tileKey(norm.x, norm.y, this.currentZLevel);
		const tile = this.scheme.tiles[key];
		if (!tile) return;

		tile[norm.edge] = TileModel.removeSlotPaint(tile[norm.edge], colorId, this.scheme.palette, isForceAll);
		this.cleanupEmptyTile(key);
	}

	cleanupEmptyTile(key) {
		const tile = this.scheme.tiles[key];
		if (tile && TileModel.pruneTile(tile)) {
			delete this.scheme.tiles[key];
		}
	}

	removeTile(x, y) {
		delete this.scheme.tiles[TileModel.tileKey(x, y, this.currentZLevel)];
	}

	/**
	 * 轉換色票種類，並依新種類的槽位規則整理所有使用中的槽位
	 * @param {string} id
	 * @param {'normal' | 'object' | 'zone'} toType
	 */
	convertPaletteItemType(id, toType) {
		const palette = this.scheme.palette;
		const item = palette[id];
		if (!item || TileModel.paletteKind(item) === toType) return;

		item.isObject = (toType === 'object');
		item.isZone = (toType === 'zone');

		Object.entries(this.scheme.tiles).forEach(([key, tile]) => {
			TileModel.SLOTS.forEach(slotKey => {
				const slot = tile[slotKey];
				if (!slot || !slot.includes(id)) return;

				if (toType === 'normal') {
					// 通用色票每槽位僅能存在一個，轉換後排他保留此色票
					tile[slotKey] = [...slot.filter(tid => tid !== id && TileModel.paletteKind(palette[tid]) !== 'normal'), id];
				} else if (toType === 'zone') {
					// 區域標籤於槽位內不重複
					tile[slotKey] = slot.filter((tid, i) => tid !== id || slot.indexOf(id) === i);
				}
			});
			this.cleanupEmptyTile(key);
		});

		this.pushHistory();
		this.notifyStateChange();
	}

	batchOperation(callback) {
		callback();
		this.pushHistory();
		this.notifyStateChange();
	}

	updatePaletteItem(id, { name, color, isHalfWall }) {
		if (this.scheme.palette[id]) {
			this.scheme.palette[id] = {
				...this.scheme.palette[id],
				name,
				color,
				...(isHalfWall !== undefined ? { isHalfWall: !!isHalfWall } : {}),
			};
			this.pushHistory();
			this.notifyStateChange();
		}
	}

	deletePaletteItem(id) {
		if (this.scheme.palette[id]) {
			delete this.scheme.palette[id];

			Object.entries(this.scheme.tiles).forEach(([key, tile]) => {
				TileModel.SLOTS.forEach(slot => {
					if (tile[slot]) tile[slot] = tile[slot].filter(colorId => colorId !== id);
				});
				this.cleanupEmptyTile(key);
			});

			const paletteKeys = Object.keys(this.scheme.palette);
			if (this.activeColorId === id || !this.scheme.palette[this.activeColorId]) {
				this.activeColorId = paletteKeys.length > 0 ? paletteKeys[0] : '';
			}
			this.pushHistory();
			this.notifyStateChange();
		}
	}

	addPaletteItem({ name, color, isObject = false, isZone = false, isHalfWall = false }) {

		// 自增字串 ID：使用 'c' 前綴 + 遞增整數，杜絕毫秒卡頓連點衝突與 JS 物件整數鍵強制升序排序
		let nextNum = 1;
		while (this.scheme.palette[`c${nextNum}`]) {
			nextNum++;
		}
		const newId = `c${nextNum}`;

		this.scheme.palette[newId] = {
			name: name || '',
			color: color || CONFIG.DEFAULT_PALETTE_COLOR,
			...(isObject ? { isObject: true } : {}),
			...(isZone ? { isZone: true } : {}),
			...(!isObject && !isZone && isHalfWall ? { isHalfWall: true } : {}),
		};
		this.activeColorId = newId;
		this.pushHistory();
		this.notifyStateChange();
		return newId;
	}

	reorderPalette(sourceId, targetId) {
		const palette = this.scheme.palette;
		if (!palette[sourceId] || !palette[targetId]) return false;

		const keys = Object.keys(palette);
		const sourceIndex = keys.indexOf(sourceId);
		const targetIndex = keys.indexOf(targetId);
		if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return false;

		keys.splice(sourceIndex, 1);
		keys.splice(targetIndex, 0, sourceId);

		const newPalette = {};
		keys.forEach(k => {
			newPalette[k] = palette[k];
		});
		this.scheme.palette = newPalette;
		this.pushHistory();
		this.notifyStateChange();
		return true;
	}

	persist() {
		StorageManager.saveData({
			activeSchemeId: this.activeSchemeId,
			schemes: this.schemes,
		});
	}

	// 唯一持久化寫入點：所有領域變更皆經此通知並落盤
	notifyStateChange(eventType = 'change') {
		this.persist();
		eventBus.emit(EVENTS.STATE_CHANGED, { type: eventType, state: this });
	}
}
