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
	 * 正規化 tiles 地塊集合（將 S/E 邊線映射為 N/W）
	 * @param {Record<string, any>} tiles
	 * @returns {Record<string, any>}
	 */
	static normalizeTilesMap(tiles) {
		if (!tiles || typeof tiles !== 'object') return {};

		const updatedTiles = {};
		const getTile = (key) => {
			if (!updatedTiles[key]) updatedTiles[key] = {};
			return updatedTiles[key];
		};

		Object.entries(tiles).forEach(([key, tile]) => {
			if (!tile) return;
			const [xStr, yStr, zStr] = key.split(',');
			const x = parseInt(xStr, 10);
			const y = parseInt(yStr, 10);

			// 1. 面域宿主 (保持 floorColorId, zoneId, floorObjects 獨立)
			const curTile = getTile(key);
			const floorColor = tile.floorColorId || (typeof tile.floor === 'string' ? tile.floor : null);
			if (floorColor) curTile.floorColorId = floorColor;
			if (tile.zoneId) curTile.zoneId = tile.zoneId;
			if (Array.isArray(tile.floorObjects) && tile.floorObjects.length > 0) {
				curTile.floorObjects = [...tile.floorObjects];
			}

			// 2. 邊線實體牆 (South/East -> North/West 映射)
			if (tile.walls && typeof tile.walls === 'object') {
				Object.entries(tile.walls).forEach(([edge, val]) => {
					if (!val || typeof val !== 'string') return;
					const norm = this.normalizeEdge(x, y, edge);
					const t = getTile(`${norm.x},${norm.y},${zStr}`);
					if (!t.walls) t.walls = {};
					t.walls[norm.edge] = val;
				});
			}

			// 3. 邊線物件 (South/East -> North/West 映射，陣列保留多重疊加)
			if (tile.wallObjects && typeof tile.wallObjects === 'object') {
				Object.entries(tile.wallObjects).forEach(([edge, objs]) => {
					if (!Array.isArray(objs) || objs.length === 0) return;
					const norm = this.normalizeEdge(x, y, edge);
					const t = getTile(`${norm.x},${norm.y},${zStr}`);
					if (!t.wallObjects) t.wallObjects = {};
					if (!Array.isArray(t.wallObjects[norm.edge])) t.wallObjects[norm.edge] = [];
					t.wallObjects[norm.edge].push(...objs);
				});
			}

			// 4. 邊線標籤 (South/East -> North/West 映射)
			if (tile.wallZones && typeof tile.wallZones === 'object') {
				Object.entries(tile.wallZones).forEach(([edge, zoneVal]) => {
					if (!zoneVal || typeof zoneVal !== 'string') return;
					const norm = this.normalizeEdge(x, y, edge);
					const t = getTile(`${norm.x},${norm.y},${zStr}`);
					if (!t.wallZones) t.wallZones = {};
					t.wallZones[norm.edge] = zoneVal;
				});
			}
		});

		Object.keys(updatedTiles).forEach(k => {
			const t = updatedTiles[k];
			const hasFloor = !!t.floorColorId || !!t.zoneId || (Array.isArray(t.floorObjects) && t.floorObjects.length > 0);
			const hasWalls = t.walls && Object.keys(t.walls).length > 0;
			const hasWallObjs = t.wallObjects && Object.values(t.wallObjects).some(arr => Array.isArray(arr) && arr.length > 0);
			const hasWallZones = t.wallZones && Object.keys(t.wallZones).length > 0;
			if (!hasFloor && !hasWalls && !hasWallObjs && !hasWallZones) {
				delete updatedTiles[k];
			}
		});

		return updatedTiles;
	}
}
