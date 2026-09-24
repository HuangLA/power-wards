# Power Wards 应用

Dota 2 眼位地图编辑器：React + TypeScript + Vite 浏览器端，Electron 桌面端，共用同一套业务逻辑。网页端由本机 Node 服务保存 Profile 与截图文件；当前不含账号、云端存储或自动同步。产品规则见根目录 [REQUIREMENTS.md](../REQUIREMENTS.md)。

## 启动网页端

```bash
npm install          # 首次运行时安装依赖
npm run tiles        # 地图切片不存在时，从根目录原图生成（只需一次）
npm run dev          # 开发模式：启动 Vite 与本机文件服务
```

使用 `http://localhost:5173` 打开。开发服务退出时，本机文件服务也会停止。

本地正式模式会先构建，再由本机服务同时提供网页和文件 API：

```bash
npm run local        # 构建并启动本机服务，使用 http://localhost:5173
```

`npm run build` 只生成网页文件；若单独预览构建结果，请运行 `npm run preview`，它会在 `http://localhost:4173` 提供本机网页和存储 API。不要用 Vite 静态预览替代本机服务，否则网页无法读取或保存 Profile。

首次运行时，如果**同一浏览器来源**里存在旧版网页的 IndexedDB 数据，应用会将 Profile 和截图迁移到本机文件，并校验读回结果；浏览器中的旧数据不会被删除。浏览器来源包含主机名和端口，例如 `localhost:5173` 与 `127.0.0.1:5173` 是不同来源。迁移旧资料时请沿用之前使用的地址。

网页端数据目录默认为：

- Windows：`%APPDATA%\Power Wards\data\`
- macOS：`~/Library/Application Support/Power Wards/data/`
- Linux：`$XDG_DATA_HOME/power-wards/`，未设置时为 `~/.local/share/power-wards/`

目录中 `profiles/` 保存 Profile JSON，`screenshots/` 保存图片。设置环境变量 `POWER_WARDS_DATA_DIR` 可指定其他位置。清理浏览器数据不会删除这些文件；若手动删除数据目录或磁盘损坏，仍需从备份恢复。分享导出的 JSON 按设计不包含截图。

## 桌面端

```bash
npm run electron
$env:VITE_DEV_SERVER_URL='http://localhost:5173'; npm run electron   # 开发时先在另一个终端运行 npm run dev
```

Electron 继续通过受控 IPC 将资料保存到应用数据目录 `<userData>/power-wards/`。可用 `POWER_WARDS_DATA_DIR` 覆盖存储位置。Electron 的浏览器缓存和运行状态改放在系统临时目录 `power-wards-electron-runtime/`，与 Profile、截图分离；如需指定该位置，可设置 `POWER_WARDS_RUNTIME_DIR`。清理临时目录不会删除 Profile 和截图。

在 Windows x64 上打包便携版：

```bash
npm run package:win
```

产物在 `release/`，包含 Windows 便携版 ZIP 和对应的 `.sha256` 校验文件。解压整个 ZIP 后运行 `Power Wards.exe`。当前未签名，Windows 可能显示发布者未知的提示。重新打包同一版本前，先检查或移走旧产物；脚本不会覆盖已有文件。

## 验证

```bash
npm test                 # Vitest 领域/控制器测试 + 本机 HTTP 服务集成测试
npm run typecheck
npm run build
npm run verify:web       # Playwright 真实浏览器验证（61 项，含眼位中心对齐、标签筛选和旧资料迁移）
npm run verify:electron  # Electron 桌面验证（10 项，含缓存位置、关闭保护与文件落盘）
```

验证结果与截图写入 `verification/`。

若测试环境无法启动 Electron 的 GPU 进程，可仅在验证时设置 `POWER_WARDS_TEST_ELECTRON_FLAGS=--disable-gpu,--no-sandbox`；正式打包不使用这些参数。

## 结构

- `src/domain/` 领域类型、筛选、Profile 操作、分享 JSON 编解码与校验
- `src/map/viewport.ts` 视口数学：相对坐标换算、缩放平移、切片层级选择
- `src/storage/adapter.ts` 跨端存储接口；`localApi.ts` 网页本机 API 适配器；`platform.ts` Electron IPC 适配器
- `src/storage/webStorage.ts` 只用于迁移旧版 IndexedDB，不再作为网页主存储
- `local/server.mjs` 本机 HTTP 服务和固定路径文件存储；API 使用 `/api/v1/` 版本前缀，仅监听回环地址
- `src/ui/` 控制器（保存/导出守卫、离开保护、撤销）与 React 组件
- `electron/` 桌面主进程与受控 preload 桥
- `public/map/` 切片金字塔（由 `npm run tiles` 从 `../../Game_map_7.41.jpg` 生成）

网页页面只依赖 `StorageAdapter`，没有直接依赖本机文件布局。未来增加公开网页服务时，可接入独立云端 API/存储适配器，并由云端服务验证登录身份和隔离用户资料；当前本机服务只面向单机本地使用。
