// src/app/page.tsx
import { redirect } from "next/navigation";

async function getFirstRepoId(): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/repos`, { cache: "no-store" });
    if (!res.ok) return null;
    const repos = (await res.json()) as { id: string }[];
    return repos[0]?.id ?? null;
  } catch {
    return null;
  }
}

export default async function Page() {
  const firstRepoId = await getFirstRepoId();
  if (firstRepoId) {
    redirect(`/repos/${firstRepoId}`);
  }
  // Fallback: no repos yet (shouldn't happen after migration, but just in case)
  redirect("/repos/setup");
}
