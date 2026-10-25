/**
 * StateManager.js - 核心領域模型與持久化狀態管理器 (支援 PZ 牆面正規化、舊版 4 方向相容與動態方案調整)
 */

import { BorderEdgeNormalizer } from '../renderer/BorderEdgeNormalizer.js';
import { CONFIG } from './Config.js';
import { eventBus, EVENTS } from './EventBus.js';
import { StorageManager } from './StorageManager.js';
import { ToolModeState } from './ToolModeState.js';
import { UISelectionState } from './UISelectionState.js';

export class StateManager {
	/**
	 * 地塊資料邊界裁剪與空項目過濾
	 * @param {number} x
	 * @param {number} y
	 * @param {Object} tile
	 * @param {number} width
	 * @param {number} height
	 * @returns {Object|null}
	 */
	static sanitizeBoundaryTile(x, y, tile, width, height) {
		if (!tile) return null;
		if (x > width || y > height || (x === width && y === height)) {
			return null;
		}
		if (x === width) {
			delete tile.floor;
			delete tile.N;
			delete tile.floorColorId;
			delete tile.floorObjects;
			delete tile.zoneIds;
			delete tile.zoneId;
			if (tile.walls) delete tile.walls.N;
			if (tile.wallObjects) delete tile.wallObjects.N;
			if (tile.wallZones) delete tile.wallZones.N;
		} else if (y === height) {
			delete tile.floor;
			delete tile.W;
			delete tile.floorColorId;
			delete tile.floorObjects;
			delete tile.zoneIds;
			delete tile.zoneId;
			if (tile.walls) delete tile.walls.W;
			if (tile.wallObjects) delete tile.wallObjects.W;
			if (tile.wallZones) delete tile.wallZones.W;
		}
		return this.isTileEmpty(tile) ? null : tile;
	}

	/**
	 * 將地塊物件無損標準化為統一的三槽位陣列格式 { floor: [], N: [], W: [] }
	 * @param {Object} tile
	 * @returns {{ floor: string[], N: string[], W: string[] }}
	 */
	static normalizeTile(tile) {
		if (!tile) return { floor: [], N: [], W: [] };
		const floor = Array.isArray(tile.floor)
			? [...tile.floor]
			: [
				tile.floorColorId || (typeof tile.floor === 'string' ? tile.floor : null),
				...(Array.isArray(tile.zoneIds) ? tile.zoneIds : (tile.zoneId ? [tile.zoneId] : [])),
				...(Array.isArray(tile.floorObjects) ? tile.floorObjects : [])
			].filter(Boolean);

		const nArr = Array.isArray(tile.N)
			? [...tile.N]
			: [
				tile.walls?.N,
				...(Array.isArray(tile.wallZones?.N) ? tile.wallZones.N : (tile.wallZones?.N ? [tile.wallZones.N] : [])),
				...(Array.isArray(tile.wallObjects?.N) ? tile.wallObjects.N : [])
			].filter(Boolean);

		const wArr = Array.isArray(tile.W)
			? [...tile.W]
			: [
				tile.walls?.W,
				...(Array.isArray(tile.wallZones?.W) ? tile.wallZones.W : (tile.wallZones?.W ? [tile.wallZones.W] : [])),
				...(Array.isArray(tile.wallObjects?.W) ? tile.wallObjects.W : [])
			].filter(Boolean);

		return { floor, N: nArr, W: wArr };
	}

	/**
	 * 槽位繪製守門鎖 (統一處理 normal 排他替換、zone 集合去重、object 清單累加)
	 * @param {string[]} slotArray
	 * @param {string} colorId
	 * @param {Record<string, any>} palette
	 * @param {boolean} [isExclusive=false]
	 * @returns {string[]}
	 */
	static applySlotPaint(slotArray, colorId, palette, isExclusive = false) {
		if (!colorId || !palette) return slotArray || [];
		if (isExclusive) {
			return [colorId];
		}
		const arr = Array.isArray(slotArray) ? [...slotArray] : [];
		const item = palette[colorId];
		if (item?.isZone) {
			if (!arr.includes(colorId)) {
				arr.push(colorId);
			}
		} else if (item?.isObject) {
			arr.push(colorId);
		} else {
			// 通用色票：排他替換掉槽位中既有的通用色票，保留標籤與物件
			const filtered = arr.filter(id => {
				const p = palette[id];
				return p?.isZone || p?.isObject;
			});
			filtered.push(colorId);
			return filtered;
		}
		return arr;
	}

	/**
	 * 槽位清除守門鎖 (統一處理 object 的 N-1 扣減、zone/normal 的指定刪除)
	 * @param {string[]} slotArray
	 * @param {string|null} colorId
	 * @param {Record<string, any>} palette
	 * @param {boolean} [isForceAll=false]
	 * @returns {string[]}
	 */
	static removeSlotPaint(slotArray, colorId, palette, isForceAll = false) {
		if (!Array.isArray(slotArray) || slotArray.length === 0) return [];
		if (isForceAll || !colorId) {
			return [];
		}
		const item = palette?.[colorId];
		if (item?.isObject) {
			const idx = slotArray.lastIndexOf(colorId);
			if (idx !== -1) {
				const arr = [...slotArray];
				arr.splice(idx, 1);
				return arr;
			}
			return slotArray;
		} else {
			return slotArray.filter(id => id !== colorId);
		}
	}

	/**
	 * 提取地塊上的所有標籤色票 ID 清單 (向下相容單一字串或陣列)
	 * @param {Object} tile
	 * @returns {string[]}
	 */
	static getTileZoneIds(tile) {
		if (!tile) return [];
		if (Array.isArray(tile.floor)) {
			return tile.floor.filter(id => String(id).startsWith('zone_'));
		}
		if (Array.isArray(tile.zoneIds)) return tile.zoneIds;
		if (tile.zoneId) return [tile.zoneId];
		return [];
	}

	/**
	 * 提取邊線上的所有標籤色票 ID 清單 (向下相容單一字串或陣列)
	 * @param {Object} tile
	 * @param {'N'|'W'} edge
	 * @returns {string[]}
	 */
	static getWallZoneIds(tile, edge) {
		if (!tile) return [];
		if (Array.isArray(tile[edge])) {
			return tile[edge].filter(id => String(id).startsWith('zone_'));
		}
		if (!tile.wallZones) return [];
		const val = tile.wallZones[edge];
		if (Array.isArray(val)) return val;
		if (val) return [val];
		return [];
	}

	/**
	 * 判定地塊是否為無任何內容的空地塊
	 * @param {Object} tile
	 * @returns {boolean}
	 */
	static isTileEmpty(tile) {
		if (!tile) return true;
		const hasFloor = Array.isArray(tile.floor) && tile.floor.length > 0;
		const hasN = Array.isArray(tile.N) && tile.N.length > 0;
		const hasW = Array.isArray(tile.W) && tile.W.length > 0;
		if (hasFloor || hasN || hasW) return false;

		const legacyFloor = !!tile.floorColorId || (typeof tile.floor === 'string' && !!tile.floor) ||
			!!tile.zoneId || (Array.isArray(tile.zoneIds) && tile.zoneIds.length > 0) ||
			(Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0);
		const legacyWalls = tile.walls && Object.values(tile.walls).some(Boolean);
		const legacyWallObjs = tile.wallObjects && Object.values(tile.wallObjects).some(arr => Array.isArray(arr) && arr.length > 0);
		const legacyWallZones = tile.wallZones && Object.values(tile.wallZones).some(arr => (Array.isArray(arr) ? arr.length > 0 : !!arr));
		return !legacyFloor && !legacyWalls && !legacyWallObjs && !legacyWallZones;
	}

	/**
	 * 正規化 tiles 地塊集合（委派至 BorderEdgeNormalizer）
	 * @param {Record<string, any>} tiles
	 * @returns {Record<string, any>}
	 */
	static normalizeTilesMap(tiles) {
		return BorderEdgeNormalizer.normalizeTilesMap(tiles);
	}

	/**
	 * 統計方案中所有色票於地圖中的實體使用數量
	 * @param {Object} scheme
	 * @returns {Record<string, number>}
	 */
	static getPaletteUsageCounts(scheme) {
		const counts = {};
		const tiles = scheme?.tiles;
		if (!tiles) return counts;

		const addCount = (id) => {
			if (id) counts[id] = (counts[id] || 0) + 1;
		};

		Object.values(tiles).forEach(tile => {
			if (!tile) return;
			if (Array.isArray(tile.floor)) tile.floor.forEach(addCount);
			if (Array.isArray(tile.N)) tile.N.forEach(addCount);
			if (Array.isArray(tile.W)) tile.W.forEach(addCount);

			// 向下相容舊版結構
			if (tile.floorColorId) addCount(tile.floorColorId);
			else if (typeof tile.floor === 'string') addCount(tile.floor);
			if (Array.isArray(tile.zoneIds)) tile.zoneIds.forEach(addCount);
			else if (tile.zoneId) addCount(tile.zoneId);
			if (Array.isArray(tile.floorObjects)) tile.floorObjects.forEach(addCount);

			if (tile.walls) {
				Object.values(tile.walls).forEach(val => {
					if (typeof val === 'string') addCount(val);
				});
			}
			if (tile.wallObjects) {
				Object.values(tile.wallObjects).forEach(arr => {
					if (Array.isArray(arr)) arr.forEach(addCount);
				});
			}
			if (tile.wallZones) {
				Object.values(tile.wallZones).forEach(val => {
					if (Array.isArray(val)) val.forEach(addCount);
					else if (val) addCount(val);
				});
			}
		});

		return counts;
	}

	// 方案地塊正規化委派
	normalizeSchemeTiles(scheme) {
		if (!scheme || !scheme.tiles) return;
		scheme.tiles = StateManager.normalizeTilesMap(scheme.tiles);
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

		this.normalizeSchemeTiles(this.scheme);

		this.uiState = new UISelectionState();
		this.toolState = new ToolModeState();

		this.currentZLevel = this.scheme.currentLevel || 0;

		const paletteKeys = Object.keys(this.scheme.palette || {});
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
	get ghostLayerEnabled() {
		return this.toolState.ghostLayerEnabled;
	}
	set ghostLayerEnabled(val) {
		this.toolState.ghostLayerEnabled = val;
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
		this.persist();
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
		const nextSnapStr = this.redoStack.pop();
		const nextSnap = JSON.parse(nextSnapStr);
		if (nextSnap.id !== this.scheme.id) {
			this.redoStack = [];
			return false;
		}
		this.undoStack.push(nextSnapStr);
		Object.assign(this.scheme, nextSnap);

		const paletteKeys = Object.keys(this.scheme.palette || {});
		if (!this.scheme.palette[this.activeColorId] && paletteKeys.length > 0) {
			this.activeColorId = paletteKeys[0];
		}

		this.persist();
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

			if (target.tiles) {
				Object.keys(target.tiles).forEach(key => {
					const [xStr, yStr] = key.split(',');
					const x = parseInt(xStr, 10);
					const y = parseInt(yStr, 10);
					const sanitized = StateManager.sanitizeBoundaryTile(x, y, target.tiles[key], validW, validH);
					if (!sanitized) {
						delete target.tiles[key];
					}
				});
			}

			this.persist();
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
		const validW = Math.max(CONFIG.SCHEME_SIZE_MIN, Math.min(CONFIG.SCHEME_SIZE_MAX, overrides.width || source?.width || CONFIG.DEFAULT_SCHEME_WIDTH));
		const validH = Math.max(CONFIG.SCHEME_SIZE_MIN, Math.min(CONFIG.SCHEME_SIZE_MAX, overrides.height || source?.height || CONFIG.DEFAULT_SCHEME_HEIGHT));

		const newScheme = {
			id: 'scheme_' + Date.now(),
			name: overrides.name || (source ? `${source.name} (Copy)` : ''),
			width: validW,
			height: validH,
			currentLevel: source?.currentLevel || 0,
			worldOriginX: overrides.worldOriginX ?? source?.worldOriginX ?? CONFIG.DEFAULT_ORIGIN_X,
			worldOriginY: overrides.worldOriginY ?? source?.worldOriginY ?? CONFIG.DEFAULT_ORIGIN_Y,
			palette: JSON.parse(JSON.stringify(source?.palette || StorageManager.getDefaultScheme().palette)),
			tiles: JSON.parse(JSON.stringify(source?.tiles || {})),
		};

		if (newScheme.tiles) {
			Object.keys(newScheme.tiles).forEach(key => {
				const [xStr, yStr] = key.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				const sanitized = StateManager.sanitizeBoundaryTile(x, y, newScheme.tiles[key], validW, validH);
				if (!sanitized) {
					delete newScheme.tiles[key];
				}
			});
		}

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
			tiles: copiedTiles,
		});

		return true;
	}

	pasteSelection(targetX, targetY) {
		if (!this.clipboard || !this.clipboard.tiles) return false;

		const z = this.currentZLevel;
		this.isPastingMode = false;

		this.batchOperation(() => {
			Object.entries(this.clipboard.tiles).forEach(([relKey, tileData]) => {
				const [rx, ry] = relKey.split(',').map(Number);
				const destX = targetX + rx;
				const destY = targetY + ry;

				if (destX < 0 || destY < 0) return;

				const norm = StateManager.normalizeTile(tileData);
				if (norm.floor.length === 0) delete norm.floor;
				if (norm.N.length === 0) delete norm.N;
				if (norm.W.length === 0) delete norm.W;

				const sanitized = StateManager.sanitizeBoundaryTile(destX, destY, norm, this.scheme.width, this.scheme.height);
				if (sanitized) {
					const destKey = `${destX},${destY},${z}`;
					this.scheme.tiles[destKey] = sanitized;
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
	// Tile Mutations (正規化寫入)
	// --------------------------------------------------------------------------

	// --------------------------------------------------------------------------
	// Tile Mutations (正規化寫入 & 物件圖層)
	// --------------------------------------------------------------------------

	setTileFloor(x, y, colorId, isExclusive = false) {
		if (x < 0 || x >= this.scheme.width || y < 0 || y >= this.scheme.height) return;
		if (!colorId) {
			this.removeFloor(x, y);
			return;
		}
		const key = `${x},${y},${this.currentZLevel}`;
		if (!this.scheme.tiles[key]) this.scheme.tiles[key] = { floor: [], N: [], W: [] };
		const tile = this.scheme.tiles[key];
		if (!Array.isArray(tile.floor)) {
			const norm = StateManager.normalizeTile(tile);
			tile.floor = norm.floor;
			tile.N = norm.N;
			tile.W = norm.W;
		}
		tile.floor = StateManager.applySlotPaint(tile.floor, colorId, this.scheme.palette, isExclusive);
		if (tile.floor.length === 0) delete tile.floor;
		this.cleanupEmptyTile(key);
	}

	setTileWall(x, y, edge, colorId, isExclusive = false) {
		const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		if (norm.x < 0 || norm.x > this.scheme.width || norm.y < 0 || norm.y > this.scheme.height) return;
		if (colorId === null || colorId === undefined) {
			this.removeWall(x, y, edge);
			return;
		}

		const key = `${norm.x},${norm.y},${this.currentZLevel}`;
		if (!this.scheme.tiles[key]) this.scheme.tiles[key] = { floor: [], N: [], W: [] };
		const tile = this.scheme.tiles[key];
		if (!Array.isArray(tile[norm.edge])) {
			const normalized = StateManager.normalizeTile(tile);
			tile.floor = normalized.floor;
			tile.N = normalized.N;
			tile.W = normalized.W;
		}
		tile[norm.edge] = StateManager.applySlotPaint(tile[norm.edge], colorId, this.scheme.palette, isExclusive);
		if (tile[norm.edge].length === 0) delete tile[norm.edge];
		this.cleanupEmptyTile(key);
	}

	removeFloor(x, y, colorId = null, isForceAll = false) {
		const key = `${x},${y},${this.currentZLevel}`;
		const tile = this.scheme.tiles[key];
		if (!tile) return;

		if (!Array.isArray(tile.floor)) {
			const norm = StateManager.normalizeTile(tile);
			tile.floor = norm.floor;
			tile.N = norm.N;
			tile.W = norm.W;
			delete tile.floorColorId;
			delete tile.floorObjects;
			delete tile.zoneIds;
			delete tile.zoneId;
		}

		tile.floor = StateManager.removeSlotPaint(tile.floor, colorId, this.scheme.palette, isForceAll);
		if (tile.floor.length === 0) delete tile.floor;
		this.cleanupEmptyTile(key);
	}

	removeZone(x, y) {
		this.removeFloor(x, y, null, true);
	}

	removeWall(x, y, edge, colorId = null, isForceAll = false) {
		const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		const key = `${norm.x},${norm.y},${this.currentZLevel}`;
		const tile = this.scheme.tiles[key];
		if (!tile) return;

		if (!Array.isArray(tile[norm.edge])) {
			const normalized = StateManager.normalizeTile(tile);
			tile.floor = normalized.floor;
			tile.N = normalized.N;
			tile.W = normalized.W;
			delete tile.walls;
			delete tile.wallObjects;
			delete tile.wallZones;
		}

		tile[norm.edge] = StateManager.removeSlotPaint(tile[norm.edge], colorId, this.scheme.palette, isForceAll);
		if (tile[norm.edge].length === 0) delete tile[norm.edge];
		this.cleanupEmptyTile(key);
	}

	removeWallZone(x, y, edge) {
		this.removeWall(x, y, edge, null, true);
	}

	cleanupEmptyTile(key) {
		if (StateManager.isTileEmpty(this.scheme.tiles[key])) {
			delete this.scheme.tiles[key];
		}
	}

	removeTile(x, y) {
		const key = `${x},${y},${this.currentZLevel}`;
		if (this.scheme.tiles[key]) {
			delete this.scheme.tiles[key];
		}
	}

	convertPaletteItemType(id, targetType) {
		const item = this.scheme.palette[id];
		if (!item) return;

		let toType = targetType;
		if (targetType === true) toType = 'object';
		else if (targetType === false) toType = 'normal';

		const fromType = item.isZone ? 'zone' : (item.isObject ? 'object' : 'normal');
		if (fromType === toType) return;

		item.isObject = (toType === 'object');
		item.isZone = (toType === 'zone');

		Object.keys(this.scheme.tiles).forEach(key => {
			const tile = this.scheme.tiles[key];
			if (!tile) return;

			if (!Array.isArray(tile.floor) && !Array.isArray(tile.N) && !Array.isArray(tile.W)) {
				const norm = StateManager.normalizeTile(tile);
				tile.floor = norm.floor;
				tile.N = norm.N;
				tile.W = norm.W;
				delete tile.floorColorId;
				delete tile.floorObjects;
				delete tile.zoneIds;
				delete tile.zoneId;
				delete tile.walls;
				delete tile.wallObjects;
				delete tile.wallZones;
			}

			['floor', 'N', 'W'].forEach(slotKey => {
				const slot = tile[slotKey];
				if (!Array.isArray(slot) || !slot.includes(id)) return;

				if (toType === 'normal') {
					const nonNormals = slot.filter(tid => tid !== id && (this.scheme.palette[tid]?.isZone || this.scheme.palette[tid]?.isObject));
					tile[slotKey] = [...nonNormals, id];
				} else if (toType === 'zone') {
					const seen = new Set();
					tile[slotKey] = slot.filter(tid => {
						if (tid === id) {
							if (seen.has(id)) return false;
							seen.add(id);
							return true;
						}
						return true;
					});
				}
			});
			this.cleanupEmptyTile(key);
		});

		this.pushHistory();
		this.notifyStateChange();
	}

	cycleSelectedSubTarget() {
		if (!this.selectedCell) return false;
		const { x, y } = this.selectedCell;
		const key = `${x},${y},${this.currentZLevel}`;
		const tile = this.scheme.tiles[key];
		if (!tile) return false;

		const norm = StateManager.normalizeTile(tile);
		const subTargets = [];
		const palette = this.scheme.palette || {};

		norm.floor.forEach((id, idx) => {
			const item = palette[id];
			const type = item?.isZone ? 'floorZone' : (item?.isObject ? 'floorObj' : 'floor');
			subTargets.push({ type, id, index: idx });
		});

		['N', 'W'].forEach(edge => {
			norm[edge].forEach((id, idx) => {
				const item = palette[id];
				const type = item?.isZone ? `wall${edge}Zone` : (item?.isObject ? `wall${edge}Obj` : `wall${edge}`);
				subTargets.push({ type, id, index: idx, edge });
			});
		});

		if (subTargets.length <= 1) {
			this.activeSubTarget = null;
			return false;
		}

		let currentIndex = -1;
		if (this.activeSubTarget) {
			currentIndex = subTargets.findIndex(t => t.id === this.activeSubTarget.id && t.type === this.activeSubTarget.type);
		}

		const nextIndex = (currentIndex + 1) % subTargets.length;
		this.activeSubTarget = subTargets[nextIndex];
		this.notifyStateChange();
		return true;
	}


	batchOperation(callback) {
		callback();
		this.pushHistory();
		this.notifyStateChange();
	}

	updatePaletteItem(id, { name, color }) {
		if (this.scheme.palette[id]) {
			this.scheme.palette[id] = { ...this.scheme.palette[id], name, color };
			this.pushHistory();
			this.notifyStateChange();
		}
	}

	deletePaletteItem(id) {
		if (this.scheme.palette[id]) {
			delete this.scheme.palette[id];

			if (this.scheme.tiles) {
				Object.keys(this.scheme.tiles).forEach(key => {
					const tile = this.scheme.tiles[key];
					if (!tile) return;
					['floor', 'N', 'W'].forEach(slotKey => {
						if (Array.isArray(tile[slotKey])) {
							tile[slotKey] = tile[slotKey].filter(colorId => colorId !== id);
							if (tile[slotKey].length === 0) delete tile[slotKey];
						}
					});

					// 向下相容清理舊屬性
					if (tile.floorColorId === id) delete tile.floorColorId;
					if (tile.zoneId === id) delete tile.zoneId;
					if (Array.isArray(tile.zoneIds)) {
						tile.zoneIds = tile.zoneIds.filter(zid => zid !== id);
						if (tile.zoneIds.length === 0) delete tile.zoneIds;
					}
					if (Array.isArray(tile.floorObjects)) {
						tile.floorObjects = tile.floorObjects.filter(objId => objId !== id);
						if (tile.floorObjects.length === 0) delete tile.floorObjects;
					}

					if (tile.walls) {
						Object.keys(tile.walls).forEach(edge => {
							if (Array.isArray(tile.walls[edge])) {
								tile.walls[edge] = tile.walls[edge].filter(colorId => colorId !== id);
								if (tile.walls[edge].length === 0) delete tile.walls[edge];
							} else if (tile.walls[edge] === id) {
								delete tile.walls[edge];
							}
						});
						if (Object.keys(tile.walls).length === 0) delete tile.walls;
					}
					if (tile.wallObjects) {
						Object.keys(tile.wallObjects).forEach(edge => {
							if (Array.isArray(tile.wallObjects[edge])) {
								tile.wallObjects[edge] = tile.wallObjects[edge].filter(objId => objId !== id);
								if (tile.wallObjects[edge].length === 0) delete tile.wallObjects[edge];
							}
						});
						if (Object.keys(tile.wallObjects).length === 0) delete tile.wallObjects;
					}
					if (tile.wallZones) {
						Object.keys(tile.wallZones).forEach(edge => {
							if (Array.isArray(tile.wallZones[edge])) {
								tile.wallZones[edge] = tile.wallZones[edge].filter(zid => zid !== id);
								if (tile.wallZones[edge].length === 0) delete tile.wallZones[edge];
							} else if (tile.wallZones[edge] === id) {
								delete tile.wallZones[edge];
							}
						});
						if (Object.keys(tile.wallZones).length === 0) delete tile.wallZones;
					}
					this.cleanupEmptyTile(key);
				});
			}

			const paletteKeys = Object.keys(this.scheme.palette);
			if (this.activeColorId === id || !this.scheme.palette[this.activeColorId]) {
				this.activeColorId = paletteKeys.length > 0 ? paletteKeys[0] : '';
			}
			this.pushHistory();
			this.notifyStateChange();
		}
	}

	addPaletteItem({ name, color, isObject = false, isZone = false }) {
		if (!this.scheme.palette) this.scheme.palette = {};

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
		};
		this.activeColorId = newId;
		this.pushHistory();
		this.notifyStateChange();
		return newId;
	}

	reorderPalette(sourceId, targetId) {
		const palette = this.scheme?.palette;
		if (!palette || !palette[sourceId] || !palette[targetId]) return false;

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

	async persist() {
		await StorageManager.saveData({
			activeSchemeId: this.activeSchemeId,
			schemes: this.schemes,
		});
	}

	notifyStateChange(eventType = 'change') {
		this.persist();
		eventBus.emit(EVENTS.STATE_CHANGED, { type: eventType, state: this });
	}
}
