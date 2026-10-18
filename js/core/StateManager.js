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
			delete tile.floorColorId;
			delete tile.floorObjects;
			delete tile.zoneId;
			if (tile.walls) delete tile.walls.N;
			if (tile.wallObjects) delete tile.wallObjects.N;
			if (tile.wallZones) delete tile.wallZones.N;
		} else if (y === height) {
			delete tile.floor;
			delete tile.floorColorId;
			delete tile.floorObjects;
			delete tile.zoneId;
			if (tile.walls) delete tile.walls.W;
			if (tile.wallObjects) delete tile.wallObjects.W;
			if (tile.wallZones) delete tile.wallZones.W;
		}
		return this.isTileEmpty(tile) ? null : tile;
	}

	/**
	 * 判定地塊是否為無任何內容的空地塊
	 * @param {Object} tile
	 * @returns {boolean}
	 */
	static isTileEmpty(tile) {
		if (!tile) return true;
		const hasFloor = !!tile.floorColorId || !!tile.floor || !!tile.zoneId ||
			(Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0);
		const hasWalls = tile.walls && Object.values(tile.walls).some(Boolean);
		const hasWallObjs = tile.wallObjects && Object.values(tile.wallObjects).some(arr => Array.isArray(arr) && arr.length > 0);
		const hasWallZones = tile.wallZones && Object.values(tile.wallZones).some(Boolean);
		return !hasFloor && !hasWalls && !hasWallObjs && !hasWallZones;
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
			if (tile.floorColorId) addCount(tile.floorColorId);
			else if (typeof tile.floor === 'string') addCount(tile.floor);
			if (tile.zoneId) addCount(tile.zoneId);
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
				Object.values(tile.wallZones).forEach(addCount);
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
		this.batchOperation(() => {
			Object.entries(this.clipboard.tiles).forEach(([relKey, tileData]) => {
				const [rx, ry] = relKey.split(',').map(Number);
				const destX = targetX + rx;
				const destY = targetY + ry;

				if (destX >= 0 && destX <= this.scheme.width && destY >= 0 && destY <= this.scheme.height) {
					if (destX === this.scheme.width && destY === this.scheme.height) return;

					const destKey = `${destX},${destY},${z}`;
					const cloned = JSON.parse(JSON.stringify(tileData));

					if (destX === this.scheme.width) {
						delete cloned.floorColorId;
						delete cloned.floorObjects;
						delete cloned.zoneId;
						if (cloned.walls) delete cloned.walls.N;
						if (cloned.wallObjects) delete cloned.wallObjects.N;
					} else if (destY === this.scheme.height) {
						delete cloned.floorColorId;
						delete cloned.floorObjects;
						delete cloned.zoneId;
						if (cloned.walls) delete cloned.walls.W;
						if (cloned.wallObjects) delete cloned.wallObjects.W;
					}

					const hasContent = cloned.floorColorId || cloned.zoneId ||
						(cloned.floorObjects && cloned.floorObjects.length > 0) ||
						(cloned.walls && Object.keys(cloned.walls).length > 0) ||
						(cloned.wallObjects && Object.values(cloned.wallObjects).some(arr => arr && arr.length > 0));

					if (hasContent) {
						this.scheme.tiles[destKey] = cloned;
					}
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
		if (!this.scheme.tiles[key]) this.scheme.tiles[key] = {};
		const tile = this.scheme.tiles[key];
		const item = this.scheme.palette?.[colorId];

		if (isExclusive) {
			delete tile.floorColorId;
			delete tile.floor;
			delete tile.floorObjects;
			delete tile.zoneId;
		}

		if (item?.isZone) {
			tile.zoneId = colorId;
		} else if (item?.isObject) {
			if (!Array.isArray(tile.floorObjects)) tile.floorObjects = [];
			tile.floorObjects.push(colorId);
		} else {
			tile.floorColorId = colorId;
		}
	}

	setTileWall(x, y, edge, colorId, isExclusive = false) {
		const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		if (norm.x < 0 || norm.x > this.scheme.width || norm.y < 0 || norm.y > this.scheme.height) return;
		if (colorId === null || colorId === undefined) {
			this.removeWall(x, y, edge);
			return;
		}

		const key = `${norm.x},${norm.y},${this.currentZLevel}`;
		if (!this.scheme.tiles[key]) this.scheme.tiles[key] = {};
		const tile = this.scheme.tiles[key];
		const item = this.scheme.palette?.[colorId];

		if (isExclusive) {
			if (tile.walls) delete tile.walls[norm.edge];
			if (tile.wallObjects) delete tile.wallObjects[norm.edge];
			if (tile.wallZones) delete tile.wallZones[norm.edge];
		}

		if (item?.isZone) {
			if (!tile.wallZones) tile.wallZones = {};
			tile.wallZones[norm.edge] = colorId;
		} else if (item?.isObject) {
			if (!tile.wallObjects) tile.wallObjects = {};
			if (!Array.isArray(tile.wallObjects[norm.edge])) tile.wallObjects[norm.edge] = [];
			tile.wallObjects[norm.edge].push(colorId);
		} else {
			if (!tile.walls) tile.walls = {};
			tile.walls[norm.edge] = colorId;
		}
	}

	removeFloor(x, y, colorId = null, isForceAll = false) {
		const key = `${x},${y},${this.currentZLevel}`;
		const tile = this.scheme.tiles[key];
		if (!tile) return;

		if (isForceAll || !colorId) {
			delete tile.floorColorId;
			delete tile.floor;
			delete tile.floorObjects;
			delete tile.zoneId;
			this.cleanupEmptyTile(key);
			return;
		}

		const item = this.scheme.palette?.[colorId];
		if (item?.isZone) {
			if (tile.zoneId === colorId) delete tile.zoneId;
		} else if (item?.isObject) {
			if (Array.isArray(tile.floorObjects)) {
				const idx = tile.floorObjects.lastIndexOf(colorId);
				if (idx !== -1) {
					tile.floorObjects.splice(idx, 1);
					if (tile.floorObjects.length === 0) delete tile.floorObjects;
				}
			}
		} else {
			if (tile.floorColorId === colorId || tile.floor === colorId) {
				delete tile.floorColorId;
				delete tile.floor;
			}
		}
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

		if (isForceAll || !colorId) {
			if (tile.walls) {
				delete tile.walls[norm.edge];
				if (Object.keys(tile.walls).length === 0) delete tile.walls;
			}
			if (tile.wallObjects) {
				delete tile.wallObjects[norm.edge];
				if (Object.keys(tile.wallObjects).length === 0) delete tile.wallObjects;
			}
			if (tile.wallZones) {
				delete tile.wallZones[norm.edge];
				if (Object.keys(tile.wallZones).length === 0) delete tile.wallZones;
			}
			this.cleanupEmptyTile(key);
			return;
		}

		const item = this.scheme.palette?.[colorId];
		if (item?.isZone) {
			if (tile.wallZones && tile.wallZones[norm.edge] === colorId) {
				delete tile.wallZones[norm.edge];
				if (Object.keys(tile.wallZones).length === 0) delete tile.wallZones;
			}
		} else if (item?.isObject) {
			if (tile.wallObjects && Array.isArray(tile.wallObjects[norm.edge])) {
				const idx = tile.wallObjects[norm.edge].lastIndexOf(colorId);
				if (idx !== -1) {
					tile.wallObjects[norm.edge].splice(idx, 1);
					if (tile.wallObjects[norm.edge].length === 0) {
						delete tile.wallObjects[norm.edge];
						if (Object.keys(tile.wallObjects).length === 0) delete tile.wallObjects;
					}
				}
			}
		} else {
			if (tile.walls && tile.walls[norm.edge] === colorId) {
				delete tile.walls[norm.edge];
				if (Object.keys(tile.walls).length === 0) delete tile.walls;
			}
		}
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

	convertPaletteItemType(id, toObject) {
		const item = this.scheme.palette[id];
		if (!item) return;

		item.isObject = !!toObject;

		if (!toObject) {
			Object.values(this.scheme.tiles).forEach(tile => {
				if (Array.isArray(tile.floorObjects) && tile.floorObjects.includes(id)) {
					tile.floorObjects = tile.floorObjects.filter(itemId => itemId !== id);
					tile.floorColorId = id;
					if (tile.floorObjects.length === 0) delete tile.floorObjects;
				}
				if (tile.wallObjects) {
					Object.entries(tile.wallObjects).forEach(([edge, arr]) => {
						if (Array.isArray(arr) && arr.includes(id)) {
							tile.wallObjects[edge] = arr.filter(itemId => itemId !== id);
							if (!tile.walls) tile.walls = {};
							tile.walls[edge] = id;
							if (tile.wallObjects[edge].length === 0) delete tile.wallObjects[edge];
						}
					});
					if (Object.keys(tile.wallObjects).length === 0) delete tile.wallObjects;
				}
			});
		} else {
			Object.values(this.scheme.tiles).forEach(tile => {
				if (tile.floorColorId === id) {
					delete tile.floorColorId;
					if (!Array.isArray(tile.floorObjects)) tile.floorObjects = [];
					tile.floorObjects.push(id);
				}
				if (tile.walls && tile.walls.N === id) {
					delete tile.walls.N;
					if (!tile.wallObjects) tile.wallObjects = {};
					if (!Array.isArray(tile.wallObjects.N)) tile.wallObjects.N = [];
					tile.wallObjects.N.push(id);
				}
				if (tile.walls && tile.walls.W === id) {
					delete tile.walls.W;
					if (!tile.wallObjects) tile.wallObjects = {};
					if (!Array.isArray(tile.wallObjects.W)) tile.wallObjects.W = [];
					tile.wallObjects.W.push(id);
				}
			});
		}

		this.pushHistory();
		this.notifyStateChange();
	}

	cycleSelectedSubTarget() {
		if (!this.selectedCell) return false;
		const { x, y } = this.selectedCell;
		const key = `${x},${y},${this.currentZLevel}`;
		const tile = this.scheme.tiles[key];
		if (!tile) return false;

		const subTargets = [];
		const palette = this.scheme.palette || {};

		// 面域項目
		const floorItems = [
			...(Array.isArray(tile.floor) ? tile.floor : (tile.floor ? [tile.floor] : [])),
			tile.floorColorId,
			tile.zoneId,
			...(Array.isArray(tile.floorObjects) ? tile.floorObjects : [])
		].filter(Boolean);

		floorItems.forEach((id, idx) => {
			const item = palette[id];
			const type = item?.isZone ? 'zone' : (item?.isObject ? 'floorObj' : 'floor');
			subTargets.push({ type, id, index: idx });
		});

		// 邊線項目
		['N', 'W'].forEach(edge => {
			const edgeItems = [
				...(Array.isArray(tile.walls?.[edge]) ? tile.walls[edge] : (tile.walls?.[edge] ? [tile.walls[edge]] : [])),
				tile.wallZones?.[edge],
				...(Array.isArray(tile.wallObjects?.[edge]) ? tile.wallObjects[edge] : [])
			].filter(Boolean);

			edgeItems.forEach((id, idx) => {
				const item = palette[id];
				const type = item?.isZone ? `wallZone${edge}` : (item?.isObject ? `wall${edge}Obj` : `wall${edge}`);
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
					if (Array.isArray(tile.floor)) {
						tile.floor = tile.floor.filter(colorId => colorId !== id);
						if (tile.floor.length === 0) delete tile.floor;
					}
					if (tile.floorColorId === id) delete tile.floorColorId;
					if (tile.zoneId === id) delete tile.zoneId;
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
							if (tile.wallZones[edge] === id) delete tile.wallZones[edge];
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
		const prefix = isZone ? 'zone_' : (isObject ? 'obj_' : 'color_');
		const newId = prefix + Date.now();
		if (!this.scheme.palette) this.scheme.palette = {};
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
