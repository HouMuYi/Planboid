/**
 * SchemeSerializer.js - 方案極簡 JSON 權威序列化深模組 (Deep Module)
 * 1. 保留固定方案 ID (scheme.id)，確保瀏覽器重新整理後完美記憶當前所選方案
 * 2. Palette 調色盤採用元組陣列 `p: [[id, name, color], ...]`
 * 3. Tiles 地塊採用元組陣列 `d: [[x, y, z, type, val], ...]`
 * 4. 牆面 100% 無損正規化 (自動將 S/E 邊線轉化為對應格點之 N/W 邊線)
 */

import { CONFIG } from './Config.js';
import { BorderEdgeNormalizer } from '../renderer/BorderEdgeNormalizer.js';

export class SchemeSerializer {
	/**
	 * 將完整的 Scheme 數據結構壓縮為極簡平鋪 JSON 物件
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

		// 建立臨時牆面與牆面物件正規化 map
		const denseTiles = [];
		if (scheme.tiles) {
			const normalizedWalls = new Map();
			const normalizedWallObjects = new Map();

			Object.entries(scheme.tiles).forEach(([coordKey, tile]) => {
				const [xStr, yStr, zStr] = coordKey.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				const z = parseInt(zStr, 10);

				if (isNaN(x) || isNaN(y) || isNaN(z) || !tile) return;

				if (tile.floorColorId) {
					denseTiles.push([x, y, z, 0, tile.floorColorId]);
				}

				if (Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0) {
					denseTiles.push([x, y, z, 4, tile.floorObjects]);
				}

				if (tile.label) {
					denseTiles.push([x, y, z, 3, tile.label]);
				}

				if (tile.walls) {
					Object.entries(tile.walls).forEach(([edge, colorId]) => {
						if (colorId) {
							const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
							const wKey = `${norm.x},${norm.y},${z},${norm.edge}`;
							normalizedWalls.set(wKey, colorId);
						}
					});
				}

				if (tile.wallObjects) {
					Object.entries(tile.wallObjects).forEach(([edge, objArray]) => {
						if (Array.isArray(objArray) && objArray.length > 0) {
							const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
							const wKey = `${norm.x},${norm.y},${z},${norm.edge}`;
							normalizedWallObjects.set(wKey, objArray);
						}
					});
				}
			});

			normalizedWalls.forEach((colorId, wKey) => {
				const [xStr, yStr, zStr, edge] = wKey.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				const z = parseInt(zStr, 10);
				const type = (edge === 'N') ? 1 : 2;
				denseTiles.push([x, y, z, type, colorId]);
			});

			normalizedWallObjects.forEach((objArray, wKey) => {
				const [xStr, yStr, zStr, edge] = wKey.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				const z = parseInt(zStr, 10);
				const type = (edge === 'N') ? 5 : 6;
				denseTiles.push([x, y, z, type, objArray]);
			});
		}

		return {
			v: 2,
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
	 * 將輸入的 JSON 字串或 JSON 物件解碼還原為標準 Scheme 物件
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

		// 解析地塊元組陣列: [[x, y, z, type, val], ...]
		if (Array.isArray(obj.d)) {
			obj.d.forEach(tuple => {
				if (!Array.isArray(tuple) || tuple.length < 5) return;
				const [xRaw, yRaw, zRaw, type, val] = tuple;
				const x = Number(xRaw);
				const y = Number(yRaw);
				const z = Number(zRaw);

				if (isNaN(x) || isNaN(y) || isNaN(z) || val === undefined || val === null) return;

				if (type === 0) {
					const tile = getTile(x, y, z);
					tile.floorColorId = val;
				} else if (type === 1 || type === 2) {
					const edge = (type === 1) ? 'N' : 'W';
					const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
					const tile = getTile(norm.x, norm.y, z);
					if (!tile.walls) tile.walls = {};
					tile.walls[norm.edge] = val;
				} else if (type === 3) {
					const tile = getTile(x, y, z);
					tile.label = val;
				} else if (type === 4) {
					const tile = getTile(x, y, z);
					tile.floorObjects = Array.isArray(val) ? val : [val];
				} else if (type === 5 || type === 6) {
					const edge = (type === 5) ? 'N' : 'W';
					const norm = BorderEdgeNormalizer.normalizeEdge(x, y, edge);
					const tile = getTile(norm.x, norm.y, z);
					if (!tile.wallObjects) tile.wallObjects = {};
					tile.wallObjects[norm.edge] = Array.isArray(val) ? val : [val];
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
	 * 輸出美化 JSON 字串，使子陣列元組 [x,y,z,type,val] 保持單行
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

		return `{\n  "v": ${compactObj.v || 2},\n  "id": ${JSON.stringify(compactObj.id || '')},\n  "n": ${JSON.stringify(compactObj.n || '')},\n  "w": ${
			compactObj.w || CONFIG.DEFAULT_SCHEME_WIDTH
		},\n  "h": ${compactObj.h || CONFIG.DEFAULT_SCHEME_HEIGHT},\n  "ox": ${compactObj.ox ?? CONFIG.DEFAULT_ORIGIN_X},\n  "oy": ${compactObj.oy ?? CONFIG.DEFAULT_ORIGIN_Y},\n  "p": ${pStr},\n  "d": ${dStr}\n}`;
	}

	/**
	 * 將 Scheme 物件高倍率無損壓縮為前綴 Base64 字串 ("PZB1:...")
	 * 採用原生 CompressionStream (deflate-raw)，體積可暴減 85% ~ 95%
	 * @param {Object} scheme
	 * @returns {Promise<string>} PZB1: 前綴壓縮 Base64 字串
	 */
	static async compressToString(scheme) {
		const compactObj = this.serialize(scheme);
		if (!compactObj) return '';
		const jsonStr = JSON.stringify(compactObj);

		try {
			if (typeof window !== 'undefined' && 'CompressionStream' in window) {
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
				return 'PZB1:' + base64;
			}
		} catch (e) {
			console.warn('[SchemeSerializer] CompressionStream 壓縮失敗，自動降級為明文 JSON:', e);
		}
		return jsonStr;
	}

	/**
	 * 權威向下相容解碼器：支援新版 PZB1: 壓縮字串、舊版無壓縮明文 JSON 與原始物件
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

		// 1. 新版 PZB1: 高倍率解壓路徑
		if (str.startsWith('PZB1:')) {
			try {
				const base64 = str.substring(5);
				const binaryStr = atob(base64);
				const bytes = new Uint8Array(binaryStr.length);
				for (let i = 0; i < binaryStr.length; i++) {
					bytes[i] = binaryStr.charCodeAt(i);
				}

				if (typeof window !== 'undefined' && 'DecompressionStream' in window) {
					const ds = new DecompressionStream('deflate-raw');
					const writer = ds.writable.getWriter();
					writer.write(bytes);
					writer.close();

					const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
					const jsonStr = new TextDecoder().decode(decompressedBuffer);
					return this.deserialize(JSON.parse(jsonStr));
				}
			} catch (e) {
				console.error('[SchemeSerializer] 解壓 PZB1: 方案字串失敗:', e);
				throw new Error('壓縮方案字串損毀或解碼失敗');
			}
		}

		// 2. 向下相容路徑：舊版無壓縮 JSON 明文或美化 JSON
		try {
			const obj = JSON.parse(str);
			return this.deserialize(obj);
		} catch (e) {
			throw new Error('無法解析的方案內容格式');
		}
	}
}
