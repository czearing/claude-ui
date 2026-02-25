// src/app/repos/[repoId]/session/[sessionId]/page.tsx
import { SessionPage } from "./SessionPage";

export default function Page({
  params,
}: {
  params: Promise<{ repoId: string; sessionId: string }>;
}) {
  return <SessionPage params={params} />;
}
