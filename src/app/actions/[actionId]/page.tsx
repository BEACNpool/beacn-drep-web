import HashBadge from "@/components/HashBadge";
import ResourceList from "@/components/ResourceList";
import { getActionDetail } from "@/lib/data";

export default async function ActionPage({ params }: { params: { actionId: string } }) {
  const d = await getActionDetail(params.actionId);
  return (
    <>
      <h1>Action {d.action_id}</h1>
      <p>{d.title}</p>
      <p>Type: {d.type} | Status: {d.status} | Vote: {d.decision.vote}</p>
      <p>Input hash: <HashBadge hash={d.source.raw_input_hash} /></p>
      <h3>Reproducibility</h3>
      <ResourceList ids={d.reproducibility.resource_ids_used} />
      <a href={d.rationale.markdown_path}>Download rationale markdown</a>
    </>
  );
}
