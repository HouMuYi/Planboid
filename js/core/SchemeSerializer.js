/**
 * SchemeSerializer.js - 方案極簡 JSON 權威序列化深模組 (Deep Module)
 * 1. 保留固定方案 ID (scheme.id)，確保瀏覽器重新整理後完美記憶當前所選方案
 * 2. Palette 調色盤採用元組陣列 `p: [[id, name, color], ...]`
 * 3. Tiles 地塊採用元組陣列 `d: [[x, y, z, type, val], ...]`
 * 4. 牆面 100% 無損正規化 (自動將 S/E 邊線轉化為對應格點之 N/W 邊線)
 */

import { ShapeStrokeEngine } from '../renderer/ShapeStrokeEngine.js';

export class SchemeSerializer {
	/**
	 * 將完整的 Scheme 數據結構壓縮為極簡平鋪 JSON 物件
	 * @param {Object} scheme
	 * @returns {Object} 扁平化極簡方案物件
	 */
	static serialize(scheme) {
		if (!scheme) return null;

		// Palette 調色盤元組陣列: [[id, name, color], ...]
		const paletteTuples = Object.entries(scheme.palette || {}).map(([id, item]) => [
			id,
			item.name,
			item.color,
		]);

		// 建立臨時牆面正規化 map，防止漏掉 S / E 方向牆體
		const denseTiles = [];
		if (scheme.tiles) {
			const normalizedWalls = new Map();

			Object.entries(scheme.tiles).forEach(([coordKey, tile]) => {
				const [xStr, yStr, zStr] = coordKey.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				const z = parseInt(zStr, 10);

				if (tile.floorColorId) {
					denseTiles.push([x, y, z, 0, tile.floorColorId]);
				}

				if (tile.label) {
					denseTiles.push([x, y, z, 3, tile.label]);
				}

				if (tile.walls) {
					Object.entries(tile.walls).forEach(([edge, colorId]) => {
						if (colorId) {
							const norm = ShapeStrokeEngine.normalizeWallEdge(x, y, edge);
							const wKey = `${norm.x},${norm.y},${z},${norm.edge}`;
							normalizedWalls.set(wKey, colorId);
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
		}

		return {
			v: 2,
			id: scheme.id || `scheme_${Date.now()}`,
			n: scheme.name || '未命名方案',
			w: scheme.width || 64,
			h: scheme.height || 64,
			ox: scheme.worldOriginX ?? 10500,
			oy: scheme.worldOriginY ?? 9200,
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

		// 解析調色盤
		const paletteMap = {};
		const rawPalette = obj.p || obj.palette;
		if (Array.isArray(rawPalette)) {
			rawPalette.forEach(item => {
				if (Array.isArray(item)) {
					const [id, name, color] = item;
					paletteMap[id] = { name, color };
				} else if (typeof item === 'object' && item !== null) {
					const id = item.i || item.id;
					paletteMap[id] = { name: item.n || item.name, color: item.c || item.color };
				}
			});
		} else if (typeof rawPalette === 'object' && rawPalette !== null) {
			Object.assign(paletteMap, rawPalette);
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
				const [x, y, z, type, val] = tuple;
				if (type === 0) {
					const tile = getTile(x, y, z);
					tile.floorColorId = val;
				} else if (type === 1 || type === 2) {
					const edge = (type === 1) ? 'N' : 'W';
					const norm = ShapeStrokeEngine.normalizeWallEdge(x, y, edge);
					const tile = getTile(norm.x, norm.y, z);
					if (!tile.walls) tile.walls = {};
					tile.walls[norm.edge] = val;
				} else if (type === 3) {
					const tile = getTile(x, y, z);
					tile.label = val;
				}
			});
		} else if (typeof obj.tiles === 'object') {
			Object.entries(obj.tiles).forEach(([key, tile]) => {
				const [xStr, yStr, zStr] = key.split(',');
				const x = parseInt(xStr, 10);
				const y = parseInt(yStr, 10);
				const z = parseInt(zStr, 10);

				const targetTile = getTile(x, y, z);
				if (tile.floorColorId) targetTile.floorColorId = tile.floorColorId;
				if (tile.label) targetTile.label = tile.label;

				if (tile.walls) {
					Object.entries(tile.walls).forEach(([edge, colorId]) => {
						if (colorId) {
							const norm = ShapeStrokeEngine.normalizeWallEdge(x, y, edge);
							const normTile = getTile(norm.x, norm.y, z);
							if (!normTile.walls) normTile.walls = {};
							normTile.walls[norm.edge] = colorId;
						}
					});
				}
			});
		}

		return {
			id: obj.id || `scheme_${Date.now()}`,
			name: obj.n || obj.name || '匯入方案',
			width: obj.w || obj.width || 64,
			height: obj.h || obj.height || 64,
			worldOriginX: obj.ox ?? obj.worldOriginX ?? 10500,
			worldOriginY: obj.oy ?? obj.worldOriginY ?? 9200,
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
		const dLines = (compactObj.d || []).map(tuple => '    ' + JSON.stringify(tuple));
		const dStr = '[\n' + dLines.join(',\n') + '\n  ]';

		return `{\n  "v": ${compactObj.v || 2},\n  "id": ${JSON.stringify(compactObj.id || '')},\n  "n": ${JSON.stringify(compactObj.n || '')},\n  "w": ${
			compactObj.w || 64
		},\n  "h": ${compactObj.h || 64},\n  "ox": ${compactObj.ox ?? 10500},\n  "oy": ${compactObj.oy ?? 9200},\n  "p": ${pStr},\n  "d": ${dStr}\n}`;
	}
}
