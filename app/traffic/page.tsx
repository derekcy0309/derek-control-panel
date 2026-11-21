import { AuthGate } from "@/components/AuthGate";
import { TrafficDesk } from "@/components/dayline/RoadWatch";
import "../dayline-traffic.css";

export default function TrafficPage() {
  return <AuthGate><TrafficDesk /></AuthGate>;
}
