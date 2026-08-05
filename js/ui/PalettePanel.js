/**
 * PalettePanel.js - 通用調色盤 (支援拖曳排序、16進位 Hex 色碼輸入與零原生彈窗)
 */

import { i18n } from '../core/I18nManager.js';
import { StateManager } from '../core/StateManager.js';
import { ConfirmModal } from './ConfirmModal.js';

export class PalettePanel {
	/**
	 * @param {import("../core/StateManager.js").StateManager} stateManager
	 */
	constructor(stateManager) {
		this.state = stateManager;
		this.container = document.getElementById('palette-container');
		this.objectContainer = document.getElementById('object-palette-container');
		this.labelInput = document.getElementById('input-tile-label');
		this.tileInfoDisplay = document.getElementById('selected-tile-info');
		this.btnEnableSelect = document.getElementById('btn-enable-select');

		this.editModal = document.getElementById('modal-palette-edit');
		this.modalTitle = document.getElementById('palette-modal-title');
		this.editIdInput = document.getElementById('edit-palette-id');
		this.editNameInput = document.getElementById('edit-palette-name');
		this.editColorInput = document.getElementById('edit-palette-color');
		this.editHexInput = document.getElementById('edit-palette-hex');
		this.btnDeletePalette = document.getElementById('btn-delete-palette');

		this.draggedKey = null;
		this.isCreatingObject = false;

		this.init();
	}

	init() {
		this.renderPalette();
		this.initPresetSwatches();

		window.addEventListener('statechange', () => {
			this.renderPalette();
			this.updateSelectedTileInfo();
		});

		window.addEventListener('langchange', () => {
			this.renderPalette();
			this.updateSelectedTileInfo();
		});

		this.btnEnableSelect?.addEventListener('click', () => {
			this.state.toolState.setActiveTool('select');
			document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
			this.btnEnableSelect.classList.add('btn-primary');
			this.btnEnableSelect.classList.remove('btn-secondary');

			if (this.tileInfoDisplay) {
				this.tileInfoDisplay.textContent = i18n.t('sidebar_no_selected_tile');
			}
		});

		// 原生色彩選擇器與 16 進位文字輸入框雙向同步
		this.editColorInput?.addEventListener('input', (e) => {
			if (this.editHexInput) {
				this.editHexInput.value = e.target.value.toUpperCase();
			}
		});

		this.editHexInput?.addEventListener('input', (e) => {
			let val = e.target.value.trim();
			if (val && !val.startsWith('#')) val = '#' + val;
			if (/^#([0-9A-F]{3}){1,2}$/i.test(val)) {
				if (val.length === 4) {
					val = '#' + val[1] + val[1] + val[2] + val[2] + val[3] + val[3];
				}
				if (this.editColorInput) {
					this.editColorInput.value = val;
				}
			}
		});

		const btnAdd = document.getElementById('btn-add-palette');
		btnAdd?.addEventListener('click', () => {
			this.openAddModal(false);
		});

		const btnAddObj = document.getElementById('btn-add-object-palette');
		btnAddObj?.addEventListener('click', () => {
			this.openAddModal(true);
		});

		const btnSavePalette = document.getElementById('btn-save-palette');
		btnSavePalette?.addEventListener('click', () => {
			const id = this.editIdInput?.value || '';
			const name = this.editNameInput?.value?.trim() || i18n.t('modal_palette_name_placeholder');
			let color = this.editColorInput ? this.editColorInput.value : '#6366F1';

			if (this.editHexInput && this.editHexInput.value) {
				let hexVal = this.editHexInput.value.trim();
				if (!hexVal.startsWith('#')) hexVal = '#' + hexVal;
				if (/^#([0-9A-F]{3}){1,2}$/i.test(hexVal)) {
					if (hexVal.length === 4) {
						hexVal = '#' + hexVal[1] + hexVal[1] + hexVal[2] + hexVal[2] + hexVal[3] + hexVal[3];
					}
					color = hexVal;
				}
			}

			if (!id) {
				const newId = (this.isCreatingObject ? 'obj_' : 'color_') + Date.now();
				if (this.state.scheme?.palette) {
					this.state.scheme.palette[newId] = {
						color,
						name,
						...(this.isCreatingObject ? { isObject: true } : {}),
					};
				}
				this.state.activeColorId = newId;
				this.state.pushHistory();
				this.state.notifyStateChange();
			} else {
				this.state.updatePaletteItem(id, { name, color });
			}

			this.editModal?.close();
		});

		// 二次確認零原生彈窗刪除色塊
		this.btnDeletePalette?.addEventListener('click', async () => {
			const id = this.editIdInput?.value;
			if (id) {
				const confirmed = await ConfirmModal.show(i18n.t('modal_palette_confirm_delete'));
				if (confirmed) {
					this.state.deletePaletteItem(id);
					this.editModal?.close();
				}
			}
		});

		const btnClosePaletteModal = document.getElementById('btn-close-palette-modal');
		btnClosePaletteModal?.addEventListener('click', () => {
			this.editModal?.close();
		});

		this.editModal?.addEventListener('click', (e) => {
			if (e.target === this.editModal) {
				this.editModal.close();
			}
		});

		this.labelInput?.addEventListener('input', (e) => {
			if (this.state.selectedCell) {
				const { x, y } = this.state.selectedCell;
				this.state.setTileLabel(x, y, e.target.value);
			}
		});
	}

	initPresetSwatches() {
		const presetContainer = document.getElementById('preset-color-swatches');
		if (!presetContainer) return;

		const presets = [
			'#334155', // Slate 700
			'#64748b', // Slate 500
			'#94a3b8', // Slate 400
			'#f8fafc', // White / Slate 50
			'#e11d48', // Rose 600
			'#ea580c', // Orange 600
			'#d97706', // Amber 600
			'#ca8a04', // Yellow 600
			'#65a30d', // Lime 600
			'#16a34a', // Green 600
			'#0d9488', // Teal 600
			'#0284c7', // Sky 600
			'#2563eb', // Blue 600
			'#4f46e5', // Indigo 600
			'#7c3aed', // Violet 600
			'#c026d3', // Fuchsia 600
		];
		presetContainer.innerHTML = '';
		presets.forEach(color => {
			const btn = document.createElement('div');
			btn.className = 'preset-swatch-item';
			btn.style.backgroundColor = color;
			btn.addEventListener('click', () => {
				if (this.editColorInput) {
					this.editColorInput.value = color;
				}
				if (this.editHexInput) {
					this.editHexInput.value = color.toUpperCase();
				}
			});
			presetContainer.appendChild(btn);
		});
	}

	updateSelectedTileInfo() {
		if (this.state.activeTool !== 'select' && this.btnEnableSelect) {
			this.btnEnableSelect.classList.remove('btn-primary');
			this.btnEnableSelect.classList.add('btn-secondary');
		}

		if (!this.state.selectedCell) {
			if (this.tileInfoDisplay && this.state.activeTool !== 'select') {
				this.tileInfoDisplay.textContent = i18n.t('sidebar_no_selected_tile');
			}
			if (this.labelInput) {
				this.labelInput.value = '';
				this.labelInput.disabled = true;
			}
			return;
		}

		const { x, y } = this.state.selectedCell;
		const z = this.state.currentZLevel;
		const key = `${x},${y},${z}`;
		const tile = this.state.scheme.tiles[key];

		if (this.tileInfoDisplay) {
			const displayZ = StateManager.toDisplayZ(z);
			this.tileInfoDisplay.textContent = i18n.t('sidebar_selected_tile_coords', { x: x + 1, y: y + 1, z: displayZ });
		}

		if (this.labelInput) {
			this.labelInput.disabled = false;
			this.labelInput.value = (tile && tile.label) ? tile.label : '';
		}
	}

	renderPalette() {
		if (!this.container) return;
		this.container.innerHTML = '';
		if (this.objectContainer) this.objectContainer.innerHTML = '';

		const palette = this.state.scheme.palette;
		const keys = Object.keys(palette);

		if ((!this.state.activeColorId || !palette[this.state.activeColorId]) && keys.length > 0) {
			this.state.activeColorId = keys[0];
		}

		const normalItems = Object.entries(palette).filter(([, item]) => !item.isObject);
		const objectItems = Object.entries(palette).filter(([, item]) => !!item.isObject);

		const renderGroup = (items, targetContainer) => {
			if (!targetContainer) return;
			items.forEach(([id, item]) => {
				const isSelected = id === this.state.activeColorId;
				const div = document.createElement('div');
				div.className = `palette-item ${isSelected ? 'active' : ''}`;
				div.setAttribute('draggable', 'true');
				div.dataset.id = id;

				const swatch = document.createElement('div');
				swatch.className = 'palette-swatch';
				swatch.style.backgroundColor = item.color;

				const name = document.createElement('span');
				name.className = 'palette-name';
				name.textContent = item.name;

				const btnEdit = document.createElement('button');
				btnEdit.className = 'btn-palette-edit';
				btnEdit.textContent = '✏️';
				btnEdit.title = i18n.t('modal_palette_title_edit');
				btnEdit.addEventListener('click', (e) => {
					e.stopPropagation();
					this.openEditModal(id, item);
				});

				div.appendChild(swatch);
				div.appendChild(name);
				div.appendChild(btnEdit);

				// 拖曳事件綁定
				div.addEventListener('dragstart', (e) => {
					this.draggedKey = id;
					div.classList.add('dragging');
					e.dataTransfer.effectAllowed = 'move';
				});

				div.addEventListener('dragover', (e) => {
					e.preventDefault();
					if (this.draggedKey && this.draggedKey !== id) {
						div.classList.add('drag-over');
					}
				});

				div.addEventListener('dragleave', () => {
					div.classList.remove('drag-over');
				});

				div.addEventListener('drop', (e) => {
					e.preventDefault();
					div.classList.remove('drag-over');
					if (this.draggedKey && this.draggedKey !== id) {
						this.reorderPalette(this.draggedKey, id);
					}
				});

				div.addEventListener('dragend', () => {
					div.classList.remove('dragging');
					document.querySelectorAll('.palette-item').forEach(el => el.classList.remove('drag-over'));
					this.draggedKey = null;
				});

				div.addEventListener('click', () => {
					this.state.activeColorId = id;
					if (this.state.activeTool === 'select') {
						this.state.toolState.setActiveTool('pencil');
						this.state.toolState.setBrushType(item.isObject ? 'wall' : 'floor');
						document.getElementById('tool-floor')?.classList.add('active');
					}
					this.renderPalette();
				});

				targetContainer.appendChild(div);
			});
		};

		renderGroup(normalItems, this.container);
		renderGroup(objectItems, this.objectContainer || this.container);
	}

	reorderPalette(sourceId, targetId) {
		const palette = this.state.scheme?.palette;
		if (!palette) return;
		const keys = Object.keys(palette);
		const sourceIndex = keys.indexOf(sourceId);
		const targetIndex = keys.indexOf(targetId);

		if (sourceIndex === -1 || targetIndex === -1) return;

		keys.splice(sourceIndex, 1);
		keys.splice(targetIndex, 0, sourceId);

		const newPalette = {};
		keys.forEach(k => {
			newPalette[k] = palette[k];
		});

		this.state.scheme.palette = newPalette;
		this.state.pushHistory();
		this.state.notifyStateChange();
	}

	openAddModal(isObject = false) {
		this.isCreatingObject = !!isObject;
		if (!this.editModal) return;
		if (this.modalTitle) {
			this.modalTitle.textContent = this.isCreatingObject
				? i18n.t('sidebar_btn_add_object_palette')
				: i18n.t('modal_palette_title_add');
		}
		if (this.editIdInput) this.editIdInput.value = '';
		if (this.editNameInput) this.editNameInput.value = '';
		const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
		if (this.editColorInput) this.editColorInput.value = randomColor;
		if (this.editHexInput) this.editHexInput.value = randomColor;

		const btnConvert = document.getElementById('btn-convert-palette-type');
		if (btnConvert) btnConvert.style.display = 'none';

		if (this.btnDeletePalette) this.btnDeletePalette.style.display = 'none';
		this.editModal.showModal();
	}

	openEditModal(id, item) {
		if (!this.editModal) return;
		if (this.modalTitle) this.modalTitle.textContent = i18n.t('modal_palette_title_edit');
		if (this.editIdInput) this.editIdInput.value = id;
		if (this.editNameInput) this.editNameInput.value = item.name;
		const colorVal = item.color || '#6366F1';
		if (this.editColorInput) this.editColorInput.value = colorVal;
		if (this.editHexInput) this.editHexInput.value = colorVal.toUpperCase();

		const btnConvert = document.getElementById('btn-convert-palette-type');
		if (btnConvert && btnConvert.parentNode) {
			btnConvert.style.display = 'inline-flex';
			const isObj = !!item.isObject;
			btnConvert.textContent = isObj
				? i18n.t('modal_palette_btn_convert_to_normal')
				: i18n.t('modal_palette_btn_convert_to_object');

			// 替換綁定監聯
			const newBtn = btnConvert.cloneNode(true);
			btnConvert.parentNode.replaceChild(newBtn, btnConvert);
			newBtn.addEventListener('click', async () => {
				if (!isObj) {
					this.state.convertPaletteItemType(id, true);
				} else {
					const confirmed = await ConfirmModal.show(i18n.t('modal_palette_confirm_convert'));
					if (confirmed) {
						this.state.convertPaletteItemType(id, false);
					}
				}
				this.editModal?.close();
			});
		}

		if (this.btnDeletePalette) this.btnDeletePalette.style.display = 'inline-flex';
		this.editModal.showModal();
	}
}
