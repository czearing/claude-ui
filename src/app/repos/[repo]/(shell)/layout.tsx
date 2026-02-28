import { RepoShell } from "./RepoShell";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ repo: string }>;
}) {
  const { repo: rawRepo } = await params;
  const repo = decodeURIComponent(rawRepo);
  return <RepoShell repo={repo}>{children}</RepoShell>;
}
