/**
 * TileModel.js - 執行期地塊紀錄、邊線正規化與槽位語意查詢
 *
 * 地塊紀錄契約：{ x, y, z, floor?, N?, W? }
 * - 槽位為色票 ID 陣列，空槽位刪除鍵，三槽位皆空則刪除地塊。
 * - scheme.tiles 以 tileKey(x, y, z) 為查找索引，座標以紀錄欄位為準。
 * - 邊線僅存 North / West，South / East 於寫入前經 normalizeEdge 映射。
 */

// 空槽位查詢共用的唯讀結果，避免渲染迴圈逐格配置空陣列
const EMPTY_IDS = Object.freeze([]);

export class TileModel {
	static SLOTS = Object.freeze(['floor', 'N', 'W']);

	static tileKey(x, y, z) {
		return `${x},${y},${z}`;
	}

	/**
	 * 僅供序列化入口解讀物件格式 tiles 的字串鍵
	 * @param {string} key
	 * @returns {{x: number, y: number, z: number}}
	 */
	static parseTileKey(key) {
		const [xStr, yStr, zStr] = String(key).split(',');
		return { x: parseInt(xStr, 10), y: parseInt(yStr, 10), z: parseInt(zStr, 10) };
	}

	static createTile(x, y, z) {
		return { x, y, z };
	}

	/**
	 * PZ 邊線正規化：South 映射為下格 North，East 映射為右格 West
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
	 * @param {Object|undefined} item 色票
	 * @returns {'normal' | 'object' | 'zone'}
	 */
	static paletteKind(item) {
		if (item?.isZone) return 'zone';
		if (item?.isObject) return 'object';
		return 'normal';
	}

	/**
	 * 槽位中的通用色票 (地面底色或牆色)；色票已不存在者略過
	 * 位於渲染熱路徑，以迴圈直接回傳避免配置陣列
	 * @param {string[]|undefined} slot
	 * @param {Record<string, any>} palette
	 * @returns {string|null}
	 */
	static slotBaseColor(slot, palette) {
		if (!slot) return null;
		for (const id of slot) {
			const item = palette[id];
			if (item && !item.isZone && !item.isObject) return id;
		}
		return null;
	}

	static slotObjects(slot, palette) {
		return slot ? slot.filter(id => palette[id]?.isObject) : EMPTY_IDS;
	}

	static slotZones(slot, palette) {
		return slot ? slot.filter(id => palette[id]?.isZone) : EMPTY_IDS;
	}

	/**
	 * 邊線是否以半高牆呈現 (由該邊線的通用色票決定)
	 */
	static isHalfWallSlot(slot, palette) {
		const id = this.slotBaseColor(slot, palette);
		return !!(id && palette[id].isHalfWall);
	}

	/**
	 * 槽位繪製規則：normal 排他替換、zone 集合去重、object 清單累加
	 * @param {string[]|undefined} slot
	 * @param {string} colorId
	 * @param {Record<string, any>} palette
	 * @param {boolean} [isExclusive=false] 清空槽位後僅保留此色票
	 * @returns {string[]}
	 */
	static applySlotPaint(slot, colorId, palette, isExclusive = false) {
		if (!colorId) return slot || [];
		if (isExclusive) return [colorId];
		const arr = slot ? [...slot] : [];
		const kind = this.paletteKind(palette[colorId]);
		if (kind === 'zone') {
			if (!arr.includes(colorId)) arr.push(colorId);
			return arr;
		}
		if (kind === 'object') {
			arr.push(colorId);
			return arr;
		}
		const kept = arr.filter(id => this.paletteKind(palette[id]) !== 'normal');
		kept.push(colorId);
		return kept;
	}

	/**
	 * 槽位清除規則：object 扣減最後一個實例 (N-1)，zone / normal 移除全部同 ID
	 * @param {string[]|undefined} slot
	 * @param {string|null} colorId 為空時清空整個槽位
	 * @param {Record<string, any>} palette
	 * @param {boolean} [isForceAll=false]
	 * @returns {string[]}
	 */
	static removeSlotPaint(slot, colorId, palette, isForceAll = false) {
		if (!slot || slot.length === 0 || isForceAll || !colorId) return [];
		if (palette[colorId]?.isObject) {
			const idx = slot.lastIndexOf(colorId);
			if (idx === -1) return slot;
			const arr = [...slot];
			arr.splice(idx, 1);
			return arr;
		}
		return slot.filter(id => id !== colorId);
	}

	/**
	 * 刪除空槽位
	 * @returns {boolean} 地塊是否已無任何內容
	 */
	static pruneTile(tile) {
		for (const slot of this.SLOTS) {
			if (tile[slot] && tile[slot].length === 0) delete tile[slot];
		}
		return this.isTileEmpty(tile);
	}

	static isTileEmpty(tile) {
		return !tile || !this.SLOTS.some(slot => tile[slot]?.length > 0);
	}
}
