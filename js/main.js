/**
 * main.js - ES Modules 主入口點 (平鋪鍵多語言與選單)
 */

import { eventBus, EVENTS } from './core/EventBus.js';
import { i18n } from './core/I18nManager.js';
import { StateManager } from './core/StateManager.js';
import { TabSyncManager } from './core/TabSyncManager.js';
import { CanvasRenderer } from './renderer/CanvasRenderer.js';
import { AboutModal } from './ui/AboutModal.js';
import { PalettePanel } from './ui/PalettePanel.js';
import { SchemeModal } from './ui/SchemeModal.js';
import { Toolbar } from './ui/Toolbar.js';
import { TooltipManager } from './ui/TooltipManager.js';

document.addEventListener('DOMContentLoaded', () => {
	const stateManager = new StateManager();
	const tabSyncManager = new TabSyncManager(stateManager);
	const tooltipManager = new TooltipManager();

	const canvas = document.getElementById('main-canvas');
	const renderer = new CanvasRenderer(canvas, stateManager);

	const toolbar = new Toolbar(stateManager, renderer);
	const palettePanel = new PalettePanel(stateManager);
	const schemeModal = new SchemeModal(stateManager);
	const aboutModal = new AboutModal();

	const selectLang = document.getElementById('select-lang');
	if (selectLang) {
		selectLang.value = i18n.currentLang;
		selectLang.addEventListener('change', (e) => {
			i18n.setLanguage(e.target.value);
		});
	}

	i18n.updateDomTranslations();

	eventBus.on(EVENTS.LANG_CHANGED, () => {
		stateManager.notifyStateChange();
		schemeModal.updateHeaderInfo();
	});

	const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
	const mainSidebar = document.getElementById('main-sidebar');
	if (window.matchMedia('(max-width:1024px)').matches) mainSidebar?.classList.add('collapsed');
	renderer.updateHotkeyLegendPosition();

	btnToggleSidebar?.addEventListener('click', () => {
		mainSidebar?.classList.toggle('collapsed');
		renderer.updateHotkeyLegendPosition();
		setTimeout(() => {
			renderer.resize();
		}, 320);
	});

	const btnIso = document.getElementById('view-iso');
	const btnOrtho = document.getElementById('view-ortho');
	const btnFitView = document.getElementById('btn-fit-view');
	const btnResetView = document.getElementById('btn-reset-view');

	btnFitView?.addEventListener('click', () => {
		renderer.fitView();
	});

	btnIso?.addEventListener('click', () => {
		btnIso.classList.add('active');
		btnOrtho?.classList.remove('active');
		renderer.setViewMode('iso');
	});

	btnOrtho?.addEventListener('click', () => {
		btnOrtho.classList.add('active');
		btnIso?.classList.remove('active');
		renderer.setViewMode('ortho');
	});

	btnResetView?.addEventListener('click', () => {
		renderer.zoom = 1.0;
		renderer.centerCamera();
		renderer.requestRenderAll();
		eventBus.emit(EVENTS.ZOOM_CHANGED, { zoom: renderer.zoom });
	});

	const infoCoords = document.getElementById('info-coords');
	const infoDrag = document.getElementById('info-drag');
	const infoGameCoords = document.getElementById('info-game-coords');
	const infoZoom = document.getElementById('info-zoom');

	const handleGridHover = (detail) => {
		const { x, y, gameX, gameY, dragDim } = detail;
		const z = stateManager.currentZLevel;
		const displayZ = StateManager.toDisplayZ(z);
		if (infoCoords) {
			infoCoords.textContent = i18n.t('viewport_info_coords', { x, y, z: displayZ });
		}
		if (infoDrag) {
			if (dragDim) {
				infoDrag.textContent = i18n.t('viewport_info_drag_dim', { x: dragDim.x, y: dragDim.y });
				infoDrag.style.display = '';
			} else {
				infoDrag.textContent = '';
				infoDrag.style.display = 'none';
			}
		}
		if (infoGameCoords) {
			infoGameCoords.textContent = i18n.t('viewport_info_game_coords', { gameX, gameY });
		}
	};

	eventBus.on(EVENTS.GRID_HOVER, handleGridHover);

	eventBus.on(EVENTS.ZOOM_CHANGED, (detail) => {
		if (infoZoom) {
			infoZoom.textContent = i18n.t('viewport_info_zoom', { zoom: Math.round(detail.zoom * 100) });
		}
	});

	console.log('🚀 Planboid 線上地塊規劃器啟動成功！');
});
