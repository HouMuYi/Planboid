/**
 * Config.js - 專案全域魔術數字與環境常數配置
 */

export const CONFIG = Object.freeze({
	// PZ 幾何
	TILE_SIZE: 32, // 地塊預設基礎尺寸 (px)
	Z_VISUAL_OFFSET: 3, // 每層 Z 軸樓層視覺高程偏置係數

	// 視角與相機
	ZOOM_MIN: 0.2, // 最遠縮放倍率下限
	ZOOM_MAX: 5.0, // 最近縮放倍率上限
	ZOOM_WHEEL_FACTOR: 1.15, // 滑鼠滾輪縮放倍率 (上滾乘以該值，下滾除以該值)
	ZOOM_ANIMATION_FACTOR: 0.35, // 平滑縮放 Lerp 動畫內插因子
	TRANSITION_DURATION_MS: 500, // 2D/3D 視角切換動畫總耗時 (500ms)
	TRANSITION_FPS_LIMIT: 30, // 2D/3D 視角切換動畫插補幀率限制 (FPS)
	FIT_VIEW_PADDING: 1, // 畫面自動置中 (fitView) 時留白邊界 (格數)

	// 操作與邊緣判定
	EDGE_SNAP_MIN: 0.25, // 網格內判定牆面邊緣吸附下限 (25%)
	EDGE_SNAP_MAX: 0.75, // 網格內判定牆面邊緣吸附上限 (75%)

	// 領域與狀態限制
	SCHEMA_VERSION: 5, // 全站當前大一統架構版本號 (v5)
	HISTORY_MAX_STEPS: 30, // Undo / Redo 歷史紀錄最大步數
	TOAST_DURATION_MS: 5000, // Toast 浮動提示預設顯示時間 (ms)
	TOAST_MAX_COUNT: 5, // Toast 浮動提示最大同時顯示數量
	SCHEME_SIZE_MIN: 10, // 方案寬度與高度最小網格限制
	SCHEME_SIZE_MAX: 300, // 方案寬度與高度最大網格限制
	Z_LEVEL_MIN: -17, // 最底層 Z 軸樓層限制
	Z_LEVEL_MAX: 29, // 最高層 Z 軸樓層限制
	DEFAULT_SCHEME_WIDTH: 32, // 新增預設方案網格寬度
	DEFAULT_SCHEME_HEIGHT: 32, // 新增預設方案網格高度
	DEFAULT_ORIGIN_X: 10500, // 新增預設方案地圖 X 世界座標
	DEFAULT_ORIGIN_Y: 9200, // 新增預設方案地圖 Y 世界座標

	// 視覺與顏色
	COLOR_BG: '#0b0f19', // 底層 Canvas 純黑主背景色
	COLOR_GRID_NORMAL: 'rgba(255, 255, 255, 0.08)', // 畫布輔助網格線顏色
	COLOR_GRID_BOUNDS: 'rgba(99, 102, 241, 0.5)', // 地塊外框邊界網格線顏色
	WALL_FILL_ALPHA: 0.6, // 3D 牆面面片基礎不透明度
	// 鬼影層配置
	GHOST_BASE_ALPHA: 0.4, // 相隔 1 層鬼影之基礎不透明度
	GHOST_ALPHA_DECAY: 0.75, // 鬼影跨層不透明度衰減率 (每多相隔 1 層)
	GHOST_SATURATION_DECAY: 0.8, // 鬼影跨層彩度/飽和度留存率 (每多相隔 1 層)

	// 物件色票與標籤統一視覺配置
	OBJECT_PANEL_BG: 'rgba(15, 23, 42, 0.15)', // 物件面板半透明背景色
	OBJECT_TEXT_COLOR: '#000000', // 物件文字主要填充顏色
	OBJECT_STROKE_COLOR: '#ffffff', // 物件文字描邊/白邊顏色
	OBJECT_STROKE_WIDTH: 1, // 物件文字描邊/白邊粗細 (px)
	OBJECT_FONT_RATIO: 0.4, // 物件文字大小相對於面板尺寸之比例
	OBJECT_FONT_MIN: 8, // 物件文字小尺寸保底下限 (px)

	// 全站標準字型
	FONT_SANS: '"Noto Sans TC", -apple-system, system-ui, sans-serif',
	FONT_SERIF: '"Noto Serif TC", -apple-system, serif',
	FONT_MONO: '"Ubuntu Mono", Consolas, Menlo, Monaco, "Noto Sans TC", -apple-system, system-ui, monospace',

	// 預設調色盤項目清單（包含一般色塊、物件色票與區域標籤基礎定義）
	DEFAULT_PALETTE_ITEMS: [
		{ id: 'color_road', color: '#334155', nameKey: 'defaults_palette_road', defaultName: '道路' },
		{ id: 'color_indoor', color: '#B38147', nameKey: 'defaults_palette_indoor', defaultName: '室內空間' },
		{ id: 'obj_door', color: '#e11d48', name: '🚪', isObject: true },
		{ id: 'obj_window', color: '#f59e0b', name: '🪟', isObject: true },
		{ id: 'obj_sink', color: '#38bdf8', name: '🚰', isObject: true },
		{ id: 'obj_bucket', color: '#1e40af', name: '🪣', isObject: true },
		{ id: 'obj_ladder', color: '#991b1b', name: '🪜', isObject: true },
		{ id: 'zone_bedroom', color: '#818cf8', nameKey: 'defaults_zone_bedroom', defaultName: '臥室', isZone: true },
		{ id: 'zone_kitchen', color: '#fb923c', nameKey: 'defaults_zone_kitchen', defaultName: '廚房', isZone: true },
		{ id: 'zone_living', color: '#38bdf8', nameKey: 'defaults_zone_living', defaultName: '客廳', isZone: true },
	],

	// 區域標籤統一視覺配置
	ZONE_GLOW_WIDTH: 14, // 邊界內發光光暈寬度 (px)，向內漸變衰減
	ZONE_GLOW_ALPHA: 0.35, // 邊界內發光光暈外緣不透明度 (0.0~1.0)
	ZONE_CENTER_ALPHA: 0.01, // 區域正中心底色不透明度 (0.0 為全透)
	ZONE_BORDER_DASH: [4, 4], // 幾何外周虛線邊框間距 (px)
	ZONE_BORDER_WIDTH: 2, // 幾何外周虛線邊框粗細 (px)
	ZONE_FONT_MIN: 11, // 標籤文字字級保底下限 (px)

	// 調色盤編輯器預設色碼
	DEFAULT_PALETTE_COLOR: '#6366F1',

	// 調色盤編輯器預設快速選色盤
	PRESET_SWATCHES: [
		'#334155', '#64748b', '#94a3b8', '#f8fafc',
		'#e11d48', '#ea580c', '#d97706', '#ca8a04',
		'#65a30d', '#16a34a', '#0d9488', '#0284c7',
		'#2563eb', '#4f46e5', '#7c3aed', '#c026d3',
	],

	// 本機儲存配額常數
	STORAGE_QUOTA_BYTES: 5 * 1024 * 1024, // 5 MiB 瀏覽器 LocalStorage 標準配額上限
	STORAGE_QUOTA_WARNING_PERCENT: 70, // 容量使用率警告門檻 (%)
	STORAGE_QUOTA_DANGER_PERCENT: 85, // 容量使用率危險門檻 (%)
});

