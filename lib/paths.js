/**
 * Resolve ~/.dsh (or $DSH_HOME) paths used by session cleanup.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DSH_HOME_DIR_NAME = ".dsh";
const DSH_HOME_ENV = "DSH_HOME";

export function resolveDshHome(env = process.env) {
  const fromEnv = env[DSH_HOME_ENV];
  if (fromEnv && String(fromEnv).trim()) {
    return resolve(String(fromEnv).trim());
  }
  return join(homedir(), DSH_HOME_DIR_NAME);
}

export function paths(env = process.env) {
  const home = resolveDshHome(env);
  return {
    home,
    workspaceJson: join(home, "storages", "workspace.json"),
    sessionsRoot: join(home, "sessions"),
    projcacheSessions: join(home, "storages", "session_projcache", "sessions"),
  };
}
