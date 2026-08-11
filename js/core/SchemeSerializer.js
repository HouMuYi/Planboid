/**
 * SchemeSerializer.js - 方案極簡 JSON 權威序列化深模組 (Deep Module)
 * 1. 保留固定方案 ID (scheme.id)，確保瀏覽器重新整理後完美記憶當前所選方案
 * 2. Palette 調色盤採用元組陣列 `p: [[id, name, color], ...]`
 * 3. Tiles 地塊採用元組陣列 `d: [[x, y, z, ...], ...]` (v5 複合格式)
 * 4. 牆面 100% 無損正規化 (自動將 S/E 邊線轉化為對應格點之 N/W 邊線)
 */

import { CONFIG } from './Config.js';
import { BorderEdgeNormalizer } from '../renderer/BorderEdgeNormalizer.js';

export class SchemeSerializer {
	/**
	 * 將 Scheme 領域模型序列化為同格多層複合元組 (v5 規格)
	 * @param {Object} scheme
	 * @returns {Object} 扁平化極簡方案物件
	 */
	static serialize(scheme) {
		if (!scheme || typeof scheme !== 'object') return null;

		// Palette 調色盤元組陣列: [[id, name, color, isObject], ...]
		const paletteTuples = Object.entries(scheme.palette || {}).map(([id, item]) => [
			id,
			item?.name || '',
			item?.color || '#000000',
			item?.isObject ? 1 : 0,
		]);

		// 同格多層複合元組 Map: coordKey -> { floor, wallN, wallW, label, floorObjs, wallNObjs, wallWObjs }
		const tileMap = new Map();
		const getComposite = (x, y, z) => {
			const key = `${x},${y},${z}`;
			if (!tileMap.has(key)) {
				tileMap.set(key, { x, y, z, f: 0, wN: 0, wW: 0, l: 0, fo: 0, woN: 0, woW: 0 });
			}
			return tileMap.get(key);
		};

		if (scheme.tiles) {
			Object.entries(scheme.tiles).forEach(([coordKey, tile]) => {
				const [xStr, yStr, zStr] = coordKey.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				const z = parseInt(zStr, 10);

				if (isNaN(x) || isNaN(y) || isNaN(z) || !tile) return;
				const comp = getComposite(x, y, z);

				if (tile.floorColorId) comp.f = tile.floorColorId;
				if (tile.label) comp.l = tile.label;
				if (Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0) {
					comp.fo = tile.floorObjects;
				}

				if (tile.walls) {
					Object.entries(tile.walls).forEach(([edge, colorId]) => {
						if (colorId) {
							const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
							const normComp = getComposite(norm.x, norm.y, z);
							if (norm.edge === 'N') normComp.wN = colorId;
							else if (norm.edge === 'W') normComp.wW = colorId;
						}
					});
				}

				if (tile.wallObjects) {
					Object.entries(tile.wallObjects).forEach(([edge, objArray]) => {
						if (Array.isArray(objArray) && objArray.length > 0) {
							const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
							const normComp = getComposite(norm.x, norm.y, z);
							if (norm.edge === 'N') normComp.woN = objArray;
							else if (norm.edge === 'W') normComp.woW = objArray;
						}
					});
				}
			});
		}

		// 轉換為複合元組陣列，並進行尾部 0 截斷優化
		const denseTiles = [];
		tileMap.forEach(comp => {
			// 完整槽位: [x, y, z, floor, wallN, wallW, label, floorObjs, wallNObjs, wallWObjs]
			const tuple = [comp.x, comp.y, comp.z, comp.f, comp.wN, comp.wW, comp.l, comp.fo, comp.woN, comp.woW];

			// 尾部 0 截斷
			while (tuple.length > 3 && tuple[tuple.length - 1] === 0) {
				tuple.pop();
			}

			// 若除了座標外完全沒有內容，則不輸出
			if (tuple.length > 3) {
				denseTiles.push(tuple);
			}
		});

		return {
			v: CONFIG.SCHEMA_VERSION || 5,
			id: scheme.id || `scheme_${Date.now()}`,
			n: scheme.name || '未命名方案',
			w: scheme.width || CONFIG.DEFAULT_SCHEME_WIDTH,
			h: scheme.height || CONFIG.DEFAULT_SCHEME_HEIGHT,
			ox: scheme.worldOriginX ?? CONFIG.DEFAULT_ORIGIN_X,
			oy: scheme.worldOriginY ?? CONFIG.DEFAULT_ORIGIN_Y,
			p: paletteTuples,
			d: denseTiles,
		};
	}

	/**
	 * 將輸入的 JSON 字串或 JSON 物件解碼還原為標準 Scheme 物件 (支援 v5 複合元組與 v2~v4 舊單項元組)
	 * @param {string|Object} rawInput
	 * @returns {Object} 標準化 Scheme 領域模型
	 */
	static deserialize(rawInput) {
		if (!rawInput) throw new Error('無效的方案資料輸入');

		let obj = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
		if (!obj || typeof obj !== 'object') throw new Error('解碼目標非合法物件');

		// 解析調色盤
		const paletteMap = {};
		const rawPalette = obj.p || obj.palette;
		if (Array.isArray(rawPalette)) {
			rawPalette.forEach(item => {
				if (Array.isArray(item)) {
					const [id, name, color, isObjFlag] = item;
					if (!id) return;
					const isObj = isObjFlag === 1 || isObjFlag === true || String(id).startsWith('obj_');
					paletteMap[id] = { name: name || '', color: color || '#000000', ...(isObj ? { isObject: true } : {}) };
				} else if (typeof item === 'object' && item !== null) {
					const id = item.i || item.id;
					if (!id) return;
					const isObjFlag = item.isObject || item.o;
					const isObj = !!isObjFlag || String(id).startsWith('obj_');
					paletteMap[id] = { name: item.n || item.name || '', color: item.c || item.color || '#000000', ...(isObj ? { isObject: true } : {}) };
				}
			});
		} else if (typeof rawPalette === 'object' && rawPalette !== null) {
			Object.entries(rawPalette).forEach(([id, item]) => {
				if (!item || typeof item !== 'object') return;
				const isObj = !!item.isObject || String(id).startsWith('obj_');
				paletteMap[id] = { ...item, ...(isObj ? { isObject: true } : {}) };
			});
		}

		const tilesMap = {};
		const getTile = (x, y, z) => {
			const key = `${x},${y},${z}`;
			if (!tilesMap[key]) tilesMap[key] = {};
			return tilesMap[key];
		};

		// 解析地塊元組陣列 (智慧判定 v5 複合元組 vs v2~v4 舊單項元組)
		if (Array.isArray(obj.d)) {
			obj.d.forEach(tuple => {
				if (!Array.isArray(tuple) || tuple.length < 4) return;
				const x = Number(tuple[0]);
				const y = Number(tuple[1]);
				const z = Number(tuple[2]);
				if (isNaN(x) || isNaN(y) || isNaN(z)) return;

				// 判斷是否為舊版單項元組 (tuple[3] 為整數 0~6 代表單項類型)
				const isLegacyTypeTuple = (
					typeof tuple[3] === 'number' &&
					tuple[3] >= 0 && tuple[3] <= 6 &&
					tuple.length <= 5 &&
					(obj.v === undefined || obj.v < 5)
				);

				if (isLegacyTypeTuple) {
					// 舊版 v2~v4 解碼分支
					const type = tuple[3];
					const val = tuple[4];
					if (val === undefined || val === null || val === 0) return;

					if (type === 0) {
						getTile(x, y, z).floorColorId = val;
					} else if (type === 1 || type === 2) {
						const edge = (type === 1) ? 'N' : 'W';
						const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
						const tile = getTile(norm.x, norm.y, z);
						if (!tile.walls) tile.walls = {};
						tile.walls[norm.edge] = val;
					} else if (type === 3) {
						getTile(x, y, z).label = val;
					} else if (type === 4) {
						getTile(x, y, z).floorObjects = Array.isArray(val) ? val : [val];
					} else if (type === 5 || type === 6) {
						const edge = (type === 5) ? 'N' : 'W';
						const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
						const tile = getTile(norm.x, norm.y, z);
						if (!tile.wallObjects) tile.wallObjects = {};
						tile.wallObjects[norm.edge] = Array.isArray(val) ? val : [val];
					}
				} else {
					// 新版 v5 同格多層複合元組解碼分支
					// [x, y, z, floor, wallN, wallW, label, floorObjs, wallNObjs, wallWObjs]
					const floor = tuple[3];
					const wallN = tuple[4];
					const wallW = tuple[5];
					const label = tuple[6];
					const floorObjs = tuple[7];
					const wallNObjs = tuple[8];
					const wallWObjs = tuple[9];

					if (floor && floor !== 0) getTile(x, y, z).floorColorId = floor;
					if (label && label !== 0) getTile(x, y, z).label = label;
					if (Array.isArray(floorObjs) && floorObjs.length > 0) getTile(x, y, z).floorObjects = floorObjs;

					if (wallN && wallN !== 0) {
						const norm = BorderEdgeNormalizer.normalizeEdge(x, y, 'N');
						const tile = getTile(norm.x, norm.y, z);
						if (!tile.walls) tile.walls = {};
						tile.walls[norm.edge] = wallN;
					}

					if (wallW && wallW !== 0) {
						const norm = BorderEdgeNormalizer.normalizeEdge(x, y, 'W');
						const tile = getTile(norm.x, norm.y, z);
						if (!tile.walls) tile.walls = {};
						tile.walls[norm.edge] = wallW;
					}

					if (Array.isArray(wallNObjs) && wallNObjs.length > 0) {
						const norm = BorderEdgeNormalizer.normalizeEdge(x, y, 'N');
						const tile = getTile(norm.x, norm.y, z);
						if (!tile.wallObjects) tile.wallObjects = {};
						tile.wallObjects[norm.edge] = wallNObjs;
					}

					if (Array.isArray(wallWObjs) && wallWObjs.length > 0) {
						const norm = BorderEdgeNormalizer.normalizeEdge(x, y, 'W');
						const tile = getTile(norm.x, norm.y, z);
						if (!tile.wallObjects) tile.wallObjects = {};
						tile.wallObjects[norm.edge] = wallWObjs;
					}
				}
			});
		} else if (typeof obj.tiles === 'object' && obj.tiles !== null) {
			Object.entries(obj.tiles).forEach(([key, tile]) => {
				if (!tile) return;
				const [xStr, yStr, zStr] = key.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				const z = parseInt(zStr, 10);

				if (isNaN(x) || isNaN(y) || isNaN(z)) return;

				const targetTile = getTile(x, y, z);
				if (tile.floorColorId) targetTile.floorColorId = tile.floorColorId;
				if (tile.label) targetTile.label = tile.label;
				if (Array.isArray(tile.floorObjects)) targetTile.floorObjects = [...tile.floorObjects];

				if (tile.walls) {
					Object.entries(tile.walls).forEach(([edge, colorId]) => {
						if (colorId) {
							const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
							const normTile = getTile(norm.x, norm.y, z);
							if (!normTile.walls) normTile.walls = {};
							normTile.walls[norm.edge] = colorId;
						}
					});
				}

				if (tile.wallObjects) {
					Object.entries(tile.wallObjects).forEach(([edge, objArray]) => {
						if (Array.isArray(objArray)) {
							const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
							const normTile = getTile(norm.x, norm.y, z);
							if (!normTile.wallObjects) normTile.wallObjects = {};
							normTile.wallObjects[norm.edge] = [...objArray];
						}
					});
				}
			});
		}

		return {
			id: obj.id || `scheme_${Date.now()}`,
			name: obj.n || obj.name || '匯入方案',
			width: obj.w || obj.width || CONFIG.DEFAULT_SCHEME_WIDTH,
			height: obj.h || obj.height || CONFIG.DEFAULT_SCHEME_HEIGHT,
			worldOriginX: obj.ox ?? obj.worldOriginX ?? CONFIG.DEFAULT_ORIGIN_X,
			worldOriginY: obj.oy ?? obj.worldOriginY ?? CONFIG.DEFAULT_ORIGIN_Y,
			palette: paletteMap,
			tiles: tilesMap,
		};
	}

	/**
	 * 輸出美化 JSON 字串，使子陣列元組保持單行
	 * @param {Object} compactObj
	 * @returns {string} 格式化 JSON 字串
	 */
	static stringifyFormatted(compactObj) {
		if (!compactObj) return '';
		const pStr = JSON.stringify(compactObj.p || []);
		const dList = compactObj.d || [];
		const dStr = dList.length > 0
			? '[\n' + dList.map(tuple => '    ' + JSON.stringify(tuple)).join(',\n') + '\n  ]'
			: '[]';

		return `{\n  "v": ${compactObj.v || CONFIG.SCHEMA_VERSION || 5},\n  "id": ${JSON.stringify(compactObj.id || '')},\n  "n": ${JSON.stringify(compactObj.n || '')},\n  "w": ${
			compactObj.w || CONFIG.DEFAULT_SCHEME_WIDTH
		},\n  "h": ${compactObj.h || CONFIG.DEFAULT_SCHEME_HEIGHT},\n  "ox": ${compactObj.ox ?? CONFIG.DEFAULT_ORIGIN_X},\n  "oy": ${compactObj.oy ?? CONFIG.DEFAULT_ORIGIN_Y},\n  "p": ${pStr},\n  "d": ${dStr}\n}`;
	}

	/**
	 * 將 Scheme 物件高倍率無損壓縮為前綴 Base64 字串 (使用 CONFIG.SCHEMA_VERSION 動態衍生 "PZB5:...")
	 * 採用原生 CompressionStream (deflate-raw)，體積可暴減 85% ~ 95%
	 * @param {Object} scheme
	 * @returns {Promise<string>} 壓縮 Base64 字串
	 */
	static async compressToString(scheme) {
		const compactObj = this.serialize(scheme);
		if (!compactObj) return '';
		const jsonStr = JSON.stringify(compactObj);

		const prefix = `PZB${CONFIG.SCHEMA_VERSION || 5}:`;
		try {
			if (typeof CompressionStream !== 'undefined') {
				const encoder = new TextEncoder();
				const data = encoder.encode(jsonStr);
				const cs = new CompressionStream('deflate-raw');
				const writer = cs.writable.getWriter();
				writer.write(data);
				writer.close();

				const compressedBuffer = await new Response(cs.readable).arrayBuffer();
				const bytes = new Uint8Array(compressedBuffer);

				let binaryStr = '';
				const chunkSize = 0x8000; // 32KB 分塊拼接，防止 Call Stack 溢位
				for (let i = 0; i < bytes.length; i += chunkSize) {
					binaryStr += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
				}
				const base64 = btoa(binaryStr);
				return prefix + base64;
			}
		} catch (e) {
			console.warn('[SchemeSerializer] CompressionStream 壓縮失敗，自動降級為明文 JSON:', e);
		}
		return jsonStr;
	}

	/**
	 * 權威向下相容解碼器：支援 PZB 壓縮字串 (Regex 自動相容任意 PZB1:~PZB5: 前綴)、舊版無壓縮明文 JSON 與原始物件
	 * @param {string|Object} rawInput
	 * @returns {Promise<Object>} 還原 Scheme 領域模型
	 */
	static async decompressFromString(rawInput) {
		if (!rawInput) throw new Error('無效的方案資料輸入');

		if (typeof rawInput === 'object' && rawInput !== null) {
			return this.deserialize(rawInput);
		}

		const str = String(rawInput).trim();
		if (!str) throw new Error('空白方案字串');

		// 1. PZB 標頭匹配 (Regex 相容 PZB1:~PZB5:)
		const pzbMatch = str.match(/^PZB\d+:(.+)$/s);
		if (pzbMatch) {
			try {
				const base64 = pzbMatch[1];
				const binaryStr = atob(base64);
				const bytes = new Uint8Array(binaryStr.length);
				for (let i = 0; i < binaryStr.length; i++) {
					bytes[i] = binaryStr.charCodeAt(i);
				}

				if (typeof DecompressionStream !== 'undefined') {
					const ds = new DecompressionStream('deflate-raw');
					const writer = ds.writable.getWriter();
					writer.write(bytes);
					writer.close();

					const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
					const jsonStr = new TextDecoder().decode(decompressedBuffer);
					return this.parse(JSON.parse(jsonStr));
				}
			} catch (e) {
				console.error('[SchemeSerializer] 解壓 PZB 方案字串失敗:', e);
				throw new Error('壓縮方案字串損毀或解碼失敗');
			}
		}

		// 2. 向下相容路徑：舊版無壓縮 JSON 明文或美化 JSON
		try {
			const obj = JSON.parse(str);
			return this.parse(obj);
		} catch (e) {
			throw new Error('無法解析的方案內容格式');
		}
	}

	/**
	 * 權威統一門面解析器 (Facade Parser)：
	 * 接受 PZB 壓縮 Base64 字串、明文 JSON 字串、平鋪 JSON 物件或 Scheme 物件
	 * 統一完成還原、4 方向牆面正規化與預設色票補齊
	 * @param {string|Object} rawInput
	 * @returns {Object} 100% 合法且標準化的 Scheme 領域模型
	 */
	static parse(rawInput) {
		if (!rawInput) return null;

		let scheme = null;
		try {
			if (typeof rawInput === 'string') {
				const str = rawInput.trim();
				const pzbMatch = str.match(/^PZB\d+:(.+)$/s);
				if (pzbMatch) {
					// PZB 前綴字串需要非同步 decompressFromString，同步門面回傳最安全的預設解析
					scheme = this.deserialize(str);
				} else {
					scheme = this.deserialize(JSON.parse(str));
				}
			} else if (typeof rawInput === 'object') {
				scheme = this.deserialize(rawInput);
			}
		} catch (err) {
			try {
				scheme = this.deserialize(rawInput);
			} catch (e) {
				console.warn('[SchemeSerializer] 解析方案資料失敗:', err);
				return null;
			}
		}

		if (!scheme || typeof scheme !== 'object') return null;

		// 補齊預設物件色票 (🚪 🪟 🚰 🪣 🪜)
		const defaultPalette = {
			'obj_door': { color: '#e11d48', name: '🚪', isObject: true },
			'obj_window': { color: '#f59e0b', name: '🪟', isObject: true },
			'obj_sink': { color: '#38bdf8', name: '🚰', isObject: true },
			'obj_bucket': { color: '#1e40af', name: '🪣', isObject: true },
			'obj_ladder': { color: '#991b1b', name: '🪜', isObject: true },
		};

		if (!scheme.palette) scheme.palette = {};
		Object.entries(defaultPalette).forEach(([objId, defaultItem]) => {
			if (!scheme.palette[objId]) {
				scheme.palette[objId] = { ...defaultItem };
			}
		});

		// 無損正規化牆體
		if (scheme.tiles) {
			const updatedTiles = {};
			Object.entries(scheme.tiles).forEach(([key, tile]) => {
				const [xStr, yStr, zStr] = key.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				if (isNaN(x) || isNaN(y)) return;

				if (tile.walls) {
					Object.entries(tile.walls).forEach(([edge, colorId]) => {
						if (colorId) {
							const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
							const normKey = `${norm.x},${norm.y},${zStr}`;
							if (!updatedTiles[normKey]) updatedTiles[normKey] = { walls: {} };
							if (!updatedTiles[normKey].walls) updatedTiles[normKey].walls = {};
							updatedTiles[normKey].walls[norm.edge] = colorId;
						}
					});
				}

				if (tile.wallObjects) {
					Object.entries(tile.wallObjects).forEach(([edge, objArray]) => {
						if (Array.isArray(objArray) && objArray.length > 0) {
							const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
							const normKey = `${norm.x},${norm.y},${zStr}`;
							if (!updatedTiles[normKey]) updatedTiles[normKey] = { walls: {} };
							if (!updatedTiles[normKey].wallObjects) updatedTiles[normKey].wallObjects = {};
							updatedTiles[normKey].wallObjects[norm.edge] = objArray;
						}
					});
				}

				if (tile.floorColorId || tile.label || Array.isArray(tile.floorObjects)) {
					if (!updatedTiles[key]) updatedTiles[key] = { walls: {} };
					if (tile.floorColorId) updatedTiles[key].floorColorId = tile.floorColorId;
					if (tile.label) updatedTiles[key].label = tile.label;
					if (Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0) {
						updatedTiles[key].floorObjects = tile.floorObjects;
					}
				}
			});
			scheme.tiles = updatedTiles;
		}

		if (!scheme.id) scheme.id = `scheme_${Date.now()}`;
		return scheme;
	}
}
