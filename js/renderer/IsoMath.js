/**
 * IsoMath.js - 精確 ISO 與 Ortho 座標幾何轉換與頂點計算
 */

export class IsoMath {
    /**
     * @param {number} tileSize 地塊尺寸 (預設 32px)
     */
    constructor(tileSize = 32) {
        this.tileSize = tileSize;
        this.halfWidth = tileSize;
        this.halfHeight = tileSize / 2;
    }

    /**
     * 計算網格到螢幕座標 (支援正交與菱形動態插值)
     */
    gridToScreen(gridX, gridY, progress = 1.0) {
        const orthoX = gridX * this.tileSize;
        const orthoY = gridY * this.tileSize;

        const isoX = (gridX - gridY) * this.halfWidth;
        const isoY = (gridX + gridY) * this.halfHeight;

        return {
            x: orthoX + (isoX - orthoX) * progress,
            y: orthoY + (isoY - orthoY) * progress
        };
    }

    /**
     * 螢幕座標反算網格座標
     */
    screenToGrid(screenX, screenY, progress = 1.0) {
        if (progress > 0.01) {
            const gridX = (screenX / this.halfWidth + screenY / this.halfHeight) / 2;
            const gridY = (screenY / this.halfHeight - screenX / this.halfWidth) / 2;
            return {
                gridX,
                gridY,
                cellX: Math.floor(gridX),
                cellY: Math.floor(gridY)
            };
        } else {
            const gridX = screenX / this.tileSize;
            const gridY = screenY / this.tileSize;
            return {
                gridX,
                gridY,
                cellX: Math.floor(gridX),
                cellY: Math.floor(gridY)
            };
        }
    }

    /**
     * 取得帶入 PZ 樓層視覺偏移 (-3z, -3z) 後的地塊四頂點 [p0, p1, p2, p3]
     */
    getTilePolyScreen(x, y, z, progress = 1.0) {
        const rX = x - 3 * z * progress;
        const rY = y - 3 * z * progress;

        const p0 = this.gridToScreen(rX, rY, progress);
        const p1 = this.gridToScreen(rX + 1, rY, progress);
        const p2 = this.gridToScreen(rX + 1, rY + 1, progress);
        const p3 = this.gridToScreen(rX, rY + 1, progress);

        return [p0, p1, p2, p3];
    }

    /**
     * 取得帶入 96px 垂直高度後的牆面立體面片 4 頂點 [b0, b1, t1, t0]
     */
    getWallQuad96Screen(x, y, z, edge, progress = 1.0) {
        const [p0, p1, p2, p3] = this.getTilePolyScreen(x, y, z, progress);
        let b0, b1;

        if (edge === "north") { b0 = p0; b1 = p1; }
        else if (edge === "west") { b0 = p0; b1 = p3; }
        else if (edge === "east") { b0 = p1; b1 = p2; }
        else if (edge === "south") { b0 = p3; b1 = p2; }

        if (!b0 || !b1) return null;

        const wallHeight = 96 * progress;
        const t0 = { x: b0.x, y: b0.y - wallHeight };
        const t1 = { x: b1.x, y: b1.y - wallHeight };

        return [b0, b1, t1, t0];
    }

    /**
     * 解析 "x,y,z" 字串鍵為整數座標物件
     */
    static parseTileKey(key) {
        const parts = key.split(",");
        return {
            x: parseInt(parts[0], 10),
            y: parseInt(parts[1], 10),
            z: parseInt(parts[2], 10)
        };
    }
}
