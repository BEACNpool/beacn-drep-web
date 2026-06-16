import { getTreasury } from "@/lib/data";
export default async function Page() {
  const d = await getTreasury();
  return <><h1>Treasury</h1><pre>{JSON.stringify(d, null, 2)}</pre></>;
}
