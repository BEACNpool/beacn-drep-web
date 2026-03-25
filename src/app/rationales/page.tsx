import RationaleCard from "@/components/RationaleCard";
import { getRationales } from "@/lib/data";

export default async function Page() {
  const items = await getRationales();
  return <><h1>Rationales</h1>{items.map((x: any) => <RationaleCard key={x.action_id} item={x} />)}</>;
}
