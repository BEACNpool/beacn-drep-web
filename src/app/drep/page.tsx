import { getDrep } from "@/lib/data";
export default async function Page() {
  const d = await getDrep();
  return <><h1>DRep</h1><pre>{JSON.stringify(d, null, 2)}</pre></>;
}
