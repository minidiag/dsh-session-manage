/**
 * dsh-session-manage host entry.
 * Routes (loopback webServer):
 *   GET  /plugins/dsh-session-manage/archived
 *   GET  /plugins/dsh-session-manage/state    (durable vs live registry view)
 *   POST /plugins/dsh-session-manage/delete   { sessionIds?: string[], all?: boolean }
 *
 * Every route answers with `rev`, so a running host can be asked which build it
 * actually loaded. The browser half hot-reloads on a bundle rebuild
 * (`dsh-client-hmr`); a changed *host* half needs a DSH restart, because the
 * Cordis Loader imports this file once per process.
 */
import {
  listArchived,
  deleteArchivedSessions,
  deleteAllArchived,
} from "./delete.js";
import fs from "node:fs";
import { paths as resolvePaths } from "./paths.js";

export const name = "dsh-session-manage";

export const ARCHIVED_PATH = "/plugins/dsh-session-manage/archived";
export const STATE_PATH = "/plugins/dsh-session-manage/state";
export const DELETE_PATH = "/plugins/dsh-session-manage/delete";

/** Response revision: proves which build the live host has loaded. */
export const REV = "0.4.0";

const MAX_BODY = 65536;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function hostIsLoopback(hostHeader) {
  if (!hostHeader || typeof hostHeader !== "string") return false;
  const host = hostHeader.split(":")[0].toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY) return undefined;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Read the live workspace registry for diagnostics.
 *
 * The interesting column is `durableSessionIds`: the entity's public
 * `sessionIds` getter hides ids the live header index no longer accepts (a
 * session whose directory is already gone), so only the raw record shows a
 * stale account. Comparing the two is how a "deleted but still listed" report
 * is told apart from a browser-side cache.
 *
 * @param {import('cordis').Context} ctx live host context.
 * @returns {object} what the registry reports, or why it could not be read.
 */
function probeLive(ctx) {
  const info = { reachable: false, archivedSessionIds: null, workspaces: [], errors: [] };
  let registry;
  try {
    registry = ctx.get("workspaceRegistry");
  } catch (e) {
    info.errors.push(`workspaceRegistry: ${String(e?.message || e)}`);
  }
  if (!registry) {
    if (info.errors.length === 0) info.errors.push("workspaceRegistry unavailable");
    return info;
  }
  info.reachable = true;
  try {
    info.archivedSessionIds = Array.isArray(registry.archivedSessionIds)
      ? [...registry.archivedSessionIds]
      : null;
  } catch (e) {
    info.errors.push(`archivedSessionIds: ${String(e?.message || e)}`);
  }
  try {
    for (const workspace of registry.list()) {
      const row = {
        workspaceId: workspace?.id ?? null,
        title: workspace?.title ?? null,
        path: workspace?.path ?? null,
        sessionIds: [],
        durableSessionIds: [],
      };
      try {
        if (Array.isArray(workspace?.sessionIds)) row.sessionIds = [...workspace.sessionIds];
      } catch {
        /* getter failure: the durable column still reports */
      }
      try {
        const record = workspace?.record;
        if (record && Array.isArray(record.sessionIds)) {
          row.durableSessionIds = [...record.sessionIds];
        }
      } catch {
        /* private shape changed: skip */
      }
      info.workspaces.push(row);
    }
  } catch (e) {
    info.errors.push(`list: ${String(e?.message || e)}`);
  }
  return info;
}

function createHandlers(ctx) {
  const archivedHandler = async (req, res) => {
    if (!hostIsLoopback(req.headers.host)) {
      return json(res, 403, { ok: false, error: "loopback-only" });
    }
    try {
      return json(res, 200, { ...listArchived(), rev: REV });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e?.message || e), rev: REV });
    }
  };

  const stateHandler = async (req, res) => {
    if (!hostIsLoopback(req.headers.host)) {
      return json(res, 403, { ok: false, error: "loopback-only" });
    }
    try {
      return json(res, 200, {
        ok: true,
        durable: listArchived(),
        live: probeLive(ctx),
        rev: REV,
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e?.message || e), rev: REV });
    }
  };

  const deleteHandler = async (req, res) => {
    if (!hostIsLoopback(req.headers.host)) {
      return json(res, 403, { ok: false, error: "loopback-only" });
    }
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "POST only" });
    }
    try {
      const raw = await readBody(req);
      if (raw === undefined) return json(res, 413, { ok: false, error: "body too large" });
      let body = {};
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, { ok: false, error: "invalid json" });
        }
      }
      // `ctx` lets the delete reach the live workspace registry, so the browser
      // drops the row through the follow stream instead of waiting for a reload.
      const opts = { ctx };
      let result;
      if (body.all === true) {
        result = await deleteAllArchived(opts);
      } else if (Array.isArray(body.sessionIds) && body.sessionIds.length > 0) {
        result = await deleteArchivedSessions(
          body.sessionIds.map(String),
          opts
        );
      } else {
        return json(res, 400, {
          ok: false,
          error: "need sessionIds[] or all:true",
          rev: REV,
        });
      }
      return json(res, result.ok ? 200 : 207, { ...result, rev: REV });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e?.message || e), rev: REV });
    }
  };

  return { archivedHandler, stateHandler, deleteHandler };
}

function registerRoutes(ctx) {
  const handlers = createHandlers(ctx);
  const disposers = [];
  const register = (webCtx) => {
    const reg = (path, handler) => {
      try {
        const dispose = webCtx.webServer.register({
          path,
          methods: ["GET", "POST", "OPTIONS"],
          handler,
        });
        if (typeof dispose === "function") disposers.push(dispose);
      } catch (e) {
        console.warn("[dsh-session-manage] route register warn:", path, e?.message || e);
      }
    };
    reg(ARCHIVED_PATH, handlers.archivedHandler);
    reg(STATE_PATH, handlers.stateHandler);
    reg(DELETE_PATH, handlers.deleteHandler);
  };

  if (ctx && typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (webCtx) => {
      register(webCtx);
    });
  } else if (ctx?.webServer?.register) {
    register(ctx);
  }

  return () => {
    for (const d of disposers) {
      try {
        d();
      } catch {
        /* ignore */
      }
    }
  };
}


function stripWorkspaceBomSoft() {
  try {
    const file = resolvePaths().workspaceJson;
    if (!fs.existsSync(file)) return;
    const buf = fs.readFileSync(file);
    if (!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)) return;
    let text = buf.slice(3).toString("utf8");
    JSON.parse(text);
    if (!text.endsWith("\n")) text += "\n";
    const out = Buffer.from(text, "utf8");
    const tmp = `${file}.bomfix.${process.pid}.tmp`;
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, file);
    console.warn("[dsh-session-manage] stripped UTF-8 BOM from workspace.json");
  } catch (e) {
    console.warn("[dsh-session-manage] BOM soft-strip skipped:", e?.message || e);
  }
}

export function apply(ctx) {
  stripWorkspaceBomSoft();
  // Soft-fail: never throw from apply — a hard throw can take down the desktop host fiber.
  try {
    registerRoutes(ctx);
  } catch (e) {
    console.warn("[dsh-session-manage] apply warn:", e?.message || e);
  }
}

export default apply;
