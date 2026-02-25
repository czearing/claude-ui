import { PlaybooksPage } from "./PlaybooksPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <PlaybooksPage repoId={repoId} />;
}
