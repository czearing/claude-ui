import { AppShell } from "@/app/AppShell";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string; taskId: string }>;
}) {
  const { repoId, taskId } = await params;
  return <AppShell repoId={repoId} view="Tasks" selectedTaskId={taskId} />;
}
