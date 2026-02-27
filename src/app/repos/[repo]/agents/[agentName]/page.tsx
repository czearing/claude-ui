import { AgentsPage } from "../AgentsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string; agentName: string }>;
}) {
  const { repo, agentName } = await params;
  return <AgentsPage repo={repo} selectedAgentName={agentName} />;
}
