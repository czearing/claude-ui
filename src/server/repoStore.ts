import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Repo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

const REPOS_FILE = join(process.cwd(), "repos.json");

export async function readRepos(): Promise<Repo[]> {
  try {
    const raw = await readFile(REPOS_FILE, "utf8");
    return JSON.parse(raw) as Repo[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function writeRepos(repos: Repo[]): Promise<void> {
  await writeFile(REPOS_FILE, JSON.stringify(repos, null, 2), "utf8");
}
