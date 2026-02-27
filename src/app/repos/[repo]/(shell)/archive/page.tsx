import { ArchivePage } from "@/components";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return <ArchivePage repo={repo} />;
}
