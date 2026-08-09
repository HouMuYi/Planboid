/**
 * TabSyncManager.js - 多分頁實時同步與磁碟感知管理器 (BroadcastChannel + Storage Event)
 * 1. 透過 BroadcastChannel 實現同源多分頁之間零延遲畫布與狀態同步
 * 2. 透過 Storage Event 提供背景分頁休眠甦醒後的權威補償防線
 * 3. 內建 isRemoteSyncing 鎖，徹底切斷跨分頁循環寫入與死鎖
 */

import { ToastNotification } from '../ui/ToastNotification.js';
import { eventBus } from './EventBus.js';
import { I18nManager, i18n } from './I18nManager.js';
import { SchemeSerializer } from './SchemeSerializer.js';
import { StorageManager } from './StorageManager.js';

const CHANNEL_NAME = 'planboid_tab_sync';

export class TabSyncManager {
	/**
	 * @param {import("./StateManager.js").StateManager} stateManager
	 */
	constructor(stateManager) {
		this.state = stateManager;
		this.isRemoteSyncing = false;

		// 1. 初始化 BroadcastChannel
		if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
			try {
				this.channel = new BroadcastChannel(CHANNEL_NAME);
				this.channel.onmessage = (e) => this.handleBroadcastMessage(e);
			} catch (err) {
				console.warn('[TabSyncManager] BroadcastChannel 初始化失敗，退回單分頁模式:', err);
			}
		}

		// 2. 監聽本分頁的狀態變更，發送廣播給其他分頁
		this.bindLocalEvents();

		// 3. 備用防線：監聽 Storage Event (處理分頁休眠甦醒後的磁碟補償)
		this.bindStorageEvent();
	}

	/**
	 * 綁定本地 State 變更事件，將操作實時廣播給同源其他分頁
	 */
	bindLocalEvents() {
		eventBus.on('state:changed', (detail) => {
			// 若當前變更來自遠端同步，不二次發送廣播
			if (this.isRemoteSyncing) return;

			if (this.channel) {
				try {
					this.channel.postMessage({
						type: 'TAB_DATA_CHANGED',
						activeSchemeId: this.state.activeSchemeId,
						scheme: SchemeSerializer.serialize(this.state.scheme),
						timestamp: Date.now(),
					});
				} catch (err) {
					console.warn('[TabSyncManager] 發送廣播失敗:', err);
				}
			}
		});
	}

	/**
	 * 處理接收自其他分頁的即時廣播
	 * @param {MessageEvent} e
	 */
	handleBroadcastMessage(e) {
		if (!e.data || e.data.type !== 'TAB_DATA_CHANGED') return;

		const { activeSchemeId, scheme: remoteSchemeObj } = e.data;
		if (!remoteSchemeObj) return;

		const parsedScheme = SchemeSerializer.parse(remoteSchemeObj);
		if (!parsedScheme) return;

		this.isRemoteSyncing = true;
		try {
			// 更新或插入遠端方案
			const existingIdx = this.state.schemes.findIndex(s => s.id === parsedScheme.id);
			if (existingIdx !== -1) {
				this.state.schemes[existingIdx] = parsedScheme;
			} else {
				this.state.schemes.push(parsedScheme);
			}

			// 若目前正在編輯該方案，同步更新目前方案指針
			if (this.state.scheme.id === parsedScheme.id) {
				this.state.scheme = parsedScheme;
			}

			// 若遠端切換了當前方案，同步切換
			if (activeSchemeId && this.state.activeSchemeId !== activeSchemeId) {
				const target = this.state.schemes.find(s => s.id === activeSchemeId);
				if (target) {
					this.state.activeSchemeId = activeSchemeId;
					this.state.scheme = target;
					this.state.currentZLevel = target.currentLevel || 0;
				}
			}

			// 觸發畫布與 UI 重新渲染 (跳過再次 persist)
			eventBus.emit('state:changed', { type: 'remote_sync', state: this.state });
			window.dispatchEvent(new CustomEvent('statechange', { detail: { type: 'remote_sync', state: this.state } }));
		} finally {
			this.isRemoteSyncing = false;
		}
	}

	/**
	 * 綁定 Storage Event 防線 (處理背景分頁休眠甦醒後的權威同步)
	 */
	bindStorageEvent() {
		if (typeof window === 'undefined') return;

		window.addEventListener('storage', (e) => {
			// 僅在 planboid_data_v4 Key 被其他分頁修改時發動
			if (e.key !== 'planboid_data_v4' || !e.newValue) return;

			this.isRemoteSyncing = true;
			try {
				const refreshedData = StorageManager.loadData();
				if (refreshedData && Array.isArray(refreshedData.schemes) && refreshedData.schemes.length > 0) {
					this.state.schemes = refreshedData.schemes;
					this.state.activeSchemeId = refreshedData.activeSchemeId || refreshedData.schemes[0].id;
					this.state.scheme = this.state.schemes.find(s => s.id === this.state.activeSchemeId) || this.state.schemes[0];
					this.state.normalizeSchemeTiles(this.state.scheme);
					this.state.currentZLevel = this.state.scheme.currentLevel || 0;

					eventBus.emit('state:changed', { type: 'storage_sync', state: this.state });
					window.dispatchEvent(new CustomEvent('statechange', { detail: { type: 'storage_sync', state: this.state } }));

					ToastNotification.show(
						i18n.t('toast_tab_synced') || '已自動同步其他分頁的最新變更！',
						'info'
					);
				}
			} catch (err) {
				console.warn('[TabSyncManager] Storage 事件同步失敗:', err);
			} finally {
				this.isRemoteSyncing = false;
			}
		});
	}
}
