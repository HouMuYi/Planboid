/**
 * BorderEdgeNormalizer.js - PZ 邊線正規化工具 (South/East → North/West 無損映射)
 */

export class BorderEdgeNormalizer {
	/**
	 * PZ 邊線正規化：將 South 與 East 自動映射為下格的 North 與右格的 West
	 * 支援全系列大小寫 (N, W, S, E, north, west, south, east)，統一回傳大寫 "N" 或 "W"
	 * @param {number} x
	 * @param {number} y
	 * @param {string} edge
	 * @returns {{x: number, y: number, edge: "N" | "W"}}
	 */
	static normalizeEdge(x, y, edge) {
		const numX = Number(x) || 0;
		const numY = Number(y) || 0;
		if (!edge) return { x: numX, y: numY, edge: 'N' };
		const e = String(edge).trim().toUpperCase();
		if (e === 'SOUTH' || e === 'S') return { x: numX, y: numY + 1, edge: 'N' };
		if (e === 'EAST' || e === 'E') return { x: numX + 1, y: numY, edge: 'W' };
		if (e === 'WEST' || e === 'W') return { x: numX, y: numY, edge: 'W' };
		return { x: numX, y: numY, edge: 'N' };
	}

	/**
	 * 正規化 tiles 地塊集合（將 S/E 邊線映射為 N/W，並統一收束為 floor, N, W 三槽位陣列）
	 * @param {Record<string, any>} tiles
	 * @returns {Record<string, any>}
	 */
	static normalizeTilesMap(tiles) {
		if (!tiles || typeof tiles !== 'object') return {};

		const updatedTiles = {};
		const getTile = (key) => {
			if (!updatedTiles[key]) updatedTiles[key] = { floor: [], N: [], W: [] };
			return updatedTiles[key];
		};

		Object.entries(tiles).forEach(([key, tile]) => {
			if (!tile) return;
			const [xStr, yStr, zStr] = key.split(',');
			const x = parseInt(xStr, 10);
			const y = parseInt(yStr, 10);

			const curTile = getTile(key);

			// 1. 地面槽位 (整合新格式 floor 陣列與舊格式屬性)
			if (Array.isArray(tile.floor)) {
				curTile.floor.push(...tile.floor);
			} else {
				const floorColor = tile.floorColorId || (typeof tile.floor === 'string' ? tile.floor : null);
				if (floorColor) curTile.floor.push(floorColor);
				if (Array.isArray(tile.zoneIds)) curTile.floor.push(...tile.zoneIds);
				else if (tile.zoneId) curTile.floor.push(tile.zoneId);
				if (Array.isArray(tile.floorObjects)) curTile.floor.push(...tile.floorObjects);
			}

			// 輔助函式：將項目陣列或單值正規化後存入目標邊線槽位
			const addEdgeItems = (edge, items) => {
				if (!items) return;
				const arr = Array.isArray(items) ? items : [items];
				if (arr.length === 0) return;
				const norm = this.normalizeEdge(x, y, edge);
				const target = getTile(`${norm.x},${norm.y},${zStr}`);
				target[norm.edge].push(...arr);
			};

			// 2. 新格式 N / W 槽位 (或 S / E 映射)
			['N', 'W', 'S', 'E'].forEach(edge => {
				if (Array.isArray(tile[edge])) {
					addEdgeItems(edge, tile[edge]);
				}
			});

			// 3. 向下相容舊格式 walls, wallObjects, wallZones
			if (tile.walls && typeof tile.walls === 'object') {
				Object.entries(tile.walls).forEach(([edge, val]) => {
					if (val) addEdgeItems(edge, val);
				});
			}
			if (tile.wallObjects && typeof tile.wallObjects === 'object') {
				Object.entries(tile.wallObjects).forEach(([edge, objs]) => {
					if (objs) addEdgeItems(edge, objs);
				});
			}
			if (tile.wallZones && typeof tile.wallZones === 'object') {
				Object.entries(tile.wallZones).forEach(([edge, zoneVal]) => {
					if (zoneVal) addEdgeItems(edge, zoneVal);
				});
			}
		});

		// 清理空槽位與空地塊
		Object.keys(updatedTiles).forEach(k => {
			const t = updatedTiles[k];
			if (t.floor.length === 0) delete t.floor;
			if (t.N.length === 0) delete t.N;
			if (t.W.length === 0) delete t.W;
			if (!t.floor && !t.N && !t.W) {
				delete updatedTiles[k];
			}
		});

		return updatedTiles;
	}
}
