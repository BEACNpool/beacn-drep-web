import { DATA_BASE } from "./constants";
import { ActionDetail, ActionListItem, IndexJson } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${DATA_BASE}/${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to fetch ${path}`);
  return r.json();
}

export const getIndex = () => getJson<IndexJson>("index.json");
export const getActions = async () => (await getJson<{ generated_at: string; items: ActionListItem[] }>("actions.json")).items;
export const getRationales = async () => (await getJson<{ generated_at: string; items: any[] }>("rationales.json")).items;
export const getAudit = () => getJson<any>("audit_status.json");
export const getTreasury = () => getJson<any>("treasury_summary.json");
export const getDrep = () => getJson<any>("drep_summary.json");
export const getActionDetail = (actionId: string) => getJson<ActionDetail>(`actions/${actionId}.json`);
