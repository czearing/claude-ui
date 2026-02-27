import { AgentsPage } from "./AgentsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return <AgentsPage repo={repo} />;
}
