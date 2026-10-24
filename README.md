# dsh-session-manage

Delete **archived** sessions only: session body, workspace.json refs, and session_projcache.
The list is live, and a deleted session leaves the sidebar session list immediately — no page reload.

## Behavior

- **Archived only.** Only ids in `global.archivedSessionIds` are listed, and only those can be
  deleted (`error: "not-archived"` otherwise).
- **Hot refresh.** The panel subscribes to the client Workspace model, which the host feeds over
  `workspace.follow` (archive / unarchive / pin / Session accounting). Archive a session in the
  sidebar, or delete one here, and the panel re-reads itself immediately. If that feed cannot be
  reached it falls back to a 4-second poll, and the status line under the toolbar names which one
  is in effect.
- **Delete order: refs → bytes → browser → verify.**
  1. the live `workspaceRegistry` detaches the Session from every Workspace account, using the
     `workspace.json` ownership read before deletion as a second source — the entity's
     `sessionIds` getter filters through the live header index, so a directory deleted first makes
     that stale account invisible to the getter;
  2. session directories and `session_projcache/<id>.json` are removed;
  3. `ctx.emit("api-session/removed", id)` drops the browser's Session summary (sidebar rows are
     rendered from summaries), and only then does the id leave the archive/pin sets, so no
     intermediate render can draw the row;
  4. `workspace.json` is re-read: `archivedSessionIds`, `pinnedSessionIds`, and every Workspace
     account must no longer name the id (`removed.durable` in the response).
- **No half-state.** If the live registry is unavailable *and* `workspace.json` cannot be written,
  the call returns `error: "durable-update-failed"` and the session files stay untouched, rather
  than leaving a reference without bytes.
- **Browser-side belt.** After a confirmed delete the client also calls
  `sessions.handleSessionRemoved(id)`, so the row leaves the sidebar within the same click even on
  a host build that did not confirm the live sync.

## Entry point

A **left-sidebar row** in the "Global panels" nav (`sidebar.panellist`, id `session-manage`).
Clicking it makes the sidebar shell call `layout.selectPanel("session-manage")`, which renders this
plugin's `main` slot entry (`kind: "keyed"`, key `session-manage`) on the right — the same path the
built-in Plugins panel uses. "Back to chat" returns to the conversation. No Settings → Plugin
Settings detour, and no "插件设置" group is created.

## Hot refresh (development / updates)

| Half | Loaded by | To take effect |
| --- | --- | --- |
| client (`lib/client.js`) | `@deepseek-ai/dsh-client-hmr` stat-polls the installed package's entry artifact (mtime/ctime/size) and pushes a `rebuilt` frame; the browser swaps the bundle | overwrite `~/.dsh/plugins/dsh-session-manage/lib/client.js` — **no restart, no page reload** |
| host (`lib/index.js`, `lib/delete.js`) | the Cordis Loader's plain ESM `import()`, with no cache-busting | **restart DeepSeek Harness** |

Ask which build the host is running: the `rev` field of `GET /plugins/dsh-session-manage/archived`.
Watch for a browser swap: `GET /plugins/events` (SSE) emits `{"type":"rebuilt","id":"dsh-session-manage",...}`.

## Routes (loopback)

- `GET  /plugins/dsh-session-manage/archived` — archive list (workspace.json + projcache titles)
- `GET  /plugins/dsh-session-manage/state` — durable view next to the live registry view; the live
  side reports `sessionIds` (getter, header-index filtered) beside `durableSessionIds` (raw record),
  which is how "deleted but still listed" is told apart from a browser-side cache
- `POST /plugins/dsh-session-manage/delete` — `{ "sessionIds": ["session-..."] }` or `{ "all": true }`

## Test

`pnpm test` (or `node test/delete-flow.test.mjs .`) drives `lib/delete.js` inside a throwaway
`DSH_HOME`: it checks the archived-only refusal, the durable-first order, the durable verification,
the storage `unit` wrapper, the BOM policy, and that an unwritable store aborts before any byte is
destroyed. It never touches real sessions.

See README.zh-CN.md for Chinese docs.
