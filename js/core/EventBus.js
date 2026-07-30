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
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /**
     * 解綁事件
     * @param {string} event 
     * @param {Function} callback 
     */
    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    /**
     * 發布事件
     * @param {string} event 
     * @param {any} data 
     */
    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(cb => {
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
