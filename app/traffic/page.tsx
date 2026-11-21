import { AuthGate } from "@/components/AuthGate";
import { TrafficDesk } from "@/components/dayline/RoadWatch";

export default function TrafficPage() {
  return <AuthGate><TrafficDesk /></AuthGate>;
}
