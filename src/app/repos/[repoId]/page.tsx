// src/app/repos/[repoId]/page.tsx
import { AppShell } from "@/app/AppShell";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <AppShell repoId={repoId} />;
}
