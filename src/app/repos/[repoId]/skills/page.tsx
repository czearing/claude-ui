import { SkillsPage } from "./SkillsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <SkillsPage repoId={repoId} />;
}
