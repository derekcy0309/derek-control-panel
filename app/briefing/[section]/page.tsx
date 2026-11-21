import {notFound} from "next/navigation";
import {AuthGate} from "@/components/AuthGate";
import {NewsDesk} from "@/components/dayline/NewsDesk";
import {isNewsSection} from "@/lib/briefing";
export default async function BriefingPage({params}:{params:Promise<{section:string}>}){
  const {section}=await params;if(!["library","medical","evening","publications","preferences"].includes(section)&&!isNewsSection(section))notFound();
  return <AuthGate><NewsDesk section={section}/></AuthGate>;
}
