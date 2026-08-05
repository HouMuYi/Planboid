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
		} else {
			console.warn(`[ToolModeState] 無效的樓層顯示模式 "${mode}"，降級為 "ghost"`);
			this.otherFloorsMode = 'ghost';
		}
	}

	setActiveTool(tool) {
		// 相容 PalettePanel 等 UI 歷史別名 ("floor" / "wall" 自動切換為 pencil 筆刷並更新 brushType)
		if (tool === 'floor' || tool === 'wall') {
			this.brushType = tool;
			this.activeTool = 'pencil';
			return;
		}

		if (['pencil', 'erase-floor', 'erase-wall', 'select'].includes(tool)) {
			this.activeTool = tool;
		} else {
			console.warn(`[ToolModeState] 無效的工具模式 "${tool}"，降級為 "pencil"`);
			this.activeTool = 'pencil';
		}
	}

	setBrushType(type) {
		if (['floor', 'wall'].includes(type)) {
			this.brushType = type;
		} else {
			console.warn(`[ToolModeState] 無效的筆刷類型 "${type}"，降級為 "floor"`);
			this.brushType = 'floor';
		}
	}

	setActiveColorId(colorId) {
		this.activeColorId = typeof colorId === 'string' ? colorId : String(colorId || '');
	}

	reset() {
		this.activeTool = 'pencil';
		this.brushType = 'floor';
		this.activeColorId = '';
		this.otherFloorsMode = 'ghost';
		this.visualOffsetEnabled = true;
		this.is3DWallsEnabled = true;
	}
}
