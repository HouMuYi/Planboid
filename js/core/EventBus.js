/**
 * EventBus.js - 輕量級全站領域事件匯流排 (Observer Pattern)
 * 用於 StateManager、UI 面板與 CanvasRenderer 之間的解耦事件通信
 */

class EventBus {
	constructor() {
		this.listeners = new Map();
	}

	/**
	 * 訂閱事件
	 * @param {string} event
	 * @param {Function} callback
	 * @returns {Function} 解綁函式
	 */
	on(event, callback) {
		if (typeof event !== 'string' || typeof callback !== 'function') {
			return () => {};
		}
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set());
		}
		this.listeners.get(event).add(callback);
		return () => this.off(event, callback);
	}

	/**
	 * 一次性訂閱事件
	 * @param {string} event
	 * @param {Function} callback
	 * @returns {Function} 解綁函式
	 */
	once(event, callback) {
		if (typeof event !== 'string' || typeof callback !== 'function') {
			return () => {};
		}
		const offFn = this.on(event, (...args) => {
			offFn();
			callback(...args);
		});
		return offFn;
	}

	/**
	 * 解綁事件 (若未傳入 callback 則清空該事件的所有監聽者)
	 * @param {string} event
	 * @param {Function} [callback]
	 */
	off(event, callback) {
		if (!this.listeners.has(event)) return;

		const set = this.listeners.get(event);
		if (typeof callback === 'function') {
			set.delete(callback);
		} else {
			set.clear();
		}

		if (set.size === 0) {
			this.listeners.delete(event);
		}
	}

	/**
	 * 清空指定事件或全站所有事件監聽者
	 * @param {string} [event]
	 */
	clear(event) {
		if (event) {
			this.listeners.delete(event);
		} else {
			this.listeners.clear();
		}
	}

	/**
	 * 發布事件 (使用淺拷貝陣列隔離觸發過程中的動態監聽變更)
	 * @param {string} event
	 * @param {any} data
	 */
	emit(event, data) {
		if (this.listeners.has(event)) {
			const callbacks = Array.from(this.listeners.get(event));
			callbacks.forEach(cb => {
				try {
					cb(data);
				} catch (err) {
					console.error(`[EventBus] Error in listener for event "${event}":`, err);
				}
			});
		}
	}
}

export const eventBus = new EventBus();
