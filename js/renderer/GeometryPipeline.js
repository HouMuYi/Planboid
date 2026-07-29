/**
 * GeometryPipeline.js - 統一幾何投影管線
 * 合流 CanvasRenderer 與 SvgExporter 的幾何頂點與多邊形運算邏輯
 */

import { IsoMath } from "./IsoMath.js";

export class GeometryPipeline {
    /**
     * 計算地塊四個頂點的螢幕投影座標
     */
    static getTilePolyPoints(isoMath, x, y, z, progress = 1.0) {
        let renderX = x;
        let renderY = y;
        if (progress > 0) {
            const offset = 3 * z * progress;
            renderX -= offset;
            renderY -= offset;
        }
        return [
            isoMath.gridToScreen(renderX, renderY, progress),
            isoMath.gridToScreen(renderX + 1, renderY, progress),
            isoMath.gridToScreen(renderX + 1, renderY + 1, progress),
            isoMath.gridToScreen(renderX, renderY + 1, progress)
        ];
    }

    /**
     * 計算 96px 3D 牆面立體四邊形頂點
     */
    static getWallQuad96Points(isoMath, x, y, z, edge, progress = 1.0) {
        let renderX = x;
        let renderY = y;
        if (progress > 0) {
            const offset = 3 * z * progress;
            renderX -= offset;
            renderY -= offset;
        }

        let b0, b1;
        if (edge === "north") { b0 = isoMath.gridToScreen(renderX, renderY, progress); b1 = isoMath.gridToScreen(renderX + 1, renderY, progress); }
        else if (edge === "west") { b0 = isoMath.gridToScreen(renderX, renderY, progress); b1 = isoMath.gridToScreen(renderX, renderY + 1, progress); }
        else if (edge === "east") { b0 = isoMath.gridToScreen(renderX + 1, renderY, progress); b1 = isoMath.gridToScreen(renderX + 1, renderY + 1, progress); }
        else if (edge === "south") { b0 = isoMath.gridToScreen(renderX, renderY + 1, progress); b1 = isoMath.gridToScreen(renderX + 1, renderY + 1, progress); }

        if (!b0 || !b1) return null;

        const wallHeight = 96 * progress;
        const t0 = { x: b0.x, y: b0.y - wallHeight };
        const t1 = { x: b1.x, y: b1.y - wallHeight };

        return [b0, b1, t1, t0];
    }

    /**
     * 排序並過濾指定 Z 軸視角下的 Tile 渲染陣列
     */
    static getSortedTilesToRender(tiles, currentZ, ghostEnabled = true) {
        const zSet = new Set([currentZ]);
        Object.keys(tiles).forEach(k => {
            zSet.add(parseInt(k.split(",")[2], 10));
        });

        const sortedZLevels = Array.from(zSet).sort((a, b) => a - b);
        const result = [];

        sortedZLevels.forEach(z => {
            const isCurrent = (z === currentZ);
            if (!isCurrent && !ghostEnabled) return;

            const dist = Math.abs(z - currentZ);
            const alpha = isCurrent ? 1.0 : Math.max(0.04, 0.22 / (dist * 1.2));
            const desatFactor = isCurrent ? 0.0 : 0.75;

            Object.entries(tiles).forEach(([key, tile]) => {
                const [xStr, yStr, zStr] = key.split(",");
                if (parseInt(zStr, 10) !== z) return;

                result.push({
                    x: parseInt(xStr, 10),
                    y: parseInt(yStr, 10),
                    z,
                    isCurrent,
                    alpha,
                    desatFactor,
                    tile
                });
            });
        });

        return result;
    }
}
