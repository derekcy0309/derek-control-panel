import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Derek 控制面板",
  description: "私人 ADHD 外置執行功能 Web App"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
