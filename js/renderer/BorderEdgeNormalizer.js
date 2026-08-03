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
		if (!edge) return { x, y, edge: 'N' };
		const e = String(edge).trim().toUpperCase();
		if (e === 'SOUTH' || e === 'S') return { x, y: y + 1, edge: 'N' };
		if (e === 'EAST' || e === 'E') return { x: x + 1, y, edge: 'W' };
		if (e === 'WEST' || e === 'W') return { x, y, edge: 'W' };
		return { x, y, edge: 'N' };
	}
}
