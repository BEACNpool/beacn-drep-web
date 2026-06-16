export default function Header() {
  return (
    <header style={{ borderBottom: "1px solid #ddd", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <b>BEACN DRep Audit Dashboard</b>
      <a href="/docs/PUBLIC_CONTEXT_AND_LIMITS.md" target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
        Public Context & Limits
      </a>
    </header>
  );
}
