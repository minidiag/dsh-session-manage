/**
 * List / delete ARCHIVED sessions only.
 * Clears: session dirs, workspace.json refs, projcache records.
 * NEVER touches ids that are not in global.archivedSessionIds.
 *
 * Deletion is durable-first, because a browser row outlives its bytes:
 *
 *   1. durable references — the live `workspaceRegistry` (or `workspace.json`
 *      when no host context is reachable) drops the id from every Workspace
 *      account, from the pin set, and leaves the archive set;
 *   2. the bytes — session dirs and the projcache record;
 *   3. the browser — `api-session/removed` (a remote-forwarded event) drops the
 *      Session summary the sidebar would otherwise keep rendering, and the
 *      archive set is left last so a re-render in between finds no summary;
 *   4. verification — `workspace.json` is re-read and must no longer name the id.
 *
 * Only step 1 failing aborts the delete: a Session must never lose its bytes
 * while a durable reference still points at it.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { paths as resolvePaths } from "./paths.js";

function readJsonNoBom(file) {
  let raw = fs.readFileSync(file, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

/** Write UTF-8 JSON without BOM (atomic replace). Verifies round-trip.
 * DSH JsonStorageBackend does not strip BOM — a leading U+FEFF crashes the host.
 */
function writeJsonNoBom(file, data) {
  const text = JSON.stringify(data, null, 2) + "\n";
  const buf = Buffer.from(text, "utf8");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    throw new Error("internal: refused to write UTF-8 BOM");
  }
  const parsed = JSON.parse(text);
  if (data && data.unit && (!parsed.unit || parsed.unit.name !== data.unit.name)) {
    throw new Error("refused write: would drop storage unit wrapper");
  }
  const dir = path.dirname(file);
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tmp, buf);
  const check = fs.readFileSync(tmp);
  if (check[0] === 0xef && check[1] === 0xbb && check[2] === 0xbf) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new Error("refused rename: temp file has UTF-8 BOM");
  }
  JSON.parse(check.toString("utf8"));
  fs.renameSync(tmp, file);
}

/** If workspace.json starts with UTF-8 BOM, strip it in place (atomic). */
function stripBomInPlaceIfNeeded(file) {
  const buf = fs.readFileSync(file);
  if (!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)) return false;
  let text = buf.slice(3).toString("utf8");
  JSON.parse(text);
  if (!text.endsWith("\n")) text += "\n";
  const out = Buffer.from(text, "utf8");
  const tmp = `${file}.bomfix.${process.pid}.tmp`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
  return true;
}

function ensureWorkspaceShape(doc) {
  if (!doc || typeof doc !== "object") throw new Error("workspace.json invalid");
  if (!doc.global || typeof doc.global !== "object") doc.global = {};
  if (!Array.isArray(doc.global.archivedSessionIds)) doc.global.archivedSessionIds = [];
  if (!Array.isArray(doc.global.pinnedSessionIds)) doc.global.pinnedSessionIds = [];
  if (!Array.isArray(doc.global.workspaceIds)) doc.global.workspaceIds = [];
  if (!doc.tables || typeof doc.tables !== "object") doc.tables = {};
  if (!doc.tables.workspaces || typeof doc.tables.workspaces !== "object") {
    doc.tables.workspaces = {};
  }
  return doc;
}

function loadWorkspace(p) {
  if (!fs.existsSync(p.workspaceJson)) {
    throw new Error(`workspace.json not found: ${p.workspaceJson}`);
  }
  try {
    stripBomInPlaceIfNeeded(p.workspaceJson);
  } catch (e) {
    console.warn(
      "[dsh-session-manage] BOM strip failed:",
      e && e.message ? e.message : e
    );
  }
  return ensureWorkspaceShape(readJsonNoBom(p.workspaceJson));
}

function findSessionDirs(sessionsRoot, sessionId) {
  const hits = [];
  if (!fs.existsSync(sessionsRoot)) return hits;
  let entries;
  try {
    entries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const candidate = path.join(sessionsRoot, ent.name, sessionId);
    if (fs.existsSync(candidate)) hits.push(candidate);
  }
  return hits;
}

function readProjcacheMeta(projcacheDir, sessionId) {
  const file = path.join(projcacheDir, `${sessionId}.json`);
  if (!fs.existsSync(file)) return { file, exists: false };
  try {
    const raw = readJsonNoBom(file);
    const record = raw?.record || raw;
    const title =
      record?.rows?.title?.val ??
      record?.title ??
      record?.rows?.titleInput?.val?.first ??
      null;
    const cwd = record?.identity?.cwd ?? record?.cwd ?? null;
    const createdAt = record?.identity?.createdAt ?? null;
    return { file, exists: true, title, cwd, createdAt };
  } catch {
    return { file, exists: true, title: null, cwd: null, createdAt: null };
  }
}

function workspaceOwners(doc, sessionId) {
  const owners = [];
  for (const [wid, ws] of Object.entries(doc.tables.workspaces || {})) {
    const ids = Array.isArray(ws?.sessionIds) ? ws.sessionIds : [];
    if (ids.includes(sessionId)) {
      owners.push({
        workspaceId: wid,
        title: ws.title || null,
        path: ws.path || null,
      });
    }
  }
  return owners;
}

export function listArchived(env = process.env) {
  const p = resolvePaths(env);
  const doc = loadWorkspace(p);
  const archived = [...doc.global.archivedSessionIds];
  const items = archived.map((sessionId) => {
    const meta = readProjcacheMeta(p.projcacheSessions, sessionId);
    const dirs = findSessionDirs(p.sessionsRoot, sessionId);
    const owners = workspaceOwners(doc, sessionId);
    return {
      sessionId,
      title: meta.title || null,
      cwd: meta.cwd || owners[0]?.path || null,
      workspaceTitle: owners[0]?.title || null,
      workspaceId: owners[0]?.workspaceId || null,
      createdAt: meta.createdAt,
      hasSessionDir: dirs.length > 0,
      sessionDirs: dirs,
      hasProjcache: meta.exists,
      pinned: doc.global.pinnedSessionIds.includes(sessionId),
    };
  });
  return {
    ok: true,
    count: items.length,
    archivedSessionIds: archived,
    items,
    paths: {
      workspaceJson: p.workspaceJson,
      sessionsRoot: p.sessionsRoot,
      projcacheSessions: p.projcacheSessions,
    },
  };
}

async function rmrf(target) {
  try {
    await fsp.rm(target, { recursive: true, force: true });
    return { path: target, removed: true };
  } catch (e) {
    return { path: target, removed: false, error: String(e?.message || e) };
  }
}

function errorText(e) {
  return String((e && e.message) || e);
}

/** Direct workspace.json edit: the fallback when no live registry is reachable. */
function writeWorkspaceRefs(p, sessionId) {
  const fresh = loadWorkspace(p);
  fresh.global.archivedSessionIds = fresh.global.archivedSessionIds.filter(
    (id) => id !== sessionId
  );
  fresh.global.pinnedSessionIds = (fresh.global.pinnedSessionIds || []).filter(
    (id) => id !== sessionId
  );
  for (const ws of Object.values(fresh.tables.workspaces || {})) {
    if (Array.isArray(ws.sessionIds) && ws.sessionIds.includes(sessionId)) {
      ws.sessionIds = ws.sessionIds.filter((id) => id !== sessionId);
      ws.updatedAt = new Date().toISOString();
    }
  }
  writeJsonNoBom(p.workspaceJson, fresh);
}

/** The live `ctx.workspaceRegistry`, or undefined with the reason recorded. */
function liveRegistry(ctx, errors) {
  if (!ctx) {
    errors.push("no live host context");
    return undefined;
  }
  try {
    const registry = ctx.get("workspaceRegistry");
    if (!registry) errors.push("workspaceRegistry unavailable");
    return registry;
  } catch (e) {
    errors.push(`workspaceRegistry: ${errorText(e)}`);
    return undefined;
  }
}

/**
 * Step 1 of the durable update: unhook the Session from every Workspace
 * account **before** its bytes go away.
 *
 * The entity's own `sessionIds` getter filters ids through the live header
 * index, so once the session directory is gone a still-accounted (stale) id is
 * invisible to that getter. The durable account is therefore located from
 * `workspace.json` (`owners`, read before deletion) and detached by workspace
 * id, in addition to whatever the getter still reports.
 *
 * @param {import('cordis').Context} [ctx] live host context.
 * @param {string} sessionId deleted Session.
 * @param {Array<{workspaceId: string}>} owners durable accounts read from workspace.json.
 * @returns {Promise<object>} what the live registry accepted, plus any errors.
 */
async function detachFromWorkspaces(ctx, sessionId, owners) {
  const info = {
    applied: false,
    source: null,
    detached: [],
    archivedInRegistry: null,
    errors: [],
  };
  const registry = liveRegistry(ctx, info.errors);
  if (!registry || typeof registry.list !== "function") {
    if (registry) info.errors.push("workspaceRegistry.list unavailable");
    return info;
  }

  try {
    const ownerIds = new Set((owners || []).map((owner) => owner.workspaceId));
    for (const workspace of registry.list()) {
      const id = workspace && workspace.id !== undefined ? String(workspace.id) : undefined;
      const ids =
        workspace && Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
      const accounted = ids.includes(sessionId);
      const stale = id !== undefined && ownerIds.has(id);
      if (!accounted && !stale) continue;
      if (typeof workspace.detachSession !== "function") {
        info.errors.push(`workspace ${id}: detachSession unavailable`);
        continue;
      }
      await workspace.detachSession(sessionId);
      info.detached.push(id ?? "?");
    }
    try {
      const set = registry.archivedSessionIds;
      info.archivedInRegistry = Array.isArray(set) ? set.includes(sessionId) : null;
    } catch (e) {
      info.errors.push(`archivedSessionIds: ${errorText(e)}`);
    }
    info.applied = true;
    info.source = "workspaceRegistry";
  } catch (e) {
    info.errors.push(`workspaceRegistry: ${errorText(e)}`);
  }

  return info;
}

/**
 * Step 3 of the durable update, run once the bytes are gone: tell the browser
 * the Session no longer exists, then leave the archive and pin sets.
 *
 * - `api-session/removed` is a remote-forwarded event
 *   (`API_REMOTE_FORWARDED_EVENTS`, mode `emit`), so it drops the Session
 *   summary the sidebar renders rows from — the row disappears without a page
 *   reload and cannot be rebuilt from a cached summary.
 * - The registry's archive/pin writes are what the host `WorkspaceFeed` streams
 *   to the browser as `archived`/`pinned` increments, so the row also leaves
 *   every archived view. Emitting the removal first and the set change second
 *   keeps the ordering safe: a render in between finds no summary to draw.
 *
 * Both halves are best-effort; the caller reports what degraded.
 *
 * @param {import('cordis').Context} [ctx] live host context.
 * @param {string} sessionId deleted Session.
 * @returns {Promise<object>} what the live host accepted, plus any errors.
 */
async function retireLiveSession(ctx, sessionId) {
  const info = {
    announced: false,
    skipped: null,
    unpinned: false,
    unarchived: false,
    errors: [],
  };
  if (!ctx) {
    info.errors.push("no live host context");
    return info;
  }

  try {
    const sessions = ctx.get("sessions");
    const resident =
      sessions && typeof sessions.get === "function" ? sessions.get(sessionId) : undefined;
    if (resident !== undefined) {
      info.skipped = "session-still-live";
    } else if (typeof ctx.emit === "function") {
      ctx.emit("api-session/removed", sessionId);
      info.announced = true;
    }
  } catch (e) {
    info.errors.push(`api-session/removed: ${errorText(e)}`);
  }

  const registry = liveRegistry(ctx, info.errors);
  if (!registry) return info;

  try {
    if (typeof registry.unpinSession === "function") {
      await registry.unpinSession(sessionId);
      info.unpinned = true;
    }
  } catch (e) {
    info.errors.push(`unpinSession: ${errorText(e)}`);
  }

  try {
    if (typeof registry.unarchiveSession === "function") {
      await registry.unarchiveSession(sessionId);
      info.unarchived = true;
    }
  } catch (e) {
    info.errors.push(`unarchiveSession: ${errorText(e)}`);
  }

  return info;
}

/**
 * Step 4: re-read the durable store and report every set that still names the
 * id. A non-empty answer means the row would come back on the next reload.
 */
function verifyDurableAbsence(p, sessionId) {
  const remaining = [];
  try {
    const doc = loadWorkspace(p);
    if (doc.global.archivedSessionIds.includes(sessionId)) {
      remaining.push("archivedSessionIds");
    }
    if (doc.global.pinnedSessionIds.includes(sessionId)) {
      remaining.push("pinnedSessionIds");
    }
    for (const [wid, ws] of Object.entries(doc.tables.workspaces || {})) {
      if (Array.isArray(ws?.sessionIds) && ws.sessionIds.includes(sessionId)) {
        remaining.push(`workspace:${wid}`);
      }
    }
  } catch (e) {
    remaining.push(`unreadable:${errorText(e)}`);
  }
  return { durable: remaining.length === 0, remaining };
}

/**
 * Delete one archived session. Refuses non-archived ids.
 *
 * A session counts as archived when either the live registry or
 * `workspace.json` says so: the registry is authoritative while DSH runs, the
 * file is authoritative for an offline host, and the panel lists from the file.
 *
 * @param {string} sessionId archived Session to delete.
 * @param {object} [opts]
 * @param {import('cordis').Context} [opts.ctx] live host context (optional)
 * @param {object} [opts.env] environment override (tests)
 */
export async function deleteArchivedSession(sessionId, opts = {}) {
  if (!sessionId || typeof sessionId !== "string") {
    return { ok: false, sessionId, error: "invalid sessionId" };
  }
  const env = opts.env || process.env;
  const p = resolvePaths(env);
  const doc = loadWorkspace(p);
  const owners = workspaceOwners(doc, sessionId);
  const fileArchived = doc.global.archivedSessionIds.includes(sessionId);

  const removed = {
    workspaceRefs: false,
    workspaceRefsSource: null,
    detachedFrom: [],
    sessionDirs: [],
    projcache: null,
    live: null,
    durable: false,
    remaining: [],
  };
  const warnings = [];

  // 1) durable references first: fail here and nothing is destroyed.
  const detach = await detachFromWorkspaces(opts.ctx, sessionId, owners);
  // Archived when either owner says so: the registry is authoritative while DSH
  // runs, `workspace.json` is authoritative for an offline host and is what the
  // panel lists from. A registry that could not be read reports `null`, never
  // `false`, so an unreachable host falls back to the file instead of refusing.
  const archivedSeen = detach.archivedInRegistry === true || fileArchived;
  if (!archivedSeen) {
    return {
      ok: false,
      sessionId,
      error: "not-archived",
      message: "拒绝删除：该会话不在 archivedSessionIds 中（仅允许删已归档）。",
      removed,
      warnings,
    };
  }
  if (detach.applied) {
    removed.workspaceRefs = true;
    removed.workspaceRefsSource = detach.source;
    removed.detachedFrom = detach.detached;
  } else {
    try {
      writeWorkspaceRefs(p, sessionId);
      removed.workspaceRefs = true;
      removed.workspaceRefsSource = "workspace.json";
    } catch (e) {
      warnings.push(`workspace.json: ${errorText(e)}`);
      return {
        ok: false,
        sessionId,
        error: "durable-update-failed",
        message:
          "拒绝删除：无法更新归档引用（workspace.json 写入失败），会话文件保持原样。",
        removed,
        warnings,
      };
    }
  }

  // 2) the bytes.
  for (const dir of findSessionDirs(p.sessionsRoot, sessionId)) {
    removed.sessionDirs.push(await rmrf(dir));
  }
  const projFile = path.join(p.projcacheSessions, `${sessionId}.json`);
  if (fs.existsSync(projFile)) {
    removed.projcache = await rmrf(projFile);
  } else {
    removed.projcache = { path: projFile, removed: false, missing: true };
  }

  // 3) the browser, now that the bytes are gone.
  const retire = await retireLiveSession(opts.ctx, sessionId);
  removed.live = { detach, retire };
  if (retire.skipped) warnings.push(`api-session/removed skipped: ${retire.skipped}`);
  for (const message of detach.errors) warnings.push(message);
  for (const message of retire.errors) warnings.push(message);

  // 4) prove it is gone from the durable store.
  const verdict = verifyDurableAbsence(p, sessionId);
  removed.durable = verdict.durable;
  removed.remaining = verdict.remaining;
  if (!verdict.durable) {
    warnings.push(`durable references remain: ${verdict.remaining.join(", ")}`);
  }

  return { ok: true, sessionId, removed, warnings: [...new Set(warnings)] };
}

export async function deleteArchivedSessions(sessionIds, opts = {}) {
  const results = [];
  for (const id of sessionIds) {
    results.push(await deleteArchivedSession(id, opts));
  }
  const ok = results.every((r) => r.ok);
  const live = { applied: 0, fallback: 0, announced: 0, durable: 0 };
  const warnings = [];
  for (const result of results) {
    if (result?.removed?.workspaceRefsSource === "workspaceRegistry") live.applied += 1;
    else live.fallback += 1;
    if (result?.removed?.live?.retire?.announced) live.announced += 1;
    if (result?.removed?.durable) live.durable += 1;
    for (const message of result?.warnings || []) warnings.push(message);
  }
  return {
    ok,
    results,
    deleted: results.filter((r) => r.ok).map((r) => r.sessionId),
    live,
    warnings: [...new Set(warnings)],
  };
}

export async function deleteAllArchived(opts = {}) {
  const listed = listArchived(opts.env);
  return deleteArchivedSessions(listed.archivedSessionIds, opts);
}
