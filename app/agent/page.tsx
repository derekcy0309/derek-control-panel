import type { Metadata } from "next";
import { AgentWorkspace } from "@/components/AgentWorkspace";
export const metadata: Metadata = { title: "AI Bot Login · Derek Panel", robots: { index: false, follow: false } };
export default function AgentPage() { return <div className="app-frame"><AgentWorkspace /></div>; }
