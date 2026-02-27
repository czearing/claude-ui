// src/app/repos/[repo]/page.tsx
import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ repo: string }>;
}) {
  const { repo } = await params;
  redirect(`/repos/${repo}/board`);
}
