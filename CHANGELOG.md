# Changelog

## 0.4.0
- **面板改为热刷新（实时）**：client 半订阅 `@deepseek-ai/dsh-api-workspace-controller` 的客户端
  Workspace 模型（`ctx.get("workspaces").list.subscribe()`）。归档 / 取消归档 / 置顶 / 改名 / 会话
  归属变化都会经 `workspace.follow` 推到浏览器，面板据此自动重取列表 —— 不再需要点「刷新」。
  连不上实时事件时退化为每 4 秒轮询，面板底部用小圆点 + 文案标明当前是「实时」还是「轮询」。
- **删除后不再显示**：删除流程改为“先改引用、再删字节、最后通知界面、并回读校验”：
  1. 先经 live `workspaceRegistry` 把会话从每个工作区归属中摘除（`detachSession`），
     并用删除前读到的 `workspace.json` 归属（`owners`）兜底 —— 因为实体的 `sessionIds`
     getter 会用**实时 header 索引**过滤，文件删掉后那条“陈旧归属”在 getter 里已经看不见了，
     这正是旧版漏掉 detach 的原因；
  2. 删会话目录 + `session_projcache`；
  3. `ctx.emit("api-session/removed", id)` 让浏览器丢掉会话摘要（侧栏行就是按摘要渲染的），
     之后再从归档集合里移除 —— 顺序保证中间任何一次渲染都找不到摘要可画；
  4. 回读 `workspace.json` 校验 id 已不在 `archivedSessionIds` / `pinnedSessionIds` / 各工作区
     `sessionIds` 中，结果写在 `removed.durable`。
- **引用改不动就不删文件**：live 注册表不可用且 `workspace.json` 写入失败时返回
  `durable-update-failed` 并保留会话文件，避免留下“有引用没文件”的可见残行。
- **client 侧兜底**：删除成功后 client 半会调用客户端会话列表的
  `sessions.handleSessionRemoved(id)`，即使宿主未确认实时同步（例如宿主半还是旧构建），
  侧栏那一行也会在同一次点击里消失；面板同时记住本次删除的 id（tombstone），刷新列表也不会复现。
- **新增 `GET /plugins/dsh-session-manage/state`**：同时给出 `workspace.json`（durable）与
  live 注册表视图，注册表视图里 `sessionIds`（getter，已过滤）与 `durableSessionIds`
  （原始记录）并列，便于判断“删了还在”是残留引用还是浏览器缓存。
- `lib/index.js` 的 `REV` 升到 `0.4.0`；`dsh.client.inject` 增加
  `@deepseek-ai/dsh-api-workspace-controller`、`@deepseek-ai/dsh-api-session-controller`。
- **热刷新边界**：client 半由 `@deepseek-ai/dsh-client-hmr` 监听已安装包的 `lib/client.js`
  （mtime/ctime/size 变化 → `rebuilt` 帧 → 浏览器换新），改完覆盖到
  `~/.dsh/plugins/dsh-session-manage/` 即生效，**不用重启、不用刷新页面**；
  host 半（`lib/index.js`、`lib/delete.js`）由 Cordis Loader 用普通 ESM `import()` 加载，
  无 cache-busting，**改动必须重启 DeepSeek Harness 才生效**。

## 0.3.0
- 删除时先删会话文件，再尽力让 live 宿主同步（`workspaceRegistry.unarchiveSession` +
  `api-session/removed`），失败则直接改 `workspace.json`；删除结果里回传 `live.applied` /
  `workspaceRefsSource`，用于判断是否真的实时生效。
- 已知缺陷（0.4.0 修复）：detach 依赖实体 `sessionIds` getter，文件先删导致该 getter 过滤掉
  目标 id，于是归属没有被摘除；且 `ctx.get("workspaceRegistry")` 只要可用就不会再走文件兜底。

## 0.2.0
- **入口改为左侧栏「全局面板」**：注册 `sidebar.panellist` 行（`id: "session-manage"`、`order: 30`、`label: () => t("panel")`，组件只渲染 SVG 图标）。点击该行由侧栏 shell 自己调用 `layout.selectPanel("session-manage")`，在右侧主区域渲染 `main` 槽（`kind: "keyed"`，`key: "session-manage"`）里的会话管理面板 —— 与内置「插件」面板完全同一条路径。
- **移除 设置 → 插件设置 入口**：不再注册 `settings.section` / `plugin-settings.item`，也不再自动创建「插件设置」分组。
- 面板整页布局（`dsm-*` + DSH `--dsw-alias-*` token），保留刷新 / 全选 / 清除 / 删除所选 / 删除全部归档；「返回会话」通过 `layout.selectPanel(null)` 回到 conversation。
- `package.json`：`dsh.client.inject` 改为 `api-remotes` + `client-ui-renderer` + `client-ui-layout` + `client-ui-sidebar` + `client-locale`（不再依赖 settings 相关包）。
- Host half（`lib/index.js`、`lib/delete.js`、`lib/paths.js`）与两条 loopback 路由保持不变。
- 依据：`@deepseek-ai/dsh-client-ui-sidebar` 声明 `sidebar.panellist`（`kind: "list"`，条目取 `id`/`order`/`label`，glyph 收到 `{ size, active }`），`@deepseek-ai/dsh-client-ui-layout` 声明 `main`（`kind: "keyed"`）并提供 `layout.selectPanel()`。

## 0.1.3
- client.js 改为 `window.__ModuleLoader__.load` + `require("react")`（对齐 mas/workbuddy）。原先 ESM `import` 导致桌面 web-boot「Cannot use import statement outside a module」直接崩。
- apply() soft-strips UTF-8 BOM from workspace.json。
- 保留 0.1.2 写文件加固（Buffer UTF-8、拒 BOM、保留 `unit`）。

## 0.1.2
- Harden workspace.json writes: Buffer UTF-8, refuse BOM, preserve storage `unit` wrapper, verify before rename.
- Auto-strip UTF-8 BOM on load.

## 0.1.1
- Soft-fail apply; avoid Cordis workspaceRegistry inject throws.

## 0.1.0
- 首次发布：设置页列出已归档会话，支持删除选中/全部。
