/**
 * ToolModeState.js - UI 工具與筆刷模式瞬態 (UI Tool Transient State)
 * 隔離 activeTool, brushType, activeColorId 與視覺切換標記
 */

export class ToolModeState {
	constructor() {
		this.activeTool = 'pencil'; // "pencil" | "erase-floor" | "erase-wall" | "select"
		this.brushType = 'floor'; // "floor" | "wall"
		this.activeColorId = ''; // 目前選取的色塊 ID

		// 視覺與遊戲開關
		this.otherFloorsMode = 'ghost'; // "hidden" | "ghost" | "solid"
		this.visualOffsetEnabled = true;
		this.is3DWallsEnabled = true;
	}

	get ghostLayerEnabled() {
		return this.otherFloorsMode !== 'hidden';
	}

	set ghostLayerEnabled(val) {
		this.otherFloorsMode = val ? 'ghost' : 'hidden';
	}

	setOtherFloorsMode(mode) {
		if (['hidden', 'ghost', 'solid'].includes(mode)) {
			this.otherFloorsMode = mode;
		}
	}

	setActiveTool(tool) {
		if (['pencil', 'erase-floor', 'erase-wall', 'select'].includes(tool)) {
			this.activeTool = tool;
		}
	}

	setBrushType(type) {
		if (['floor', 'wall'].includes(type)) {
			this.brushType = type;
		}
	}

	setActiveColorId(colorId) {
		this.activeColorId = colorId;
	}
}
