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
					this.state.toolState.setActiveTool('pencil');
					this.state.toolState.setBrushType('floor');
				} else if (tool === 'wall') {
					this.state.toolState.setActiveTool('pencil');
					this.state.toolState.setBrushType('wall');
				} else if (tool === 'erase-floor') {
					this.state.toolState.setActiveTool('erase-floor');
					this.state.toolState.setBrushType('floor');
				} else if (tool === 'erase-wall') {
					this.state.toolState.setActiveTool('erase-wall');
					this.state.toolState.setBrushType('wall');
				} else if (tool === 'select') {
					this.state.toolState.setActiveTool('select');
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

		const cycleOtherFloors = (e) => {
			const modes = ['hidden', 'ghost', 'solid'];
			const currentMode = this.state.otherFloorsMode || 'ghost';
			let idx = modes.indexOf(currentMode);
			if (idx === -1) idx = 1;
			const nextIdx = e.shiftKey ? (idx - 1 + modes.length) % modes.length : (idx + 1) % modes.length;
			this.state.setOtherFloorsMode(modes[nextIdx]);
			syncOtherFloorsUI();
			this.state.notifyStateChange();
		};

		const toggle3DWalls = (key) => {
			if (!chk3DWalls) return;
			if (key === 'home' && !chk3DWalls.checked) {
				chk3DWalls.checked = true;
				chk3DWalls.dispatchEvent(new Event('change'));
			} else if (key === 'end' && chk3DWalls.checked) {
				chk3DWalls.checked = false;
				chk3DWalls.dispatchEvent(new Event('change'));
			}
		};

		const formatHotkeyText = (i18nKey, displayKey) => {
			const label = i18n.t(i18nKey);
			if (!displayKey) return label;
			const wrapper = i18n.t('parenthesis_wrapper') || ' ({val})';
			return `${label}${wrapper.replace('{val}', displayKey)}`;
		};

		const HOTKEY_REGISTRY = [
			{ id: 'floor', keys: ['1'], i18nKey: 'toolbar_tool_floor', displayKey: '1', clickId: 'tool-floor' },
			{ id: 'wall', keys: ['2'], i18nKey: 'toolbar_tool_wall', displayKey: '2', clickId: 'tool-wall' },
			{ id: 'erase_floor', keys: ['3'], i18nKey: 'toolbar_tool_erase_floor', displayKey: '3', clickId: 'tool-erase-floor' },
			{ id: 'erase_wall', keys: ['4'], i18nKey: 'toolbar_tool_erase_wall', displayKey: '4', clickId: 'tool-erase-wall' },
			{ id: 'select', keys: ['5'], i18nKey: 'toolbar_tool_select', displayKey: '5', clickId: 'tool-select' },
			{ id: 'floor_up', keys: ['z', 'pageup'], i18nKey: 'sidebar_floor_up_title', displayKey: 'Z / Page Up', clickId: 'floor-up' },
			{ id: 'floor_down', keys: ['x', 'pagedown'], i18nKey: 'sidebar_floor_down_title', displayKey: 'X / Page Down', clickId: 'floor-down' },
			{ id: 'other_floors', keys: ['f'], i18nKey: 'sidebar_other_floors_label', displayKey: 'F', action: (e) => cycleOtherFloors(e) },
			{ id: 'undo', keys: ['ctrl+z'], i18nKey: 'toolbar_btn_undo_title', displayKey: 'Ctrl+Z', action: () => this.state.undo() },
			{ id: 'redo', keys: ['ctrl+y', 'ctrl+shift+z'], i18nKey: 'toolbar_btn_redo_title', displayKey: 'Ctrl+Y', action: () => this.state.redo() },
			{ id: 'cancel', keys: ['escape', 'esc'], i18nKey: 'toolbar_btn_cancel_op_title', displayKey: 'Esc', action: () => this.renderer?.dispatcher?.cancelActiveOperation() },
			{ id: 'toggle_3d', keys: ['home', 'end'], i18nKey: 'viewport_toggle_3d_walls_title', displayKey: 'Home / End', action: (e, key) => toggle3DWalls(key) },
		];

		const hotkeyLegend = document.getElementById('canvas-hotkey-legend');
		const updateHotkeyLegend = () => {
			if (!hotkeyLegend) return;
			hotkeyLegend.textContent = HOTKEY_REGISTRY
				.map(item => formatHotkeyText(item.i18nKey, item.displayKey))
				.join('\n');
		};

		window.addEventListener('langchange', updateHotkeyLegend);
		updateHotkeyLegend();

		const btnUndo = document.getElementById('btn-undo');
		const btnRedo = document.getElementById('btn-redo');

		btnUndo?.addEventListener('click', () => this.state.undo());
		btnRedo?.addEventListener('click', () => this.state.redo());

		window.addEventListener('keydown', (e) => {
			if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;

			const key = e.key.toLowerCase();
			const isCtrl = e.ctrlKey || e.metaKey;
			const isShift = e.shiftKey;
			const isAlt = e.altKey;

			// R 鍵特別處理：旋轉/切換子物件選取
			if (key === 'r' && !isCtrl && !isAlt) {
				e.preventDefault();
				this.state.cycleSelectedSubTarget();
				return;
			}

			// C / V 複製貼上
			if (isCtrl) {
				if (key === 'c') {
					e.preventDefault();
					if (this.state.copySelection()) {
						ToastNotification.show(i18n.t('export_copy_clipboard_success'));
					}
					return;
				} else if (key === 'v') {
					e.preventDefault();
					if (this.state.clipboard) {
						this.state.isPastingMode = true;
						this.state.notifyStateChange();
					}
					return;
				}
			}

			// Delete / Backspace 刪除選區內容
			if (key === 'delete' || key === 'backspace') {
				if (this.state.deleteSelection()) {
					e.preventDefault();
				}
				return;
			}

			// 表驅動 (Table-Driven) 匹配 HOTKEY_REGISTRY
			const matched = HOTKEY_REGISTRY.find(item => {
				return item.keys.some(k => {
					if (k === 'ctrl+z') return isCtrl && !isShift && key === 'z';
					if (k === 'ctrl+shift+z') return isCtrl && isShift && key === 'z';
					if (k === 'ctrl+y') return isCtrl && key === 'y';
					return !isCtrl && !isAlt && key === k;
				});
			});

			if (matched) {
				e.preventDefault();
				if (matched.clickId) {
					document.getElementById(matched.clickId)?.click();
				} else if (matched.action) {
					matched.action(e, key);
				}
			}
		});
	}
}
