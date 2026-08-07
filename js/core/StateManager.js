/**
 * StateManager.js - 核心領域模型與持久化狀態管理器 (支援 PZ 牆面正規化、舊版 4 方向相容與動態方案調整)
 */

import { BorderEdgeNormalizer } from '../renderer/BorderEdgeNormalizer.js';
import { CONFIG } from './Config.js';
import { eventBus } from './EventBus.js';
import { StorageManager } from './StorageManager.js';
import { ToolModeState } from './ToolModeState.js';
import { UISelectionState } from './UISelectionState.js';

export class StateManager {
	constructor() {
		// 100% 同步讀取 StorageManager，確保構造函數完成時資料即為權威資料，絕不發動非同步覆蓋
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

		// 獨立 UI Transient 狀態與 Tool 狀態
		this.uiState = new UISelectionState();
		this.toolState = new ToolModeState();

		// 目前編輯狀態
		this.currentZLevel = this.scheme.currentLevel || 0;

		// 強制預設選取第一個色塊
		const paletteKeys = Object.keys(this.scheme.palette || {});
		if (paletteKeys.length > 0) {
			this.toolState.setActiveColorId(paletteKeys[0]);
		}

		// Undo / Redo
		this.maxHistory = CONFIG.HISTORY_MAX_STEPS;
		this.undoStack = [];
		this.redoStack = [];

		this.pushHistory();
	}

	// 舊版 4 方向 JSON 相向相容：讀取舊檔案的 south 與 east 時，自動無損轉化為標準的 north 與 west
	normalizeSchemeTiles(scheme) {
		if (!scheme || !scheme.tiles) return;

		const updatedTiles = {};
		Object.entries(scheme.tiles).forEach(([key, tile]) => {
			const [xStr, yStr, zStr] = key.split(',');
			const x = parseInt(xStr, 10);
			const y = parseInt(yStr, 10);

			if (tile.walls) {
				Object.entries(tile.walls).forEach(([edge, colorId]) => {
					if (colorId) {
						const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
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

			if (tile.wallObjects) {
				Object.entries(tile.wallObjects).forEach(([edge, objArray]) => {
					if (Array.isArray(objArray) && objArray.length > 0) {
						const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
						const normKey = `${norm.x},${norm.y},${zStr}`;
						if (!updatedTiles[normKey]) {
							updatedTiles[normKey] = { walls: {} };
						}
						if (!updatedTiles[normKey].wallObjects) {
							updatedTiles[normKey].wallObjects = {};
						}
						updatedTiles[normKey].wallObjects[norm.edge] = objArray;
					}
				});
			}

			if (tile.floorColorId || tile.label || Array.isArray(tile.floorObjects)) {
				if (!updatedTiles[key]) {
					updatedTiles[key] = { walls: {} };
				}
				if (tile.floorColorId) updatedTiles[key].floorColorId = tile.floorColorId;
				if (tile.label) updatedTiles[key].label = tile.label;
				if (Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0) {
					updatedTiles[key].floorObjects = tile.floorObjects;
				}
			}
		});

		scheme.tiles = updatedTiles;
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
	 * 將內部 Z 座標轉為 PZ權威標準顯示 Z 樓層 (0->1, 1->2, -1->-1, -2->-2，不存在0)
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

			// 當尺寸縮小時，清理並裁剪超出新邊界之 tiles
			if (target.tiles) {
				Object.keys(target.tiles).forEach(key => {
					const [xStr, yStr, zStr] = key.split(',');
					const x = parseInt(xStr, 10);
					const y = parseInt(yStr, 10);
					const tile = target.tiles[key];

					if (x > validW || y > validH || (x === validW && y === validH)) {
						delete target.tiles[key];
					} else if (x === validW) {
						delete tile.floorColorId;
						delete tile.floorObjects;
						delete tile.label;
						if (tile.walls) delete tile.walls.N;
						if (tile.wallObjects) delete tile.wallObjects.N;
						this.cleanupEmptyTile(key);
					} else if (y === validH) {
						delete tile.floorColorId;
						delete tile.floorObjects;
						delete tile.label;
						if (tile.walls) delete tile.walls.W;
						if (tile.wallObjects) delete tile.wallObjects.W;
						this.cleanupEmptyTile(key);
					}
				});
			}

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
						delete cloned.label;
						if (cloned.walls) delete cloned.walls.N;
						if (cloned.wallObjects) delete cloned.wallObjects.N;
					} else if (destY === this.scheme.height) {
						delete cloned.floorColorId;
						delete cloned.floorObjects;
						delete cloned.label;
						if (cloned.walls) delete cloned.walls.W;
						if (cloned.wallObjects) delete cloned.wallObjects.W;
					}

					const hasContent = cloned.floorColorId || cloned.label ||
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

	setTileFloor(x, y, colorId) {
		if (x < 0 || x >= this.scheme.width || y < 0 || y >= this.scheme.height) return;
		if (!colorId) {
			this.removeFloor(x, y);
			return;
		}
		const key = `${x},${y},${this.currentZLevel}`;
		if (!this.scheme.tiles[key]) {
			this.scheme.tiles[key] = { walls: {} };
		}
		const isObj = !!(this.scheme.palette && this.scheme.palette[colorId] && this.scheme.palette[colorId].isObject);
		if (isObj) {
			if (!Array.isArray(this.scheme.tiles[key].floorObjects)) {
				this.scheme.tiles[key].floorObjects = [];
			}
			this.scheme.tiles[key].floorObjects.push(colorId);
		} else {
			this.scheme.tiles[key].floorColorId = colorId;
		}
	}

	setTileWall(x, y, edge, colorId) {
		const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
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
			if (this.scheme.tiles[key].wallObjects) {
				delete this.scheme.tiles[key].wallObjects[norm.edge];
			}
			this.cleanupEmptyTile(key);
		} else {
			const isObj = !!(this.scheme.palette && this.scheme.palette[colorId] && this.scheme.palette[colorId].isObject);
			if (isObj) {
				if (!this.scheme.tiles[key].wallObjects) {
					this.scheme.tiles[key].wallObjects = {};
				}
				if (!Array.isArray(this.scheme.tiles[key].wallObjects[norm.edge])) {
					this.scheme.tiles[key].wallObjects[norm.edge] = [];
				}
				this.scheme.tiles[key].wallObjects[norm.edge].push(colorId);
			} else {
				this.scheme.tiles[key].walls[norm.edge] = colorId;
			}
		}
	}

	removeFloor(x, y) {
		const key = `${x},${y},${this.currentZLevel}`;
		if (this.scheme.tiles[key]) {
			delete this.scheme.tiles[key].floorColorId;
			delete this.scheme.tiles[key].floorObjects;
			this.cleanupEmptyTile(key);
		}
	}

	removeWall(x, y, edge) {
		const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
		const key = `${norm.x},${norm.y},${this.currentZLevel}`;
		if (this.scheme.tiles[key]) {
			if (this.scheme.tiles[key].walls) {
				delete this.scheme.tiles[key].walls[norm.edge];
			}
			if (this.scheme.tiles[key].wallObjects) {
				delete this.scheme.tiles[key].wallObjects[norm.edge];
			}
			this.cleanupEmptyTile(key);
		}
	}

	cleanupEmptyTile(key) {
		const tile = this.scheme.tiles[key];
		if (!tile) return;
		const hasFloor = !!tile.floorColorId;
		const hasFloorObjs = Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0;
		const hasWalls = tile.walls && Object.keys(tile.walls).length > 0;
		const hasWallObjs = tile.wallObjects && Object.values(tile.wallObjects).some(arr => Array.isArray(arr) && arr.length > 0);
		const hasLabel = !!tile.label;
		if (!hasFloor && !hasFloorObjs && !hasWalls && !hasWallObjs && !hasLabel) {
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
		if (tile.floorColorId) subTargets.push({ type: 'floor', id: tile.floorColorId });
		if (Array.isArray(tile.floorObjects)) {
			tile.floorObjects.forEach((id, idx) => subTargets.push({ type: 'floorObj', id, index: idx }));
		}
		if (tile.walls && tile.walls.N) subTargets.push({ type: 'wallN', id: tile.walls.N });
		if (tile.wallObjects && Array.isArray(tile.wallObjects.N)) {
			tile.wallObjects.N.forEach((id, idx) => subTargets.push({ type: 'wallNObj', id, index: idx }));
		}
		if (tile.walls && tile.walls.W) subTargets.push({ type: 'wallW', id: tile.walls.W });
		if (tile.wallObjects && Array.isArray(tile.wallObjects.W)) {
			tile.wallObjects.W.forEach((id, idx) => subTargets.push({ type: 'wallWObj', id, index: idx }));
		}

		if (subTargets.length <= 1) {
			this.activeSubTarget = null;
			return false;
		}

		let currentIndex = -1;
		if (this.activeSubTarget) {
			currentIndex = subTargets.findIndex(t => t.type === this.activeSubTarget.type && (t.index === undefined || t.index === this.activeSubTarget.index));
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
					if (tile.floorColorId === id) {
						delete tile.floorColorId;
					}
					if (Array.isArray(tile.floorObjects)) {
						tile.floorObjects = tile.floorObjects.filter(objId => objId !== id);
						if (tile.floorObjects.length === 0) delete tile.floorObjects;
					}
					if (tile.walls) {
						Object.keys(tile.walls).forEach(edge => {
							if (tile.walls[edge] === id) delete tile.walls[edge];
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

	async persist() {
		await StorageManager.saveData({
			activeSchemeId: this.activeSchemeId,
			schemes: this.schemes,
		});
	}

	notifyStateChange(eventType = 'change') {
		this.persist();
		eventBus.emit('state:changed', { type: eventType, state: this });
		window.dispatchEvent(new CustomEvent('statechange', { detail: { type: eventType, state: this } }));
	}
}
