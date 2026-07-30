/**
 * ToolModeState.js - UI 工具與筆刷模式瞬態 (UI Tool Transient State)
 * 隔離 activeTool, brushType, shapeMode, activeColorId 與視覺切換標記
 */

export class ToolModeState {
    constructor() {
        this.activeTool = "pencil";         // "pencil" | "erase-floor" | "erase-wall" | "select"
        this.shapeMode = "single";          // "single" | "line" | "box"
        this.brushType = "floor";           // "floor" | "wall"
        this.activeColorId = "";            // 目前選取的色塊 ID

        // 視覺與遊戲開關
        this.ghostLayerEnabled = true;
        this.visualOffsetEnabled = true;
        this.is3DWallsEnabled = true;
    }

    setActiveTool(tool) {
        if (["pencil", "erase-floor", "erase-wall", "select"].includes(tool)) {
            this.activeTool = tool;
        }
    }

    setShapeMode(shape) {
        if (["single", "line", "box"].includes(shape)) {
            this.shapeMode = shape;
        }
    }

    setBrushType(type) {
        if (["floor", "wall"].includes(type)) {
            this.brushType = type;
        }
    }

    setActiveColorId(colorId) {
        this.activeColorId = colorId;
    }
}
