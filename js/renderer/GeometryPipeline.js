/**
 * GeometryPipeline.js - 統一幾何投影管線與樓層視覺偏移 (LevelVisualOffset)
 * 合流 CanvasRenderer 與 SvgExporter 的幾何頂點與多邊形運算邏輯
 */

import { IsoMath } from "./IsoMath.js";

/**
 * 樓層視覺偏移 (Level Visual Offset) 權威封裝模組
 */
export class LevelVisualOffset {
    static getOffset(z, progress = 1.0) {
        return progress > 0 ? 3 * z * progress : 0;
    }

    static toRenderPos(logicX, logicY, z, progress = 1.0) {
        const offset = LevelVisualOffset.getOffset(z, progress);
        return { renderX: logicX - offset, renderY: logicY - offset };
    }

    static toLogicPos(renderCellX, renderCellY, z, progress = 1.0) {
        const offset = LevelVisualOffset.getOffset(z, progress);
        return { logicX: Math.round(renderCellX + offset), logicY: Math.round(renderCellY + offset) };
    }
}

export class GeometryPipeline {
    /**
     * 計算地塊四個頂點的螢幕投影座標
     */
    static getTilePolyPoints(isoMath, x, y, z, progress = 1.0) {
        const { renderX, renderY } = LevelVisualOffset.toRenderPos(x, y, z, progress);
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
        const { renderX, renderY } = LevelVisualOffset.toRenderPos(x, y, z, progress);

        let b0, b1;
        const e = String(edge || "").toLowerCase();
        if (e === "north" || e === "n") { b0 = isoMath.gridToScreen(renderX, renderY, progress); b1 = isoMath.gridToScreen(renderX + 1, renderY, progress); }
        else if (e === "west" || e === "w") { b0 = isoMath.gridToScreen(renderX, renderY, progress); b1 = isoMath.gridToScreen(renderX, renderY + 1, progress); }
        else if (e === "east" || e === "e") { b0 = isoMath.gridToScreen(renderX + 1, renderY, progress); b1 = isoMath.gridToScreen(renderX + 1, renderY + 1, progress); }
        else if (e === "south" || e === "s") { b0 = isoMath.gridToScreen(renderX, renderY + 1, progress); b1 = isoMath.gridToScreen(renderX + 1, renderY + 1, progress); }

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
            const alpha = isCurrent ? 1.0 : Math.max(0.08, 0.35 / (dist * 1.1));
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

    /**
     * 計算能夠在指定 Viewport 下「恰恰好包覆全畫布與所有樓層地塊」的最佳 Camera X, Y 與 Zoom
     */
    static calculateFitCameraPos(isoMath, scheme, currentProgress, viewportWidth, viewportHeight, padding = 40) {
        const w = scheme.width;
        const h = scheme.height;

        const zSet = new Set([0]);
        if (scheme && scheme.tiles) {
            Object.keys(scheme.tiles).forEach(k => {
                const zVal = parseInt(k.split(",")[2], 10);
                if (!isNaN(zVal)) zSet.add(zVal);
            });
        }
        const maxZ = Math.max(...Array.from(zSet));
        const minZ = Math.min(...Array.from(zSet));

        const samplePoints = [];
        [minZ, maxZ].forEach(z => {
            samplePoints.push(
                ...GeometryPipeline.getTilePolyPoints(isoMath, 0, 0, z, currentProgress),
                ...GeometryPipeline.getTilePolyPoints(isoMath, w, 0, z, currentProgress),
                ...GeometryPipeline.getTilePolyPoints(isoMath, w, h, z, currentProgress),
                ...GeometryPipeline.getTilePolyPoints(isoMath, 0, h, z, currentProgress)
            );
            const wallOffset = 96 * currentProgress;
            const pTop = isoMath.gridToScreen(-3 * z * currentProgress, -3 * z * currentProgress, currentProgress);
            samplePoints.push({ x: pTop.x, y: pTop.y - wallOffset });
        });

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        samplePoints.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });

        const boundsW = Math.max(10, maxX - minX);
        const boundsH = Math.max(10, maxY - minY);

        const zoomX = (viewportWidth - padding * 2) / boundsW;
        const zoomY = (viewportHeight - padding * 2) / boundsH;
        const fitZoom = Math.max(0.15, Math.min(4.0, Math.min(zoomX, zoomY)));

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const cameraX = viewportWidth / 2 - centerX * fitZoom;
        const cameraY = viewportHeight / 2 - centerY * fitZoom;

        return { zoom: fitZoom, cameraX, cameraY, minX, minY, maxX, maxY };
    }
}
