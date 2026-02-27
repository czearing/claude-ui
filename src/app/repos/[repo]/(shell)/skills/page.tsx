import { SkillsPage } from "./SkillsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  return <SkillsPage repo={repo} />;
}
