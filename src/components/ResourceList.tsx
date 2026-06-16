export default function ResourceList({ ids }: { ids: string[] }) {
  return <ul>{ids.map((id) => <li key={id}>{id}</li>)}</ul>;
}
