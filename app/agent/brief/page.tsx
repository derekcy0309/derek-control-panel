import type { Metadata } from "next";
import { AgentWorkspace } from "@/components/AgentWorkspace";
export const metadata:Metadata={title:"Grok 三日摘要",robots:{index:false,follow:false}};
export default function AgentBriefPage(){return <div className="app-frame"><AgentWorkspace briefOnly/></div>;}
