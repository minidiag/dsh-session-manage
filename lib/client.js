window.__ModuleLoader__.load({
	id: "dsh-session-manage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;
		const useCallback = react.useCallback;
		const useEffect = react.useEffect;
		const useMemo = react.useMemo;
		const useRef = react.useRef;
		const useState = react.useState;

		const ARCHIVED_PATH = "/plugins/dsh-session-manage/archived";
		const DELETE_PATH = "/plugins/dsh-session-manage/delete";

		/**
		 * One id does double duty, exactly like the built-in Plugins panel:
		 * it is the `main` slot key of the panel AND the `sidebar.panellist`
		 * entry id whose row selects it.
		 */
		const PANEL_ID = "session-manage";
		/** Row order inside the sidebar's "Global panels" nav (Plugins is 0). */
		const PANEL_ORDER = 30;
		/** `main` slot key the layout falls back to when no panel is selected. */
		const CONVERSATION_PANEL_ID = "conversation";
		const LOCALE_NAMESPACE = "session-manage";
		const CSS_ID = "dsh-session-manage-css";
		/** Fallback cadence when the live Workspace feed is not reachable. */
		const POLL_MS = 4000;
		/** Coalescing window for state-driven reloads (one burst, one fetch). */
		const SETTLE_MS = 120;

		const name = "dsh-session-manage-client";
		const inject = ["slots", "locale"];

		const zh = {
			panel: "会话管理",
			subtitle:
				"仅删除已归档会话（会话文件 + 索引引用）。未归档会话不会出现在此列表。列表实时同步：归档或删除后立即反映。",
			refresh: "刷新",
			empty: "当前没有已归档会话。",
			deleteSelected: "删除所选",
			deleteAll: "删除全部归档",
			confirmSelected: "确认删除所选已归档会话？不可恢复。",
			confirmAll: "确认删除全部已归档会话？不可恢复。",
			loading: "加载中…",
			error: "加载失败",
			done: "已删除",
			partial: "部分失败",
			pinned: "置顶",
			noTitle: "(无标题)",
			selectAll: "全选",
			clear: "清除选择",
			back: "返回会话",
			hasBody: "会话文件",
			hasIndex: "索引缓存",
			created: "创建于",
			syncLive: "实时同步：工作区状态一变就刷新（无需手动刷新）",
			syncPoll: "自动刷新：每 {n} 秒（未连上工作区实时事件）",
			syncing: "同步中…",
			dropped: "已从左侧会话列表移除",
			dropSkipped: "未能即时通知界面：如左侧仍有该会话，刷新页面即可。",
			staleHint: "宿主未确认实时同步：如左侧列表仍有残留，刷新页面即可。",
		};

		const en = {
			panel: "Session Manage",
			subtitle:
				"Delete archived sessions only (session files + index refs). Non-archived sessions never appear here. The list stays live: archiving and deleting show up immediately.",
			refresh: "Refresh",
			empty: "No archived sessions.",
			deleteSelected: "Delete selected",
			deleteAll: "Delete all archived",
			confirmSelected: "Delete selected archived sessions? This cannot be undone.",
			confirmAll: "Delete ALL archived sessions? This cannot be undone.",
			loading: "Loading…",
			error: "Failed to load",
			done: "Deleted",
			partial: "partial",
			pinned: "Pinned",
			noTitle: "(untitled)",
			selectAll: "Select all",
			clear: "Clear",
			back: "Back to chat",
			hasBody: "Session files",
			hasIndex: "Index cache",
			created: "Created",
			syncLive: "Live: refreshes on every workspace change",
			syncPoll: "Auto refresh every {n}s (workspace feed unavailable)",
			syncing: "Syncing…",
			dropped: "removed from the sidebar list",
			dropSkipped:
				"The UI could not be told immediately; refresh the page if the row remains.",
			staleHint:
				"The host did not confirm the live update; refresh the page if rows remain.",
		};

		function fill(text, vars) {
			return String(text).replace(/\{(\w+)\}/g, (match, key) =>
				vars && key in vars ? String(vars[key]) : match
			);
		}

		function safeT(t, key) {
			try {
				return t(key);
			} catch {
				return zh[key] || key;
			}
		}

		const CSS_TEXT = `
.dsm-main{box-sizing:border-box;width:100%;height:100%;overflow:auto;background:var(--dsw-alias-bg-layer-1)}
.dsm-inner{
  box-sizing:border-box;max-width:920px;margin:0 auto;padding:24px 20px 40px;
  display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);
}
.dsm-header{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dsm-headerText{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsm-title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.dsm-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.dsm-spacer{flex:1}
.dsm-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsm-btn{
  box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;font:inherit;
  padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;
  font-size:12px;line-height:18px;
}
.dsm-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsm-btn:disabled{opacity:.5;cursor:default}
.dsm-btnDanger{color:var(--dsw-alias-state-error-primary,#d92d20)}
.dsm-btnDanger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary,#d92d20)}
.dsm-card{
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);
  border-radius:14px;padding:8px;display:flex;flex-direction:column;gap:6px;
  max-height:min(58vh,540px);overflow:auto;
}
.dsm-row{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:10px}
.dsm-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.dsm-rowCheck{margin:2px 0 0;flex:none}
.dsm-rowBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsm-rowTitle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;line-height:1.45}
.dsm-rowTitleText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-rowId{
  font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;
  color:var(--dsw-alias-label-tertiary);word-break:break-all;
}
.dsm-rowMeta{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.dsm-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.dsm-tag{
  padding:0 6px;border-radius:6px;font-size:11px;line-height:18px;
  background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.14));
  color:var(--dsw-alias-label-tertiary);
}
.dsm-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsm-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#d92d20)}
.dsm-status{display:flex;align-items:center;gap:6px;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsm-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.dsm-dotLive{background:var(--dsw-alias-state-success-primary,#12b76a)}
.dsm-empty{
  padding:28px 16px;text-align:center;font-size:13px;
  color:var(--dsw-alias-label-tertiary);
}
`;

		function injectCss() {
			if (typeof document === "undefined") return () => {};
			// A rebuilt bundle re-applies while the previous style may still be in the
			// document (hot reload): replace it instead of stacking another copy.
			const existing = document.querySelector(`[data-plugin-css="${CSS_ID}"]`);
			if (existing) existing.remove();
			const style = document.createElement("style");
			style.setAttribute("data-plugin-css", CSS_ID);
			style.textContent = CSS_TEXT;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}

		async function fetchArchived() {
			const res = await fetch(ARCHIVED_PATH, {
				method: "GET",
				credentials: "same-origin",
				cache: "no-store",
				headers: { accept: "application/json" },
			});
			const data = await res.json().catch(() => null);
			if (!res.ok || !data || data.ok === false) {
				throw new Error((data && data.error) || `HTTP ${res.status}`);
			}
			return Array.isArray(data.items) ? data.items : [];
		}

		async function postDelete(body) {
			const res = await fetch(DELETE_PATH, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json", accept: "application/json" },
				body: JSON.stringify(body),
			});
			const data = await res.json().catch(() => null);
			if (!data) throw new Error(`HTTP ${res.status}`);
			return data;
		}

		/**
		 * Identity of everything the archived list depends on: the registry-global
		 * archive set plus every Workspace's Session account. The Workspace model
		 * invalidates on any state change, so this signature is what keeps one
		 * unrelated tick from triggering a refetch.
		 */
		function stateSignature(snapshot) {
			if (!snapshot || typeof snapshot !== "object") return "";
			const archived = Array.isArray(snapshot.archivedSessionIds)
				? snapshot.archivedSessionIds.join(",")
				: "";
			const items = Array.isArray(snapshot.items) ? snapshot.items : [];
			const workspaces = items
				.map((item) => {
					const ids = Array.isArray(item && item.sessionIds) ? item.sessionIds : [];
					return `${item && item.workspaceId ? item.workspaceId : "?"}:${ids.join("|")}`;
				})
				.join(";");
			return `${archived}::${workspaces}`;
		}

		/**
		 * The browser half's live bridge.
		 *
		 * `workspaces` is the client Workspace model (`ClientWorkspaceModel`):
		 * `subscribe()` invalidates on every durable Workspace change the host
		 * streams over `workspace.follow` — archive, unarchive, pin, rename, and
		 * Session accounting. Subscribing to it is what makes this panel refresh
		 * itself the moment the sidebar's own list changes, with no polling and no
		 * manual refresh; the interval in the panel only covers a host whose feed
		 * is unreachable.
		 *
		 * `dropSessionIds` is the belt to the host's braces: after the host
		 * confirms a deletion, the browser's session list is told to forget the
		 * Session summary. Sidebar rows are rendered from that summary, so the row
		 * disappears immediately instead of surviving until the next page load
		 * (the host also forwards `api-session/removed` to every client).
		 *
		 * @param {object} ctx the client plugin context.
		 * @returns {object} `{mode, detail, subscribe, snapshot, dropSessionIds}`.
		 */
		function createLiveBridge(ctx) {
			const listeners = new Set();
			let mode = "polling";
			let detail = "starting";
			let lastSignature = null;
			const disposers = [];

			const notify = () => {
				for (const listener of [...listeners]) {
					try {
						listener();
					} catch (error) {
						console.error("[dsh-session-manage] live listener failed:", error);
					}
				}
			};
			const setMode = (next, why) => {
				if (mode === next && detail === why) return;
				mode = next;
				detail = why;
				notify();
			};

			const follow = (model) => {
				setMode("live", "workspaces");
				try {
					lastSignature = stateSignature(model.getSnapshot());
				} catch {
					lastSignature = null;
				}
				const off =
					typeof model.subscribe === "function"
						? model.subscribe(() => {
								try {
									const signature = stateSignature(model.getSnapshot());
									if (signature && signature === lastSignature) return;
									lastSignature = signature;
								} catch {
									/* unreadable snapshot: refresh anyway */
								}
								notify();
							})
						: undefined;
				disposers.push(() => {
					try {
						if (typeof off === "function") off();
					} catch {
						/* ignore */
					}
					setMode("polling", "workspaces-gone");
				});
			};

			/** Attach to the Workspace model, retrying while the client graph settles. */
			const attach = (attempt) => {
				const round = attempt || 0;
				let model = null;
				try {
					const service = ctx.get("workspaces");
					model = service && (service.list || service);
				} catch (error) {
					console.warn("[dsh-session-manage] workspaces unavailable:", error);
				}
				if (model && typeof model.subscribe === "function") {
					follow(model);
					return;
				}
				if (round < 12) {
					const timer = setTimeout(() => attach(round + 1), 500);
					disposers.push(() => clearTimeout(timer));
					return;
				}
				setMode("polling", "workspaces-unavailable");
			};

			try {
				if (typeof ctx.inject === "function") {
					const dispose = ctx.inject(["workspaces"], () => attach(0));
					if (typeof dispose === "function") disposers.push(dispose);
				} else {
					attach(0);
				}
			} catch (error) {
				console.warn("[dsh-session-manage] live follow unavailable:", error);
				setMode("polling", "inject-failed");
			}

			if (typeof ctx.effect === "function") {
				ctx.effect(
					() => () => {
						for (const dispose of disposers.splice(0)) {
							try {
								dispose();
							} catch {
								/* ignore */
							}
						}
						listeners.clear();
					},
					"dsh-session-manage: live bridge"
				);
			}

			return {
				mode: () => mode,
				detail: () => detail,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				snapshot() {
					try {
						const service = ctx.get("workspaces");
						const model = service && (service.list || service);
						return model && typeof model.getSnapshot === "function"
							? model.getSnapshot()
							: null;
					} catch {
						return null;
					}
				},
				/**
				 * Forget deleted Sessions in the browser's own session list.
				 * @param {string[]} ids Sessions the host confirmed as deleted.
				 * @returns {{dropped: number, via: string|null, errors: string[]}}
				 */
				dropSessionIds(ids) {
					const out = { dropped: 0, via: null, errors: [] };
					if (!Array.isArray(ids) || ids.length === 0) return out;
					let sessions = null;
					try {
						sessions = ctx.get("sessions");
					} catch (error) {
						out.errors.push(String((error && error.message) || error));
					}
					const handler =
						sessions && typeof sessions.handleSessionRemoved === "function"
							? sessions.handleSessionRemoved.bind(sessions)
							: null;
					if (!handler) {
						out.errors.push("sessions.handleSessionRemoved unavailable");
						return out;
					}
					out.via = "sessions.handleSessionRemoved";
					for (const id of ids) {
						try {
							handler(id);
							out.dropped += 1;
						} catch (error) {
							out.errors.push(`${id}: ${String((error && error.message) || error)}`);
						}
					}
					return out;
				},
			};
		}

		/**
		 * Sidebar row glyph. The shell renders it inside its own button, so this
		 * must stay presentation-only: it receives `{ size, active }` and nothing else.
		 */
		function PanelGlyph(props) {
			const size = (props && props.size) || 16;
			return h(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": "true",
					focusable: "false",
				},
				h("rect", {
					x: 2.25,
					y: 3.25,
					width: 11.5,
					height: 3,
					rx: 1,
					stroke: "currentColor",
					strokeWidth: 1.2,
				}),
				h("path", {
					d: "M3.9 6.25v5.15c0 .97.78 1.75 1.75 1.75h4.7c.97 0 1.75-.78 1.75-1.75V6.25",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinecap: "round",
				}),
				h("path", {
					d: "M6.6 9.1h2.8",
					stroke: "currentColor",
					strokeWidth: 1.2,
					strokeLinecap: "round",
				})
			);
		}

		function SessionRow(props) {
			const t = (key) => safeT(props.t, key);
			const item = props.item;
			const created = item.createdAt ? new Date(item.createdAt) : null;
			const createdText =
				created && !Number.isNaN(created.getTime())
					? `${t("created")} ${created.toLocaleString()}`
					: null;
			const meta = [item.workspaceTitle, item.cwd].filter(Boolean).join(" · ");
			const tags = [];
			if (item.pinned) tags.push(t("pinned"));
			if (item.hasSessionDir) tags.push(t("hasBody"));
			if (item.hasProjcache) tags.push(t("hasIndex"));
			return h(
				"div",
				{ className: "dsm-row" },
				h("input", {
					className: "dsm-rowCheck",
					type: "checkbox",
					checked: props.checked,
					disabled: props.disabled,
					onChange: () => props.onToggle(item.sessionId),
				}),
				h(
					"div",
					{ className: "dsm-rowBody" },
					h(
						"div",
						{ className: "dsm-rowTitle" },
						h(
							"span",
							{ className: "dsm-rowTitleText" },
							item.title || t("noTitle")
						)
					),
					h("div", { className: "dsm-rowId" }, item.sessionId),
					meta ? h("div", { className: "dsm-rowMeta" }, meta) : null,
					createdText ? h("div", { className: "dsm-rowMeta" }, createdText) : null,
					tags.length
						? h(
								"div",
								{ className: "dsm-tags" },
								...tags.map((tag) => h("span", { className: "dsm-tag", key: tag }, tag))
							)
						: null
				)
			);
		}

		/** `main` panel body: opened by the sidebar row, closed back to the chat. */
		function SessionManagePanel(props) {
			const t = (key) => safeT(props.t, key);
			const live = props.live;
			const [items, setItems] = useState([]);
			const [loading, setLoading] = useState(true);
			const [error, setError] = useState(null);
			const [selected, setSelected] = useState(() => new Set());
			const [busy, setBusy] = useState(false);
			const [message, setMessage] = useState(null);
			const [syncMode, setSyncMode] = useState(() => (live ? live.mode() : "off"));
			/** Ids this panel deleted: never render them again, whatever a refetch says. */
			const tombstones = useRef(new Set());
			const inFlight = useRef(false);

			const load = useCallback(async (options) => {
				const silent = Boolean(options && options.silent);
				if (inFlight.current) return;
				inFlight.current = true;
				if (!silent) {
					setLoading(true);
					setError(null);
				}
				try {
					const next = await fetchArchived();
					const visible = next.filter(
						(item) => item && !tombstones.current.has(item.sessionId)
					);
					setItems(visible);
					setSelected((prev) => {
						const alive = new Set(visible.map((item) => item.sessionId));
						const kept = [...prev].filter((id) => alive.has(id));
						return kept.length === prev.size ? prev : new Set(kept);
					});
					setError(null);
				} catch (e) {
					const text = String((e && e.message) || e);
					if (silent) setMessage(text);
					else {
						setError(text);
						setItems([]);
					}
				} finally {
					inFlight.current = false;
					setLoading(false);
				}
			}, []);

			useEffect(() => {
				load();
			}, [load]);

			/**
			 * Hot refresh: one reload per burst of host-side state changes. The
			 * bridge fires for any Workspace change, so the settle timer collapses
			 * a delete's several increments into a single refetch.
			 */
			useEffect(() => {
				if (!live || typeof live.subscribe !== "function") return undefined;
				let timer = null;
				const schedule = () => {
					if (timer) return;
					timer = setTimeout(() => {
						timer = null;
						load({ silent: true });
					}, SETTLE_MS);
				};
				const off = live.subscribe(() => {
					setSyncMode(live.mode());
					schedule();
				});
				setSyncMode(live.mode());
				return () => {
					off();
					if (timer) clearTimeout(timer);
				};
			}, [live, load]);

			/** Fallback only: a host whose live Workspace feed is unreachable. */
			useEffect(() => {
				if (syncMode === "live") return undefined;
				const timer = setInterval(() => load({ silent: true }), POLL_MS);
				return () => clearInterval(timer);
			}, [syncMode, load]);

			const toggle = (id) => {
				setSelected((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			};

			const selectAll = () => setSelected(new Set(items.map((i) => i.sessionId)));
			const clearSel = () => setSelected(new Set());

			const runDelete = async (body, confirmMsg) => {
				if (!window.confirm(confirmMsg)) return;
				setBusy(true);
				setMessage(null);
				try {
					const data = await postDelete(body);
					const deleted = Array.isArray(data.deleted) ? data.deleted : [];
					const failed = Array.isArray(data.results)
						? data.results.filter((r) => r && r.ok === false).length
						: 0;
					for (const id of deleted) tombstones.current.add(id);
					setItems((prev) =>
						prev.filter((item) => !tombstones.current.has(item.sessionId))
					);
					setSelected(new Set());
					// The host already told every client (api-session/removed); this
					// also covers a host build whose live path degraded, so the row
					// leaves the sidebar within the same click either way.
					const dropped =
						live && typeof live.dropSessionIds === "function"
							? live.dropSessionIds(deleted)
							: { dropped: 0, via: null, errors: [] };
					const skippedDurable =
						data.live && typeof data.live.durable === "number"
							? data.live.durable < deleted.length
							: false;
					const stale =
						(Array.isArray(data.warnings) && data.warnings.length > 0) ||
						(data.live && data.live.fallback > 0) ||
						skippedDurable;
					const dropText =
						deleted.length === 0
							? ""
							: dropped.dropped >= deleted.length
								? ` · ${t("dropped")}`
								: ` · ${t("dropSkipped")}`;
					setMessage(
						fill(`${t("done")}: {n}`, { n: deleted.length }) +
							(data.ok === false
								? ` (${t("partial")}: ${failed || JSON.stringify(data.error || "")})`
								: "") +
							dropText +
							(stale ? ` · ${t("staleHint")}` : "")
					);
					await load({ silent: true });
				} catch (e) {
					setMessage(String((e && e.message) || e));
				} finally {
					setBusy(false);
				}
			};

			const closePanel = () => {
				if (typeof props.close === "function") props.close();
			};

			const syncLabel = useMemo(() => {
				if (syncMode === "live") return t("syncLive");
				if (busy) return t("syncing");
				return fill(t("syncPoll"), { n: Math.round(POLL_MS / 1000) });
			}, [syncMode, busy, props.t]);

			return h(
				"div",
				{ className: "dsm-main" },
				h(
					"div",
					{ className: "dsm-inner" },
					h(
						"div",
						{ className: "dsm-header" },
						h(
							"div",
							{ className: "dsm-headerText" },
							h("h1", { className: "dsm-title" }, t("panel")),
							h("p", { className: "dsm-subtitle" }, t("subtitle"))
						),
						h("div", { className: "dsm-spacer" }),
						h(
							"button",
							{ type: "button", className: "dsm-btn", onClick: closePanel },
							t("back")
						)
					),
					h(
						"div",
						{ className: "dsm-toolbar" },
						h(
							"button",
							{
								type: "button",
								className: "dsm-btn",
								disabled: loading || busy,
								onClick: () => load(),
							},
							t("refresh")
						),
						h(
							"button",
							{
								type: "button",
								className: "dsm-btn",
								disabled: loading || busy || items.length === 0,
								onClick: selectAll,
							},
							t("selectAll")
						),
						h(
							"button",
							{
								type: "button",
								className: "dsm-btn",
								disabled: loading || busy || selected.size === 0,
								onClick: clearSel,
							},
							t("clear")
						),
						h(
							"button",
							{
								type: "button",
								className: "dsm-btn dsm-btnDanger",
								disabled: loading || busy || selected.size === 0,
								onClick: () =>
									runDelete({ sessionIds: [...selected] }, t("confirmSelected")),
							},
							`${t("deleteSelected")} (${selected.size})`
						),
						h(
							"button",
							{
								type: "button",
								className: "dsm-btn dsm-btnDanger",
								disabled: loading || busy || items.length === 0,
								onClick: () => runDelete({ all: true }, t("confirmAll")),
							},
							t("deleteAll")
						)
					),
					h(
						"p",
						{ className: "dsm-status" },
						h("span", {
							className: syncMode === "live" ? "dsm-dot dsm-dotLive" : "dsm-dot",
						}),
						syncLabel
					),
					loading
						? h("div", { className: "dsm-empty" }, t("loading"))
						: error
							? h("p", { className: "dsm-error" }, `${t("error")}: ${error}`)
							: items.length === 0
								? h("div", { className: "dsm-empty" }, t("empty"))
								: h(
										"div",
										{ className: "dsm-card" },
										...items.map((item) =>
											h(SessionRow, {
												key: item.sessionId,
												item,
												t: props.t,
												checked: selected.has(item.sessionId),
												disabled: busy,
												onToggle: toggle,
											})
										)
									),
					message ? h("p", { className: "dsm-note" }, message) : null
				)
			);
		}

		function apply(ctx) {
			try {
				ctx.effect(
					() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }),
					"dsh-session-manage: panel copy"
				);
				const t = ctx.locale.bind(LOCALE_NAMESPACE);

				ctx.effect(() => injectCss(), "dsh-session-manage: panel styles");

				/**
				 * Live Workspace state follow. Built once per plugin fiber: a bundle
				 * rebuild disposes the old fiber (and with it the subscription) before
				 * the fresh bundle applies, so hot reloads do not stack listeners.
				 */
				let live = null;
				try {
					live = createLiveBridge(ctx);
				} catch (error) {
					console.error("[dsh-session-manage] live bridge failed:", error);
				}

				/**
				 * The shell owns panel selection. `selectPanel(null)` is always
				 * accepted; a non-null id must name a registered `main` panel.
				 */
				const selectPanel = (panelId) => {
					const layout = ctx.get("layout");
					if (!layout || typeof layout.selectPanel !== "function") {
						console.error("[dsh-session-manage] layout service unavailable");
						return false;
					}
					try {
						layout.selectPanel(panelId);
						return true;
					} catch (error) {
						console.error("[dsh-session-manage] selectPanel failed:", error);
						return false;
					}
				};

				const closePanel = () => {
					if (selectPanel(null)) return;
					selectPanel(CONVERSATION_PANEL_ID);
				};

				/* Panel body: a keyed entry of the shell's `main` slot. */
				try {
					ctx.slots.inject("main", () =>
						ctx.slots.register(
							{
								name: "main",
								key: PANEL_ID,
								locale: LOCALE_NAMESPACE,
								inject: () => ({ t, close: closePanel, live }),
							},
							SessionManagePanel
						)
					);
				} catch (error) {
					console.error(
						"[dsh-session-manage] could not register the main panel:",
						error
					);
				}

				/*
				 * Left-sidebar row. Clicking it makes the sidebar shell call
				 * ``layout.selectPanel("session-manage")`` itself, which renders
				 * the `main` entry above on the right — no Settings detour.
				 */
				try {
					ctx.slots.inject("sidebar.panellist", () =>
						ctx.slots.register(
							{
								name: "sidebar.panellist",
								id: PANEL_ID,
								order: PANEL_ORDER,
								label: () => t("panel"),
								locale: LOCALE_NAMESPACE,
							},
							PanelGlyph
						)
					);
				} catch (error) {
					console.error(
						"[dsh-session-manage] could not register the sidebar panel row:",
						error
					);
				}
			} catch (error) {
				console.error("[dsh-session-manage] client apply failed:", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
