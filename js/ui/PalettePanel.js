/**
 * PalettePanel.js - 圖層色票面板 (支援拖曳排序與 16 進位色碼輸入)
 */

import { CONFIG } from '../core/Config.js';
import { eventBus, EVENTS } from '../core/EventBus.js';
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
		this.zoneContainer = document.getElementById('zone-palette-container');

		this.editModal = document.getElementById('modal-palette-edit');
		this.modalTitle = document.getElementById('palette-modal-title');
		this.editIdInput = document.getElementById('edit-palette-id');
		this.editNameInput = document.getElementById('edit-palette-name');
		this.editColorInput = document.getElementById('edit-palette-color');
		this.editHexInput = document.getElementById('edit-palette-hex');
		this.btnDeletePalette = document.getElementById('btn-delete-palette');
		this.editHalfWallInput = document.getElementById('edit-palette-half-wall');
		this.halfWallRow = document.getElementById('palette-half-wall-row');

		this.draggedKey = null;
		this.creatingType = 'floor'; // 'floor' | 'object' | 'zone'

		this.init();
	}

	init() {
		this.renderPalette();
		this.initPresetSwatches();

		eventBus.on(EVENTS.STATE_CHANGED, () => {
			this.renderPalette();
		});

		eventBus.on(EVENTS.LANG_CHANGED, () => {
			this.renderPalette();
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
			this.openAddModal('floor');
		});

		const btnAddObj = document.getElementById('btn-add-object-palette');
		btnAddObj?.addEventListener('click', () => {
			this.openAddModal('object');
		});

		const btnAddZone = document.getElementById('btn-add-zone-palette');
		btnAddZone?.addEventListener('click', () => {
			this.openAddModal('zone');
		});

		const btnSavePalette = document.getElementById('btn-save-palette');
		btnSavePalette?.addEventListener('click', () => {
			const id = this.editIdInput?.value || '';
			let name = this.editNameInput?.value?.trim() || '';
			if (!name) {
				const palette = this.state.scheme?.palette || {};
				let type = this.creatingType;
				if (id) {
					const item = palette[id];
					if (item?.isZone) type = 'zone';
					else if (item?.isObject) type = 'object';
					else type = 'floor';
				}
				const sameTypeCount = Object.values(palette).filter(item => {
					if (type === 'zone') return !!item.isZone;
					if (type === 'object') return !!item.isObject && !item.isZone;
					return !item.isObject && !item.isZone;
				}).length;
				const nextNum = id ? sameTypeCount : sameTypeCount + 1;
				const keyMap = {
					zone: 'palette_default_zone_name',
					object: 'palette_default_object_name',
					floor: 'palette_default_color_name',
				};
				name = i18n.t(keyMap[type], { num: Math.max(1, nextNum) });
			}
			let color = this.editColorInput ? this.editColorInput.value : CONFIG.DEFAULT_PALETTE_COLOR;

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

			const isHalfWall = this.editHalfWallInput ? this.editHalfWallInput.checked : false;
			if (!id) {
				this.state.addPaletteItem({
					name,
					color,
					isObject: this.creatingType === 'object',
					isZone: this.creatingType === 'zone',
					isHalfWall,
				});
			} else {
				this.state.updatePaletteItem(id, { name, color, isHalfWall });
			}

			this.editModal?.close();
		});

		// 彈窗確認刪除色票
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
	}

	initPresetSwatches() {
		const presetContainer = document.getElementById('preset-color-swatches');
		if (!presetContainer) return;

		presetContainer.innerHTML = '';
		CONFIG.PRESET_SWATCHES.forEach(color => {
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

	/**
	 * 統計當前方案各色票於地圖中的實體使用數量（包含地塊、邊線與各層物件）
	 * @returns {Record<string, number>}
	 */
	getPaletteUsageCounts() {
		return StateManager.getPaletteUsageCounts(this.state.scheme);
	}

	renderPalette() {
		if (!this.container) return;
		this.container.innerHTML = '';
		if (this.objectContainer) this.objectContainer.innerHTML = '';
		if (this.zoneContainer) this.zoneContainer.innerHTML = '';

		const palette = this.state.scheme.palette;
		const keys = Object.keys(palette);

		if ((!this.state.activeColorId || !palette[this.state.activeColorId]) && keys.length > 0) {
			this.state.activeColorId = keys[0];
		}

		const counts = this.getPaletteUsageCounts();
		const wrapper = i18n.t('parenthesis_wrapper') || ' ({val})';

		const normalItems = Object.entries(palette).filter(([, item]) => !item.isObject && !item.isZone);
		const objectItems = Object.entries(palette).filter(([, item]) => !!item.isObject && !item.isZone);
		const zoneItems = Object.entries(palette).filter(([, item]) => !!item.isZone);

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
				const count = counts[id] || 0;
				const countSuffix = wrapper.replace('{val}', count);
				name.textContent = `${item.name}${countSuffix}`;

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
					}
					this.state.notifyStateChange();
					this.renderPalette();
				});

				targetContainer.appendChild(div);
			});
		};

		renderGroup(normalItems, this.container);
		renderGroup(objectItems, this.objectContainer || this.container);
		renderGroup(zoneItems, this.zoneContainer || this.container);
	}

	reorderPalette(sourceId, targetId) {
		this.state.reorderPalette(sourceId, targetId);
	}

	openAddModal(type = 'floor') {
		this.creatingType = type;
		if (!this.editModal) return;
		if (this.modalTitle) {
			const titleKey = type === 'zone'
				? 'modal_palette_title_add_zone'
				: (type === 'object' ? 'sidebar_btn_add_object_palette' : 'modal_palette_title_add');
			this.modalTitle.textContent = i18n.t(titleKey);
		}
		if (this.editIdInput) this.editIdInput.value = '';
		if (this.editNameInput) this.editNameInput.value = '';
		const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
		if (this.editColorInput) this.editColorInput.value = randomColor;
		if (this.editHexInput) this.editHexInput.value = randomColor;

		if (this.halfWallRow) {
			this.halfWallRow.style.display = type === 'floor' ? 'block' : 'none';
		}
		if (this.editHalfWallInput) {
			this.editHalfWallInput.checked = false;
		}

		const convertContainer = document.getElementById('palette-convert-actions');
		if (convertContainer) convertContainer.innerHTML = '';

		if (this.btnDeletePalette) this.btnDeletePalette.style.display = 'none';
		this.editModal.showModal();
	}

	openEditModal(id, item) {
		if (!this.editModal) return;
		if (this.modalTitle) this.modalTitle.textContent = i18n.t('modal_palette_title_edit');
		if (this.editIdInput) this.editIdInput.value = id;
		if (this.editNameInput) this.editNameInput.value = item.name;
		const colorVal = item.color || CONFIG.DEFAULT_PALETTE_COLOR;
		if (this.editColorInput) this.editColorInput.value = colorVal;
		if (this.editHexInput) this.editHexInput.value = colorVal.toUpperCase();

		const isNormal = !item.isZone && !item.isObject;
		if (this.halfWallRow) {
			this.halfWallRow.style.display = isNormal ? 'block' : 'none';
		}
		if (this.editHalfWallInput) {
			this.editHalfWallInput.checked = isNormal && !!item.isHalfWall;
		}

		const convertContainer = document.getElementById('palette-convert-actions');
		if (convertContainer) {
			convertContainer.innerHTML = '';
			const currentType = item.isZone ? 'zone' : (item.isObject ? 'object' : 'normal');
			const allTypes = [
				{ type: 'normal', labelKey: 'modal_palette_btn_convert_to_normal', defaultText: '轉為通用色票' },
				{ type: 'object', labelKey: 'modal_palette_btn_convert_to_object', defaultText: '轉為物件色票' },
				{ type: 'zone', labelKey: 'modal_palette_btn_convert_to_zone', defaultText: '轉為標籤色票' },
			];

			allTypes.filter(t => t.type !== currentType).forEach(target => {
				const btn = document.createElement('button');
				btn.className = 'btn btn-secondary';
				btn.textContent = i18n.t(target.labelKey) || target.defaultText;
				btn.addEventListener('click', async () => {
					if (target.type === 'normal') {
						const confirmed = await ConfirmModal.show(i18n.t('modal_palette_confirm_convert'));
						if (!confirmed) return;
					}
					this.state.convertPaletteItemType(id, target.type);
					this.editModal?.close();
				});
				convertContainer.appendChild(btn);
			});
		}

		if (this.btnDeletePalette) this.btnDeletePalette.style.display = 'flex';
		this.editModal.showModal();
	}
}
