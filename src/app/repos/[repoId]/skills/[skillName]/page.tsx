import { SkillsPage } from "../SkillsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string; skillName: string }>;
}) {
  const { repoId, skillName } = await params;
  return <SkillsPage repoId={repoId} selectedSkillName={skillName} />;
}
