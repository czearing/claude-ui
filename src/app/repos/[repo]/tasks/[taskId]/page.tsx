import { AppShell } from "@/app/AppShell";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string; taskId: string }>;
}) {
  const { repo, taskId } = await params;
  return <AppShell repo={repo} view="Tasks" selectedTaskId={taskId} />;
}
