// src/app/repos/[repo]/page.tsx
import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo: rawRepo } = await params;
  redirect(`/repos/${encodeURIComponent(decodeURIComponent(rawRepo))}/board`);
}
