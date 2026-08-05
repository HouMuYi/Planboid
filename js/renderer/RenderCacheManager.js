export class RenderCacheManager {
	constructor() {
		// key: z 樓層, value: { base: <canvas>, label: <canvas>, dirty: boolean }
		this.caches = new Map();
		this.isEnabled = true;
	}

	/**
	 * 更新全域畫布尺寸並使所有快取失效 (不再需要存 viewport)
	 */
	resize(width, height) {
		this.invalidateAll();
	}

	/**
	 * 標記所有快取失效 (需要重繪)
	 */
	invalidateAll() {
		this.caches.forEach(cache => {
			cache.dirty = true;
		});
	}

	/**
	 * 清除並銷毀所有快取
	 */
	clear() {
		this.caches.clear();
	}

	/**
	 * 取得指定樓層的快取，若不存在或已失效則會建立
	 * @param {number} z 樓層高度
	 * @param {boolean} isCurrent 是否為當前樓層 (決定文字是否渲染)
	 * @param {number} width 畫布寬度
	 * @param {number} height 畫布高度
	 * @param {Function} renderCallback 提供繪製邏輯的回呼函數 renderCallback(baseCtx, labelCtx)
	 * @returns {{ base: HTMLCanvasElement, label: HTMLCanvasElement }}
	 */
	getOrCreateCache(z, isCurrent, width, height, renderCallback) {
		let cache = this.caches.get(z);
		
		// 若快取不存在，或尺寸已改變，重建
		if (!cache || cache.base.width !== width || cache.base.height !== height) {
			cache = {
				base: this._createOffscreenCanvas(width, height),
				label: this._createOffscreenCanvas(width, height),
				dirty: true,
			};
			this.caches.set(z, cache);
		}

		if (cache.dirty) {
			const baseCtx = cache.base.getContext('2d');
			const labelCtx = cache.label.getContext('2d');

			// 重置變換矩陣，防止每次重繪時 translate 累加造成畫面位移
			baseCtx.setTransform(1, 0, 0, 1, 0, 0);
			labelCtx.setTransform(1, 0, 0, 1, 0, 0);

			// 清除舊畫面 (透明背景)
			baseCtx.clearRect(0, 0, width, height);
			labelCtx.clearRect(0, 0, width, height);

			// 執行外部傳入的實際渲染邏輯 ( GeometryPipeline.traverseLayerPasses )
			renderCallback(baseCtx, labelCtx);

			cache.dirty = false;
		}

		return cache;
	}

	/**
	 * 取得 2D 正交模式下的純地塊層快照 (專供 2D/3D 視角切換過渡動畫時做 GPU 仿射變換拉伸)
	 */
	getOrCreateFloor2DCache(z, width, height, renderCallback) {
		let cacheKey = `floor2d_${z}`;
		let cache = this.caches.get(cacheKey);

		if (!cache || cache.canvas.width !== width || cache.canvas.height !== height) {
			cache = {
				canvas: this._createOffscreenCanvas(width, height),
				dirty: true,
			};
			this.caches.set(cacheKey, cache);
		}

		if (cache.dirty) {
			const ctx = cache.canvas.getContext('2d');
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, width, height);
			renderCallback(ctx);
			cache.dirty = false;
		}

		return cache;
	}

	_createOffscreenCanvas(width, height) {
		// 優先使用 OffscreenCanvas 以獲得最佳效能，若不支援則降級至隱藏的 DOM Canvas
		if (typeof OffscreenCanvas !== 'undefined') {
			return new OffscreenCanvas(width, height);
		}
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
}
