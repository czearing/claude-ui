import { AppShell } from "@/app/AppShell";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return <AppShell repo={repo} view="Board" />;
}
