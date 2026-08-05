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
}
