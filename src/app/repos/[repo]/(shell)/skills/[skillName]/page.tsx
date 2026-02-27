import { SkillsPage } from "../SkillsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string; skillName: string }>;
}) {
  const { repo, skillName } = await params;
  return <SkillsPage repo={repo} selectedSkillName={skillName} />;
}
