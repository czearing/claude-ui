// src/app/repos/[repo]/session/[sessionId]/page.tsx
import { SessionPage } from "./SessionPage";

export default function Page({
  params,
}: {
  params: Promise<{ repo: string; sessionId: string }>;
}) {
  return <SessionPage params={params} />;
}
