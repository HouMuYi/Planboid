/**
 * ShapeStrokeEngine.js - 純算術形狀插值引擎 (含 PZ 牆面正規化與矩形區域擦除)
 */

export class ShapeStrokeEngine {
    /**
     * PZ 牆面正規化：將 South 與 East 自動映射為下格的 North 與右格的 West
     * @param {number} x 
     * @param {number} y 
     * @param {string} edge 
     * @returns {{x: number, y: number, edge: "north" | "west"}}
     */
    static normalizeWallEdge(x, y, edge) {
        if (edge === "south") return { x, y: y + 1, edge: "north" };
        if (edge === "east") return { x: x + 1, y, edge: "west" };
        return { x, y, edge: (edge === "west" ? "west" : "north") };
    }

    /**
     * Bresenham 直線演算法
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
     * 計算矩形區域繪製或區域內全邊線擦除範圍
     * @param {{x: number, y: number}} start 
     * @param {{x: number, y: number}} end 
     * @param {"floor" | "wall"} brushType 
     * @param {boolean} isErasing 
     * @returns {{ floors: Array<{x: number, y: number}>, walls: Array<{x: number, y: number, edge: "north" | "west"}> }}
     */
    static getBoxBounds(start, end, brushType, isErasing = false) {
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);

        const result = { floors: [], walls: [] };

        if (brushType === "wall") {
            if (isErasing) {
                // 擦除牆面：清除矩形區域內部的所有 North 與 West 牆面（含最右與最下延伸邊界）
                for (let x = minX; x <= maxX + 1; x++) {
                    for (let y = minY; y <= maxY + 1; y++) {
                        if (x <= maxX) result.walls.push({ x, y, edge: "north" });
                        if (y <= maxY) result.walls.push({ x, y, edge: "west" });
                    }
                }
            } else {
                // 繪製牆面：僅圍出外框
                for (let x = minX; x <= maxX; x++) {
                    result.walls.push(this.normalizeWallEdge(x, minY, "north"));
                    result.walls.push(this.normalizeWallEdge(x, maxY, "south"));
                }
                for (let y = minY; y <= maxY; y++) {
                    result.walls.push(this.normalizeWallEdge(minX, y, "west"));
                    result.walls.push(this.normalizeWallEdge(maxX, y, "east"));
                }
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
