/**
 * Toolbar.js - 工具列、圖檔雙匯出與全套剪貼簿快捷鍵 (平鋪 i18n 整合)
 */

import { i18n } from '../core/I18nManager.js';
import { StateManager } from '../core/StateManager.js';
import { PngExporter } from '../renderer/PngExporter.js';
import { SvgExporter } from '../renderer/SvgExporter.js';
import { ToastNotification } from './ToastNotification.js';

export class Toolbar {
	/**
	 * @param {import("../core/StateManager.js").StateManager} stateManager
	 * @param {import("../renderer/CanvasRenderer.js").CanvasRenderer} [renderer]
	 */
	constructor(stateManager, renderer) {
		this.state = stateManager;
		this.renderer = renderer;
		this.init();
	}

	init() {
		const toolButtons = document.querySelectorAll('.tool-btn');
		toolButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				toolButtons.forEach(b => b.classList.remove('active'));
				btn.classList.add('active');

				const tool = btn.dataset.tool;

				if (tool === 'floor') {
					this.state.activeTool = 'pencil';
					this.state.brushType = 'floor';
				} else if (tool === 'wall') {
					this.state.activeTool = 'pencil';
					this.state.brushType = 'wall';
				} else if (tool === 'erase-floor') {
					this.state.activeTool = 'erase-floor';
					this.state.brushType = 'floor';
				} else if (tool === 'erase-wall') {
					this.state.activeTool = 'erase-wall';
					this.state.brushType = 'wall';
				} else if (tool === 'select') {
					this.state.activeTool = 'select';
				}

				if (tool !== 'select') {
					this.state.selectedCell = null;
					this.state.selectionBox = null;
				}

				this.state.notifyStateChange();
			});
		});

		const btnSvg = document.getElementById('btn-export-svg');
		const btnPng = document.getElementById('btn-export-png');

		btnSvg?.addEventListener('click', () => {
			SvgExporter.exportToSvg(this.state);
		});

		btnPng?.addEventListener('click', () => {
			PngExporter.exportToPng(this.state, this.renderer);
		});

		const chk3DWalls = document.getElementById('chk-3d-walls');
		chk3DWalls?.addEventListener('change', (e) => {
			this.state.is3DWallsEnabled = e.target.checked;
			this.state.notifyStateChange();
		});

		const btnFloorUp = document.getElementById('floor-up');
		const btnFloorDown = document.getElementById('floor-down');
		const displayFloor = document.getElementById('current-floor-display');
		const chkGhost = document.getElementById('chk-ghost-layer');

		const updateFloorDisplay = () => {
			if (displayFloor) {
				displayFloor.textContent = StateManager.toDisplayZ(this.state.currentZLevel);
			}
		};

		btnFloorUp?.addEventListener('click', () => {
			this.state.setZLevel(this.state.currentZLevel + 1);
			updateFloorDisplay();
		});

		btnFloorDown?.addEventListener('click', () => {
			this.state.setZLevel(this.state.currentZLevel - 1);
			updateFloorDisplay();
		});

		const otherFloorsBtns = document.querySelectorAll('#other-floors-group .btn-segmented');
		const syncOtherFloorsUI = () => {
			const currentMode = this.state.otherFloorsMode || 'ghost';
			otherFloorsBtns.forEach(btn => {
				if (btn.dataset.mode === currentMode) {
					btn.classList.add('active');
				} else {
					btn.classList.remove('active');
				}
			});
		};

		otherFloorsBtns.forEach(btn => {
			btn.addEventListener('click', () => {
				const mode = btn.dataset.mode;
				this.state.setOtherFloorsMode(mode);
				syncOtherFloorsUI();
				this.state.notifyStateChange();
			});
		});

		window.addEventListener('statechange', syncOtherFloorsUI);
		syncOtherFloorsUI();

		window.addEventListener('langchange', updateFloorDisplay);

		const hotkeyLegend = document.getElementById('canvas-hotkey-legend');
		const updateHotkeyLegend = () => {
			if (!hotkeyLegend) return;
			const keys = [
				'toolbar_tool_floor',
				'toolbar_tool_wall',
				'toolbar_tool_erase_floor',
				'toolbar_tool_erase_wall',
				'toolbar_tool_select',
				'sidebar_floor_up_title',
				'sidebar_floor_down_title',
				'toolbar_btn_undo_title',
				'toolbar_btn_redo_title',
				'toolbar_btn_cancel_op_title',
				'viewport_toggle_3d_walls_title',
			];
			hotkeyLegend.textContent = keys.map(key => i18n.t(key)).join('\n');
		};
		window.addEventListener('langchange', updateHotkeyLegend);
		updateHotkeyLegend();

		const btnUndo = document.getElementById('btn-undo');
		const btnRedo = document.getElementById('btn-redo');

		btnUndo?.addEventListener('click', () => this.state.undo());
		btnRedo?.addEventListener('click', () => this.state.redo());

		window.addEventListener('keydown', (e) => {
			if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;

			if (e.key === 'Escape' || e.key === 'Esc') {
				if (this.renderer?.dispatcher) {
					const canceled = this.renderer.dispatcher.cancelActiveOperation();
					if (canceled) {
						e.preventDefault();
					}
				}
				return;
			}

			if (e.ctrlKey || e.metaKey) {
				const key = e.key.toLowerCase();
				if (key === 'z') {
					e.preventDefault();
					if (e.shiftKey) this.state.redo();
					else this.state.undo();
				} else if (key === 'y') {
					e.preventDefault();
					this.state.redo();
				} else if (key === 'c') {
					e.preventDefault();
					if (this.state.copySelection()) {
						ToastNotification.show(i18n.t('export_copy_clipboard_success'));
					}
				} else if (key === 'v') {
					e.preventDefault();
					if (this.state.clipboard) {
						this.state.isPastingMode = true;
						this.state.notifyStateChange();
					}
				}
			} else if (e.key === 'Delete' || e.key === 'Backspace') {
				if (this.state.deleteSelection()) {
					e.preventDefault();
				}
			} else if (e.key === 'PageUp' || e.key.toLowerCase() === 'z') {
				e.preventDefault();
				btnFloorUp?.click();
			} else if (e.key === 'PageDown' || e.key.toLowerCase() === 'x') {
				e.preventDefault();
				btnFloorDown?.click();
			} else if (e.key === 'Home') {
				e.preventDefault();
				if (chk3DWalls && !chk3DWalls.checked) {
					chk3DWalls.checked = true;
					chk3DWalls.dispatchEvent(new Event('change'));
				}
			} else if (e.key === 'End') {
				e.preventDefault();
				if (chk3DWalls && chk3DWalls.checked) {
					chk3DWalls.checked = false;
					chk3DWalls.dispatchEvent(new Event('change'));
				}
			} else if (e.key === '1') {
				e.preventDefault();
				document.getElementById('tool-floor')?.click();
			} else if (e.key === '2') {
				e.preventDefault();
				document.getElementById('tool-wall')?.click();
			} else if (e.key === '3') {
				e.preventDefault();
				document.getElementById('tool-erase-floor')?.click();
			} else if (e.key === '4') {
				e.preventDefault();
				document.getElementById('tool-erase-wall')?.click();
			} else if (e.key === '5') {
				e.preventDefault();
				document.getElementById('tool-select')?.click();
			}
		});
	}
}
