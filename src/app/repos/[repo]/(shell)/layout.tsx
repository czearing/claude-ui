import { RepoShell } from "./RepoShell";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return <RepoShell repo={repo}>{children}</RepoShell>;
}
