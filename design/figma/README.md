# Power Wards · Figma 可编辑设计生成包

这是 **Figma 本地开发插件包**，不是已经创建的云端 Figma 文档，也不是 `.fig` 文件。运行后创建新的设计页，包含原生 Frame、文本、矢量标记、自动布局组件与实例。仅地图和示意截图使用图片填充。无需 npm、构建或联网下载资源即可运行随包的 `code.js`。

## 在 Figma 中导入并运行

1. 解压整个 ZIP，保留目录结构。打开 Figma 桌面应用中的一个 **Design** 文件，确保有编辑权限。
2. 首次使用需获取属于你的开发插件 ID：在 Figma 菜单 **Plugins → Development → New plugin** 中创建一个 Figma Design 本地插件（可选 Run once 类型）。Figma 会提供/生成它的 `manifest.json`。菜单名称可能随界面语言变化。
3. 将 Figma 生成的 `id` 值复制到本包 `figma/manifest.json`，替换 `REPLACE_WITH_FIGMA_PLUGIN_ID`。其余配置保留。不要把占位符当作可发布的插件 ID。
4. 使用 **Plugins → Development → Import plugin from manifest…**，选择本包 `figma/manifest.json`。若开发插件列表已存在相同 ID，可直接将本包 `code.js` 和 manifest 配置放入刚创建的开发插件目录，保留 Figma 分配的 ID，再从该项运行。
5. 运行 **Power Wards · Editable Design Kit**。等待生成完成后，视口会定位到「02 / Selected ward / Focus」。每次运行都新建一页 `Power Wards / Design Kit / 时间戳`，不覆盖已有页。
6. 查看图层与 Assets，修改文字、颜色、实例和主组件。完成首次检查后，再将实际 Figma 文件/选中 Frame 链接提供给后续 AI agent。

插件未发布至 Community，不需要安装 Codex 的 Figma 连接器才能由你在 Figma 桌面手动运行。当前没有实际 Figma 文件链接。

## 创建结果

- `00 / Components & tokens`：色板、颜色/文字样式、Button（Primary / Secondary / Hover / Disabled）、Category（Default / Selected）、Tag（Default / Selected）、Profile（Default / Open）、WardMarker（三种颜色）组件集。
- `01 / Browse / No selection`：未选中眼位，地图扩展，无右侧详情。
- `02 / Selected ward / Focus`：三栏、选中聚焦、右侧本地截图和说明。
- `03 / Add ward / Classification`：地图底部新增分类浮层。
- `04 / Profile management`：单 Profile 管理弹窗。
- `05 / Unsaved changes / App navigation`：保存、放弃、取消确认。
- `06 / Agent handoff & constraints`：规则与交接注释。

生成静态设计状态，不包含可操作地图、真实持久化或原型连线。所有眼位位置、Profile 名称、数量和说明均为设计示例，不是经过核实的游戏攻略。

## 字体和图片

生成前通过 `listAvailableFontsAsync` 检测并加载中文字体，优先 Noto Sans SC、Microsoft YaHei、PingFang SC、Source Han Sans SC，然后其他候选；粗体不可用时使用已加载常规字体。最后回退 Inter。中文缺字仍可能由字体环境导致：推荐安装 **Noto Sans SC** 后重启 Figma、重新运行。若没有任何候选可加载，插件明确报错，不继续创建页。

地图由项目原图等比例缩小为包内 `assets/map-preview.png`（1200×1135），已嵌入 `code.js`；绘制使用原地图 8909:8424 比例。截图位置使用同一地图的裁切，明确标注「示意图」，不是实战截图。概念图仅作为 `reference/concept.png` 参考，不会被当作整屏设计嵌入 Figma。

## 给后续 AI agent

先阅读 `REQUIREMENTS.md` 和 `DESIGN_SPEC.md`，再读取最新生成页的 06 交接说明、00 组件库与目标状态。业务规则优先于设计示例。使用稳定图层名称定位；实际 node ID 在每次运行后由 Figma 分配，不能预先编造。标记实例的 `relativeCoordinate` pluginData 是示例归一化位置。不要将此包误认为应用实现完成。

## 修改及检查生成器

源文件为 `figma/src.js`，token 为 `tokens.json`，图片为 `figma/assets/map-preview.png`。修改后可在包根目录执行：

```powershell
node figma/build.mjs
node --check figma/code.js
node figma/verify.mjs
```

构建脚本仅用 Node 内置模块，不安装依赖。验证脚本使用有限的 Figma API 模拟器检查执行路径、节点结构和页面隔离；**不能验证真实 Figma API 的全部语义、中文字体覆盖、自动布局或渲染**。目前未在真实 Figma 中运行，导入后的视觉验收仍需完成。

如运行中失败，错误消息会提示；既有页不被修改，新页可能保留部分结果，可检查后手动删除该新页。样式使用独立时间戳前缀，每次重跑不会覆盖已有样式，但会新增一组本地样式。

## 已核对的官方文档

- [Plugin manifest](https://developers.figma.com/docs/plugins/manifest/)：API 版本、dynamic-page、网络禁止配置与 ID 来源。
- [Plugin quickstart](https://developers.figma.com/docs/plugins/plugin-quickstart-guide/)：创建本地开发插件。
- [Figma API](https://developers.figma.com/docs/plugins/api/figma/)：创建页、异步切换页、字体与样式接口。
- [Working with text](https://developers.figma.com/docs/plugins/working-with-text/)：修改文字前加载字体。
- [createImage](https://developers.figma.com/docs/plugins/api/properties/figma-createimage/)：从本地字节创建图片。
- [combineAsVariants](https://developers.figma.com/docs/plugins/api/properties/figma-combineasvariants/)：组件集生成。
- [FrameNode](https://developers.figma.com/docs/plugins/api/FrameNode/)：原生容器与自动布局。

核对日期：2026-09-22。接口核对不等于实际运行验收。
