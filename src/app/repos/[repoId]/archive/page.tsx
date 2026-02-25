import { ArchivePage } from "@/components";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <ArchivePage repoId={repoId} />;
}
