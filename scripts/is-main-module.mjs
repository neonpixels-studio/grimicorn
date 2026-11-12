import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MISSING_PATH_CODES = new Set(["ENOENT", "ENOTDIR"]);

// realpathSync throws ENOENT/ENOTDIR for an argv1 that doesn't exist on disk (e.g. a
// virtual path); fall back to the raw path rather than crashing the import. Any other
// failure (ELOOP, EACCES) is rethrown so a broken entry point fails loud instead of
// the script silently doing nothing.
function resolveRealPath(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!MISSING_PATH_CODES.has(error?.code)) {
      throw error;
    }
    return path;
  }
}

// True when the module at `moduleUrl` (pass the caller's import.meta.url) is the
// entry point node was invoked with, as opposed to being imported (e.g. by tests).
// import.meta.url is bound to the module that defines it, so callers must pass their
// own rather than this helper reading one.
// Node resolves symlinks when computing import.meta.url for the entry point, so argv1
// is realpath'd too. Otherwise invoking through any symlinked path (a `/tmp` that is
// itself a symlink, as on macOS; a linked package bin) makes the two URLs disagree,
// and the script exits 0 having silently done nothing.
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (typeof moduleUrl !== "string") {
    throw new TypeError(
      "isMainModule(moduleUrl): pass the caller's import.meta.url",
    );
  }
  if (argv1 == null) {
    return false;
  }
  return moduleUrl === pathToFileURL(resolveRealPath(argv1)).href;
}
