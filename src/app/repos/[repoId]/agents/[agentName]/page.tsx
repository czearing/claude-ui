import { AgentsPage } from "../AgentsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string; agentName: string }>;
}) {
  const { repoId, agentName } = await params;
  return <AgentsPage repoId={repoId} selectedAgentName={agentName} />;
}
