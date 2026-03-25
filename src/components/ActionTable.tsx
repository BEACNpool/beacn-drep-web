import Link from "next/link";

export default function ActionTable({ rows }: { rows: any[] }) {
  return (
    <table>
      <thead><tr><th>action_id</th><th>type</th><th>status</th><th>decision</th><th>detail</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.action_id}>
            <td>{r.action_id}</td><td>{r.type || r.action_type}</td><td>{r.status}</td><td>{r.decision || r.bot_recommendation}</td>
            <td><Link href={`/actions/${r.action_id}`}>open</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
