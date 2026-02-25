import { AppShell } from "@/app/AppShell";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <AppShell repoId={repoId} view="Tasks" />;
}
