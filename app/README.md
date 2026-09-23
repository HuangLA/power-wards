# Power Wards 应用

Dota 2 眼位地图编辑器：React + TypeScript + Vite 网页端，Electron 桌面壳，同一套核心逻辑。需求与验收标准见根目录 `../REQUIREMENTS.md`。

## 命令

```bash
npm install          # 安装依赖
npm run tiles        # 从根目录原图生成地图切片到 public/map/（只需一次）
npm run dev          # 网页开发服务器（默认 http://localhost:5173）
npm run build        # 类型检查 + 构建到 dist/
npm run preview      # 预览构建产物
npm test             # 领域逻辑与控制器单元测试（vitest）
npm run typecheck    # 仅类型检查
```

桌面端（需先 `npm run build`）：

```bash
npm run electron                                # 生产模式：加载 dist/
$env:VITE_DEV_SERVER_URL='http://localhost:5173'; npm run electron   # 开发模式（另开终端先 npm run dev）
```

桌面数据目录：`<userData>/power-wards/`（profiles/*.json 与 screenshots/）。可用环境变量 `POWER_WARDS_DATA_DIR` 覆盖（测试用）。

## 验证

```bash
npm run build
npm run verify:web        # Playwright 真实浏览器交互验证（37 项）
npm run verify:electron   # Electron 桌面端验证（9 项，含关闭保护与文件落盘）
```

验证结果与截图写入 `verification/`。

## 结构

- `src/domain/` 纯领域逻辑：类型、组合/标签筛选、Profile 操作、分享 JSON 编解码与校验
- `src/map/viewport.ts` 视口数学：相对坐标换算、缩放平移、切片层级选择
- `src/storage/` 存储抽象 + IndexedDB（网页）/ Electron IPC（桌面）适配
- `src/ui/` 控制器（保存/导出守卫、离开保护、撤销）与 React 组件
- `electron/` 桌面主进程与受控 preload 桥
- `public/map/` 切片金字塔（由 `npm run tiles` 从 `../../Game_map_7.41.jpg` 生成）
