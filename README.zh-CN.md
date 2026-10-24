# dsh-session-manage

删除 **已归档** 会话：清理 session 本体、`workspace.json` 引用，以及 `session_projcache`。
列表实时同步，删除后会话立刻从「左侧栏会话列表」消失，**不需要刷新页面**。

## 行为

- **只删** `global.archivedSessionIds` 里的会话；未归档会话既不出现在列表，接口也会拒绝删除
  （`error: "not-archived"`）。
- **热刷新**：面板订阅客户端 Workspace 模型（`workspace.follow` 推送的归档 / 归属变更），
  你在侧栏归档、取消归档、删除，面板都会自动重取；连不上实时事件时退化为每 4 秒轮询，
  面板底部的状态行会写明当前是「实时同步」还是「自动刷新」。
- **删除顺序（先引用、后字节、再通知、末校验）**：
  1. live `workspaceRegistry`：把会话从每个工作区归属里摘除（`detachSession`），
     并用删除前读到的 `workspace.json` 归属兜底（实体 `sessionIds` getter 会用实时 header
     索引过滤，文件先删就会漏掉这条陈旧归属）；
  2. 删除会话目录与 `session_projcache/<id>.json`；
  3. `ctx.emit("api-session/removed", id)` 让浏览器丢掉该会话摘要（侧栏行按摘要渲染），
     再把 id 从归档 / 置顶集合移除 —— 顺序保证中间任何一次渲染都画不出这行；
  4. 回读 `workspace.json` 校验：`archivedSessionIds`、`pinnedSessionIds`、各工作区
     `sessionIds` 都不再含该 id，结果见响应里的 `removed.durable`。
- **引用改不动就不删文件**：live 注册表不可用且 `workspace.json` 写入失败时返回
  `error: "durable-update-failed"`，会话文件保持原样，不会留下“有引用、没文件”的残行。
- 浏览器侧兜底：删除成功后 client 还会调用 `sessions.handleSessionRemoved(id)`，
  即便宿主半是旧构建（未确认实时同步），侧栏那一行也会在同一次点击里消失。

## 用法（桌面）

1. 把会话在 DSH 侧栏里 **归档**。
2. 在 **左侧栏「全局面板」** 里点击存档图标那一行（提示文字「会话管理」，`order: 30`，排在「插件」之后）。
3. 面板在右侧主区域打开：勾选后点「删除所选」，或「删除全部归档」。
4. 面板底部状态行显示同步方式；删除完成会提示「已从左侧会话列表移除」。
5. 点「返回会话」回到对话。

> 0.2.0 起不再需要 **设置 → 插件设置** 路径，也不再创建「插件设置」分组。

## 热刷新（开发 / 更新）

| 半边 | 加载方式 | 改动后如何生效 |
| --- | --- | --- |
| client（`lib/client.js`） | `@deepseek-ai/dsh-client-hmr` 轮询已安装包的入口产物（mtime/ctime/size），变化即发 `rebuilt` 帧，浏览器换新 bundle | 覆盖到 `~/.dsh/plugins/dsh-session-manage/lib/client.js` 即热替换，**不用重启、不用刷新页面** |
| host（`lib/index.js`、`lib/delete.js`） | Cordis Loader 普通 ESM `import()`，无 cache-busting | **必须重启 DeepSeek Harness** |

验证当前宿主加载的是哪个构建：`GET /plugins/dsh-session-manage/archived` 响应里的 `rev`。
判断浏览器有没有换新：`GET /plugins/events`（SSE）里会出现 `{"type":"rebuilt","id":"dsh-session-manage",...}`。

## 安装到 desktop profile

```json
"dependencies": {
  "dsh-session-manage": "file:~/.dsh/plugins/dsh-session-manage"
}
```

并在 `dsh.profile.bundles` 加入 `"dsh-session-manage"`，然后在 profile 目录执行 `pnpm install`，重启桌面。
（pnpm 对 `file:` 依赖使用硬链接：改写 `~/.dsh/plugins/...` 里的文件会同时更新
`profiles/desktop/node_modules/dsh-session-manage`，即宿主实际加载、HMR 实际监听的那份。）

## HTTP（本机 loopback）

- `GET  /plugins/dsh-session-manage/archived` —— 归档列表（读 `workspace.json` + projcache 标题）
- `GET  /plugins/dsh-session-manage/state` —— durable 与 live 注册表并列视图；
  live 侧 `sessionIds`（getter，已被 header 索引过滤）与 `durableSessionIds`（原始记录）并列，
  用于判断“删了还在”是残留引用还是浏览器缓存
- `POST /plugins/dsh-session-manage/delete` —— body: `{ "sessionIds": ["session-..."] }` 或 `{ "all": true }`

## 测试

`pnpm test`（或 `node test/delete-flow.test.mjs .`）：在临时 `DSH_HOME` 里跑 `lib/delete.js`，
校验“只删已归档”、先引用后字节的顺序、回读校验、storage `unit` 包装保留、无 BOM，
以及“引用写不动就一个字节都不删”。不会碰真实会话。
