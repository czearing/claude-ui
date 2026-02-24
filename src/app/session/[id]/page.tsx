import { SessionPage } from "./SessionPage";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SessionPage params={params} />;
}
