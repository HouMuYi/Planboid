/**
 * PngExporter.js - 帶全包覆視角與質感圖例的 PNG 圖片快照匯出器 (100% 離線純靜態相容)
 */

import { i18n } from "../core/I18nManager.js";
import { IsoMath } from "./IsoMath.js";
import { GeometryPipeline } from "./GeometryPipeline.js";

export class PngExporter {
    /**
     * 匯出全自動包覆縮放、無互動 UI 雜點且帶有質感圖例的 PNG 快照
     * @param {import("../core/StateManager.js").StateManager} stateManager 
     * @param {import("./CanvasRenderer.js").CanvasRenderer} renderer
     */
    static exportToPng(stateManager, renderer) {
        const mainCanvas = document.getElementById("main-canvas");
        if (!mainCanvas) return;

        const scheme = stateManager.scheme;
        const currentZ = stateManager.currentZLevel;
        const palette = scheme.palette || {};
        const paletteEntries = Object.values(palette);
        const isoMath = new IsoMath(32);

        // 離屏 Canvas 尺寸同目前主畫布
        const offCanvas = document.createElement("canvas");
        offCanvas.width = mainCanvas.width;
        offCanvas.height = mainCanvas.height;
        const ctx = offCanvas.getContext("2d");

        const viewportW = mainCanvas.width / (window.devicePixelRatio || 1);
        const viewportH = mainCanvas.height / (window.devicePixelRatio || 1);
        const currentProgress = renderer ? renderer.currentProgress : 1.0;

        // 全自動計算恰恰好包覆全畫布與地塊的最佳 Zoom 與 Camera 位移 (包含 1:1 正交與 2:1 菱形)
        const fit = GeometryPipeline.calculateFitCameraPos(
            isoMath,
            scheme,
            currentProgress,
            viewportW,
            viewportH,
            60 // 留白邊距 padding
        );

        ctx.save();
        ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

        // 1. 純黑背景
        ctx.fillStyle = "#0b0f19";
        ctx.fillRect(0, 0, viewportW, viewportH);

        // 套用全包覆相機矩陣
        ctx.save();
        ctx.translate(fit.cameraX, fit.cameraY);
        ctx.scale(fit.zoom, fit.zoom);

        // 2. 繪製底層網格 (Grid)
        ctx.lineWidth = 1 / fit.zoom;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        for (let x = 0; x <= scheme.width; x++) {
            const start = GeometryPipeline.getTilePolyPoints(isoMath, x, 0, currentZ, currentProgress)[0];
            const end = GeometryPipeline.getTilePolyPoints(isoMath, x, scheme.height, currentZ, currentProgress)[0];
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }
        for (let y = 0; y <= scheme.height; y++) {
            const start = GeometryPipeline.getTilePolyPoints(isoMath, 0, y, currentZ, currentProgress)[0];
            const end = GeometryPipeline.getTilePolyPoints(isoMath, scheme.width, y, currentZ, currentProgress)[0];
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }

        // 外邊界紫線
        ctx.strokeStyle = "rgba(99, 102, 241, 0.6)";
        ctx.lineWidth = 2 / fit.zoom;
        const p00 = GeometryPipeline.getTilePolyPoints(isoMath, 0, 0, currentZ, currentProgress)[0];
        const p10 = GeometryPipeline.getTilePolyPoints(isoMath, scheme.width, 0, currentZ, currentProgress)[0];
        const p11 = GeometryPipeline.getTilePolyPoints(isoMath, scheme.width, scheme.height, currentZ, currentProgress)[2];
        const p01 = GeometryPipeline.getTilePolyPoints(isoMath, 0, scheme.height, currentZ, currentProgress)[0];
        ctx.beginPath();
        ctx.moveTo(p00.x, p00.y);
        ctx.lineTo(p10.x, p10.y);
        ctx.lineTo(p11.x, p11.y);
        ctx.lineTo(p01.x, p01.y);
        ctx.closePath();
        ctx.stroke();

        // 3. 渲染所有樓層 (地塊 -> 牆面 -> 標籤)，過濾選區與 Hover 雜點
        const tilesToRender = GeometryPipeline.getSortedTilesToRender(scheme.tiles, currentZ, stateManager.ghostLayerEnabled);

        // Pass 1: Floor Polygons
        tilesToRender.forEach(item => {
            const { x, y, z, isCurrent, alpha, desatFactor, tile } = item;
            if (tile.floorColorId && palette[tile.floorColorId]) {
                const rawColor = palette[tile.floorColorId].color;
                const finalColor = isCurrent ? rawColor : PngExporter.desaturateHex(rawColor, desatFactor);
                const [p0, p1, p2, p3] = GeometryPipeline.getTilePolyPoints(isoMath, x, y, z, currentProgress);

                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = finalColor;
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.lineTo(p3.x, p3.y);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        });

        // Pass 2: Wall Quads & Lines
        tilesToRender.forEach(item => {
            const { x, y, z, isCurrent, alpha, desatFactor, tile } = item;
            if (tile.walls) {
                Object.entries(tile.walls).forEach(([edge, colorId]) => {
                    if (colorId && palette[colorId]) {
                        const rawColor = palette[colorId].color;
                        const finalColor = isCurrent ? rawColor : PngExporter.desaturateHex(rawColor, desatFactor);
                        if (stateManager.is3DWallsEnabled && currentProgress > 0) {
                            const quad = GeometryPipeline.getWallQuad96Points(isoMath, x, y, z, edge, currentProgress);
                            if (quad) {
                                const [b0, b1, t1, t0] = quad;
                                ctx.save();
                                ctx.globalAlpha = alpha * 0.45;
                                ctx.fillStyle = finalColor;
                                ctx.beginPath();
                                ctx.moveTo(b0.x, b0.y);
                                ctx.lineTo(b1.x, b1.y);
                                ctx.lineTo(t1.x, t1.y);
                                ctx.lineTo(t0.x, t0.y);
                                ctx.closePath();
                                ctx.fill();

                                ctx.globalAlpha = alpha * 0.8;
                                ctx.strokeStyle = finalColor;
                                ctx.lineWidth = 2 / fit.zoom;
                                ctx.stroke();
                                ctx.restore();
                            }
                        } else {
                            let p0, p1;
                            const offset = GeometryPipeline.getTilePolyPoints(isoMath, x, y, z, currentProgress);
                            if (edge === "north") { p0 = offset[0]; p1 = offset[1]; }
                            else if (edge === "west") { p0 = offset[0]; p1 = offset[3]; }
                            if (p0 && p1) {
                                ctx.save();
                                ctx.globalAlpha = alpha;
                                ctx.strokeStyle = finalColor;
                                ctx.lineWidth = 5 / fit.zoom;
                                ctx.lineCap = "round";
                                ctx.beginPath();
                                ctx.moveTo(p0.x, p0.y);
                                ctx.lineTo(p1.x, p1.y);
                                ctx.stroke();
                                ctx.restore();
                            }
                        }
                    }
                });
            }
        });

        // Pass 3: Labels
        tilesToRender.forEach(item => {
            const { x, y, z, isCurrent, tile } = item;
            if (tile.label && isCurrent) {
                const center = GeometryPipeline.getTilePolyPoints(isoMath, x + 0.5, y + 0.5, z, currentProgress)[0];
                ctx.save();
                ctx.fillStyle = "#ffffff";
                ctx.font = `bold ${Math.max(10, 12 / fit.zoom)}px Inter, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.shadowColor = "rgba(0,0,0,0.9)";
                ctx.shadowBlur = 4;
                ctx.fillText(tile.label, center.x, center.y);
                ctx.restore();
            }
        });

        ctx.restore(); // 恢復包覆相機矩陣

        // 4. 繪製浮動質感圖例面板
        if (paletteEntries.length > 0) {
            const legendX = 24;
            const legendY = 24;
            const itemHeight = 24;
            const legendWidth = 240;
            const legendHeight = 44 + paletteEntries.length * itemHeight;

            ctx.fillStyle = "rgba(17, 24, 39, 0.92)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
            ctx.lineWidth = 1;

            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(legendX, legendY, legendWidth, legendHeight, 8);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
                ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);
            }

            const legendTitle = i18n.t("export_svg_legend_title");
            ctx.fillStyle = "#a5b4fc";
            ctx.font = "bold 12px Inter, sans-serif";
            ctx.textBaseline = "middle";
            ctx.fillText(legendTitle, legendX + 12, legendY + 18);

            ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
            ctx.beginPath();
            ctx.moveTo(legendX + 12, legendY + 30);
            ctx.lineTo(legendX + legendWidth - 12, legendY + 30);
            ctx.stroke();

            const legendBlock = i18n.t("export_svg_legend_block");
            const legendLine = i18n.t("export_svg_legend_line");

            paletteEntries.forEach((item, index) => {
                const itemY = legendY + 46 + index * itemHeight;

                ctx.fillStyle = item.color;
                ctx.fillRect(legendX + 14, itemY - 6, 12, 12);
                ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
                ctx.lineWidth = 0.5;
                ctx.strokeRect(legendX + 14, itemY - 6, 12, 12);

                ctx.fillStyle = "#64748b";
                ctx.font = "9px Inter, sans-serif";
                ctx.fillText(legendBlock, legendX + 29, itemY);

                ctx.strokeStyle = item.color;
                ctx.lineWidth = 3;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(legendX + 42, itemY);
                ctx.lineTo(legendX + 56, itemY);
                ctx.stroke();

                ctx.fillStyle = "#64748b";
                ctx.font = "9px Inter, sans-serif";
                ctx.fillText(legendLine, legendX + 60, itemY);

                ctx.fillStyle = "#e2e8f0";
                ctx.font = "11px Inter, sans-serif";
                ctx.fillText(item.name, legendX + 76, itemY);
            });
        }

        ctx.restore();

        // 5. 匯出 PNG 並下載
        const url = offCanvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = `${scheme.name}_blueprint_planboid.png`;
        a.click();
    }

    static desaturateHex(hex, factor = 0.7) {
        if (!hex || hex.length < 7) return "#64748b";
        let r = parseInt(hex.substring(1, 3), 16);
        let g = parseInt(hex.substring(3, 5), 16);
        let b = parseInt(hex.substring(5, 7), 16);

        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = Math.round(r + (gray - r) * factor);
        g = Math.round(g + (gray - g) * factor);
        b = Math.round(b + (gray - b) * factor);

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
}
