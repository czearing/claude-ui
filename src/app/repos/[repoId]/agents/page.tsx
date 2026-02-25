import { AgentsPage } from "./AgentsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <AgentsPage repoId={repoId} />;
}
