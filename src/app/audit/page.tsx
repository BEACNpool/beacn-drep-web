import { getAudit } from "@/lib/data";
export default async function Page() {
  const d = await getAudit();
  return <><h1>Audit</h1><pre>{JSON.stringify(d, null, 2)}</pre></>;
}
