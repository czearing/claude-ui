import type { Metadata } from "next";

import "@/app/global.css";

export const metadata: Metadata = {
  title: "Claude Code UI",
  description: "Claude Code UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
