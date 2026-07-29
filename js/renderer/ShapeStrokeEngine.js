/**
 * ShapeStrokeEngine.js - 純算術形狀插值引擎 (Bresenham 直線與矩形範圍算式)
 * 100% 無相依 DOM 與 Side-effects，專精於幾何座標陣列計算
 */

export class ShapeStrokeEngine {
    /**
     * Bresenham 直線演算法，計算兩點之間的所有網格座標
     * @param {number} x0 
     * @param {number} y0 
     * @param {number} x1 
     * @param {number} y1 
     * @returns {Array<{x: number, y: number}>}
     */
    static getBresenhamLine(x0, y0, x1, y1) {
        const points = [];
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1;
        const sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        let currX = x0;
        let currY = y0;

        while (true) {
            points.push({ x: currX, y: currY });
            if (currX === x1 && currY === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; currX += sx; }
            if (e2 < dx) { err += dx; currY += sy; }
        }
        return points;
    }

    /**
     * 計算對角矩形填滿區域或外圍牆面邊框 Tile 清單
     * @param {{x: number, y: number}} start 
     * @param {{x: number, y: number}} end 
     * @param {"floor" | "wall"} brushType 
     * @returns {{ floors: Array<{x: number, y: number}>, walls: Array<{x: number, y: number, edge: string}> }}
     */
    static getBoxBounds(start, end, brushType) {
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);

        const result = { floors: [], walls: [] };

        if (brushType === "wall") {
            for (let x = minX; x <= maxX; x++) {
                result.walls.push({ x, y: minY, edge: "north" });
                result.walls.push({ x, y: maxY, edge: "south" });
            }
            for (let y = minY; y <= maxY; y++) {
                result.walls.push({ x: minX, y, edge: "west" });
                result.walls.push({ x: maxX, y, edge: "east" });
            }
        } else {
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    result.floors.push({ x, y });
                }
            }
        }
        return result;
    }
}
