import { readdir, lstat, rm } from "node:fs/promises";
import { join } from "node:path";

/** Count completed files on disk, not just jobs submitted since this process started. */
export async function pruneExportFiles(
  directory: string,
  limit: number,
  protectedIds: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Invalid export history limit");
  const files: { id: string; file: string; mtime: number }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const match = /^(j_[a-f0-9]{32})\.mp4$/.exec(entry.name);
    // Unknown files, directories and symlinks are not ours to delete.
    if (!match || !entry.isFile() || protectedIds.has(match[1])) continue;
    const file = join(directory, entry.name);
    try {
      const info = await lstat(file);
      if (info.isFile()) files.push({ id: match[1], file, mtime: info.mtimeMs });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  files.sort((a, b) => b.mtime - a.mtime || b.id.localeCompare(a.id));
  const removed: string[] = [];
  for (const file of files.slice(limit)) {
    await rm(file.file, { force: true });
    removed.push(file.id);
  }
  return removed;
}
