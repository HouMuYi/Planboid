/**
 * SchemeSerializer.js - 方案 JSON 序列化與無損壓縮編解碼模組
 * 所有外部方案資料皆由此轉為執行期地塊契約 (見 TileModel)，歷史格式的判別規則僅存在於本模組
 */

import { CONFIG } from './Config.js';
import { TileModel } from './TileModel.js';

export class SchemeSerializer {
	/**
	 * 將 Scheme 領域模型序列化為三槽位六元組 (v6 規格)
	 * @param {Object} scheme
	 * @returns {Object} 扁平化極簡方案物件
	 */
	static serialize(scheme) {
		if (!scheme || typeof scheme !== 'object') return null;

		// Palette 調色盤元組陣列: [[id, name, color, typeFlag, halfFlag], ...] (typeFlag: 0=floor, 1=object, 2=zone)
		const paletteTuples = Object.entries(scheme.palette).map(([id, item]) => {
			const tuple = [
				id,
				item?.name || '',
				item?.color || '#000000',
				item?.isZone ? 2 : (item?.isObject ? 1 : 0),
			];
			if (item?.isHalfWall) {
				tuple.push(1);
			}
			return tuple;
		});

		// 扁平三槽位六元組陣列: [x, y, z, floor, N, W]，單項槽位存純值、空槽位存 0
		const encodeSlot = slot => (slot?.length > 0 ? (slot.length === 1 ? slot[0] : [...slot]) : 0);
		const denseTiles = [];
		Object.values(scheme.tiles).forEach(tile => {
			const tuple = [tile.x, tile.y, tile.z, encodeSlot(tile.floor), encodeSlot(tile.N), encodeSlot(tile.W)];

			// 尾部 0 截斷
			while (tuple.length > 3 && tuple[tuple.length - 1] === 0) {
				tuple.pop();
			}

			if (tuple.length > 3) {
				denseTiles.push(tuple);
			}
		});

		return {
			v: CONFIG.SCHEMA_VERSION,
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
	 * 將輸入的 JSON 字串或 JSON 物件解碼還原為標準 Scheme 物件 (支援 v6 六元組、v5 十二元組、v2~v4 單項元組與物件格式 tiles)
	 * @param {string|Object} rawInput
	 * @returns {Object} 標準化 Scheme 領域模型
	 */
	static deserialize(rawInput) {
		if (!rawInput) throw new Error('無效的方案資料輸入');

		let obj = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
		if (!obj || typeof obj !== 'object') throw new Error('解碼目標非合法物件');

		// 純數字色票 ID 補 'c' 前綴，避免 JS 物件整數鍵強制升序打亂調色盤順序
		const normalizePaletteId = (rawId) => {
			if (rawId === undefined || rawId === null || rawId === '') return rawId;
			const s = String(rawId).trim();
			return /^\d+$/.test(s) ? `c${s}` : s;
		};

		const kindFlags = (isObj, isZone, isHalfWall) => ({
			...(isObj ? { isObject: true } : {}),
			...(isZone ? { isZone: true } : {}),
			...(isHalfWall ? { isHalfWall: true } : {}),
		});

		// 解析調色盤：元組陣列、物件陣列 (縮寫鍵或完整鍵)、id 對應表三種形式；種類旗標缺漏時以 obj_ / zone_ 前綴推定
		const paletteMap = {};
		const rawPalette = obj.p || obj.palette;
		if (Array.isArray(rawPalette)) {
			rawPalette.forEach(item => {
				if (Array.isArray(item)) {
					const [rawId, name, color, typeFlag, halfFlag] = item;
					if (!rawId && rawId !== 0) return;
					const id = normalizePaletteId(rawId);
					const isZone = typeFlag === 2 || String(id).startsWith('zone_');
					const isObj = !isZone && (typeFlag === 1 || typeFlag === true || String(id).startsWith('obj_'));
					const isHalfWall = !isZone && !isObj && (halfFlag === 1 || halfFlag === true);
					paletteMap[id] = {
						name: name || '',
						color: color || '#000000',
						...kindFlags(isObj, isZone, isHalfWall),
					};
				} else if (typeof item === 'object' && item !== null) {
					const rawId = item.i ?? item.id;
					if (!rawId && rawId !== 0) return;
					const id = normalizePaletteId(rawId);
					const isZone = !!item.isZone || String(id).startsWith('zone_');
					const isObj = !isZone && (!!item.isObject || !!item.o || String(id).startsWith('obj_'));
					const isHalfWall = !isZone && !isObj && (!!item.isHalfWall || !!item.halfWall || item.h === 1);
					paletteMap[id] = {
						name: item.n || item.name || '',
						color: item.c || item.color || '#000000',
						...kindFlags(isObj, isZone, isHalfWall),
					};
				}
			});
		} else if (typeof rawPalette === 'object' && rawPalette !== null) {
			Object.entries(rawPalette).forEach(([rawId, item]) => {
				if (!item || typeof item !== 'object') return;
				const id = normalizePaletteId(rawId);
				const isZone = !!item.isZone || String(id).startsWith('zone_');
				const isObj = !isZone && (!!item.isObject || String(id).startsWith('obj_'));
				const isHalfWall = !isZone && !isObj && !!item.isHalfWall;
				paletteMap[id] = {
					...item,
					...kindFlags(isObj, isZone, isHalfWall),
				};
			});
		}

		const tilesMap = {};
		const getTile = (x, y, z) => {
			const key = TileModel.tileKey(x, y, z);
			return tilesMap[key] || (tilesMap[key] = TileModel.createTile(x, y, z));
		};
		const pushFloor = (x, y, z, ids) => {
			if (ids.length === 0) return;
			const tile = getTile(x, y, z);
			(tile.floor ||= []).push(...ids);
		};
		const pushEdge = (x, y, z, edge, ids) => {
			if (ids.length === 0) return;
			const norm = TileModel.normalizeEdge(x, y, edge);
			const tile = getTile(norm.x, norm.y, z);
			(tile[norm.edge] ||= []).push(...ids);
		};
		// 槽位值可為單一 ID、ID 陣列或 0 (空)
		const asList = v => (Array.isArray(v) ? v : (v && v !== 0 ? [v] : []));

		// v2~v4 單項元組: [x, y, z, type, value]，type 0=地面 1/2=北/西牆 4=地面物件 5/6=北/西牆物件，3 為已廢除類型
		const decodeTupleV2toV4 = (x, y, z, tuple) => {
			const [, , , type, val] = tuple;
			if (val === undefined || val === null || val === 0) return;

			if (type === 0) {
				pushFloor(x, y, z, [normalizePaletteId(val)]);
			} else if (type === 1 || type === 2) {
				pushEdge(x, y, z, type === 1 ? 'N' : 'W', [normalizePaletteId(val)]);
			} else if (type === 4) {
				pushFloor(x, y, z, (Array.isArray(val) ? val : [val]).map(normalizePaletteId));
			} else if (type === 5 || type === 6) {
				pushEdge(x, y, z, type === 5 ? 'N' : 'W', (Array.isArray(val) ? val : [val]).map(normalizePaletteId));
			}
		};

		// v6 三槽位六元組: [x, y, z, floor, N, W]
		const decodeTupleV6 = (x, y, z, tuple) => {
			const [, , , floor, north, west] = tuple;
			pushFloor(x, y, z, asList(floor).map(normalizePaletteId));
			pushEdge(x, y, z, 'N', asList(north).map(normalizePaletteId));
			pushEdge(x, y, z, 'W', asList(west).map(normalizePaletteId));
		};

		// v5 十二元組: [x, y, z, floor, wallN, wallW, zoneId, floorObjs, wallNObjs, wallWObjs, wallZoneN, wallZoneW]
		const decodeTupleV5 = (x, y, z, tuple) => {
			const [, , , floor, wallN, wallW, zoneId, floorObjs, wallNObjs, wallWObjs, wallZoneN, wallZoneW] = tuple;
			const merge = (base, zones, objs) => [base, ...asList(zones), ...(Array.isArray(objs) ? objs : [])].filter(Boolean).map(normalizePaletteId);
			pushFloor(x, y, z, merge(floor, zoneId, floorObjs));
			pushEdge(x, y, z, 'N', merge(wallN, wallZoneN, wallNObjs));
			pushEdge(x, y, z, 'W', merge(wallW, wallZoneW, wallWObjs));
		};

		// 物件格式 tiles: { "x,y,z": { floor, N, W, S, E, floorColorId, zoneId, zoneIds, floorObjects, walls, wallObjects, wallZones } }
		const decodeTilesObject = (key, rawTile) => {
			if (!rawTile) return;
			const { x, y, z } = TileModel.parseTileKey(key);
			if (isNaN(x) || isNaN(y) || isNaN(z)) return;

			const targetTile = getTile(x, y, z);
			if (Array.isArray(rawTile.floor)) {
				targetTile.floor = rawTile.floor.map(normalizePaletteId);
			} else {
				const fItems = [
					rawTile.floorColorId || (typeof rawTile.floor === 'string' ? rawTile.floor : null),
					...(Array.isArray(rawTile.zoneIds) ? rawTile.zoneIds : (rawTile.zoneId ? [rawTile.zoneId] : [])),
					...(Array.isArray(rawTile.floorObjects) ? rawTile.floorObjects : []),
				].filter(Boolean).map(normalizePaletteId);
				if (fItems.length > 0) targetTile.floor = fItems;
			}

			['N', 'W', 'S', 'E'].forEach(edge => {
				if (Array.isArray(rawTile[edge])) {
					pushEdge(x, y, z, edge, rawTile[edge].map(normalizePaletteId));
				}
			});

			if (rawTile.walls) {
				Object.entries(rawTile.walls).forEach(([edge, colorId]) => {
					if (colorId) pushEdge(x, y, z, edge, [normalizePaletteId(colorId)]);
				});
			}
			if (rawTile.wallObjects) {
				Object.entries(rawTile.wallObjects).forEach(([edge, objArray]) => {
					if (Array.isArray(objArray) && objArray.length > 0) {
						pushEdge(x, y, z, edge, objArray.map(normalizePaletteId));
					}
				});
			}
			if (rawTile.wallZones) {
				Object.entries(rawTile.wallZones).forEach(([edge, colorId]) => {
					if (colorId) {
						const wzs = Array.isArray(colorId) ? colorId : [colorId];
						pushEdge(x, y, z, edge, wzs.map(normalizePaletteId));
					}
				});
			}
		};

		// 地塊元組版本判別：判別條件與先後順序即舊存檔的解讀規則
		if (Array.isArray(obj.d)) {
			obj.d.forEach(tuple => {
				if (!Array.isArray(tuple) || tuple.length < 4) return;
				const x = Number(tuple[0]);
				const y = Number(tuple[1]);
				const z = Number(tuple[2]);
				if (isNaN(x) || isNaN(y) || isNaN(z)) return;

				// 舊版單項元組：第 4 欄為 0~6 的類型整數
				const isLegacyTypeTuple = (
					typeof tuple[3] === 'number' &&
					tuple[3] >= 0 && tuple[3] <= 6 &&
					tuple.length <= 5 &&
					(obj.v === undefined || obj.v < 5)
				);

				if (isLegacyTypeTuple) {
					decodeTupleV2toV4(x, y, z, tuple);
				} else if (obj.v >= 6 || (tuple.length <= 6 && (Array.isArray(tuple[3]) || Array.isArray(tuple[4]) || Array.isArray(tuple[5])))) {
					decodeTupleV6(x, y, z, tuple);
				} else {
					decodeTupleV5(x, y, z, tuple);
				}
			});
		} else if (typeof obj.tiles === 'object' && obj.tiles !== null) {
			Object.entries(obj.tiles).forEach(([key, rawTile]) => decodeTilesObject(key, rawTile));
		}

		Object.keys(tilesMap).forEach(key => {
			if (TileModel.pruneTile(tilesMap[key])) delete tilesMap[key];
		});

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

		return `{\n  "v": ${compactObj.v || CONFIG.SCHEMA_VERSION},\n  "id": ${JSON.stringify(compactObj.id || '')},\n  "n": ${JSON.stringify(compactObj.n || '')},\n  "w": ${
			compactObj.w || CONFIG.DEFAULT_SCHEME_WIDTH
		},\n  "h": ${compactObj.h || CONFIG.DEFAULT_SCHEME_HEIGHT},\n  "ox": ${compactObj.ox ?? CONFIG.DEFAULT_ORIGIN_X},\n  "oy": ${compactObj.oy ?? CONFIG.DEFAULT_ORIGIN_Y},\n  "p": ${pStr},\n  "d": ${dStr}\n}`;
	}

	/**
	 * 將 Scheme 物件高倍率無損壓縮為前綴 Base64 字串 (使用 CONFIG.SCHEMA_VERSION 動態衍生 "PZB6:...")
	 * 採用原生 CompressionStream (deflate-raw)，體積可暴減 85% ~ 95%
	 * @param {Object} scheme
	 * @returns {Promise<string>} 壓縮 Base64 字串
	 */
	static async compressToString(scheme) {
		const compactObj = this.serialize(scheme);
		if (!compactObj) return '';
		const jsonStr = JSON.stringify(compactObj);

		const prefix = `PZB${CONFIG.SCHEMA_VERSION}:`;
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
	 * 相容解碼器：支援 PZB 壓縮字串、舊版無壓縮明文 JSON 與原始物件
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

		// 1. PZB 標頭匹配 (Regex 相容 PZB1: 起所有版號)
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
	 * 統一同步解析器：接受明文 JSON 字串、平鋪 JSON 物件或 Scheme 物件，完成還原並補齊預設物件色票
	 * PZB 壓縮字串需經非同步 decompressFromString 解碼，於此回傳 null
	 * @param {string|Object} rawInput
	 * @returns {Object|null} 標準化 Scheme 領域模型
	 */
	static parse(rawInput) {
		if (!rawInput) return null;
		if (typeof rawInput === 'string' && /^PZB\d+:/.test(rawInput.trim())) {
			console.warn('[SchemeSerializer] PZB 壓縮字串需經 decompressFromString 解碼');
			return null;
		}

		let scheme;
		try {
			scheme = this.deserialize(rawInput);
		} catch (err) {
			console.warn('[SchemeSerializer] 解析方案資料失敗:', err);
			return null;
		}

		CONFIG.DEFAULT_PALETTE_ITEMS.forEach(({ id, color, name, isObject }) => {
			if (isObject && !scheme.palette[id]) {
				scheme.palette[id] = { color, name, isObject: true };
			}
		});

		return scheme;
	}
}
