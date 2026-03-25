export type RepoRef = {
  repo: string;
  commit: string;
  path?: string;
};

export type ActionListItem = {
  action_id: string;
  title: string;
  type: string;
  status: string;
  decision: string;
  detected_at: string;
  published_at: string;
  detail_path: string;
};

export type ActionDetail = {
  action_id: string;
  title: string;
  type: string;
  status: string;
  source: {
    origin: string;
    raw_input_hash: string;
    detected_at: string;
  };
  decision: {
    vote: string;
    published_at: string;
    signed: boolean;
    transaction_hash?: string;
  };
  rationale: {
    summary: string;
    markdown_path: string;
  };
  reproducibility: {
    soul_repo: string;
    soul_commit: string;
    resources_repo: string;
    resources_commit: string;
    core_commit: string;
    resource_ids_used: string[];
  };
  inputs_used: {
    resource_id: string;
    type: string;
    path: string;
  }[];
  scoring?: Record<string, number>;
};

export type IndexJson = {
  generated_at: string;
  soul: RepoRef;
  resources: RepoRef & { registry_path: string };
  core: { repo: string; version: string; commit: string };
  stats: { actions_seen: number; decisions_published: number; votes_cast: number; abstentions: number };
  latest_actions: { action_id: string; title: string; type: string; decision: string; published_at: string }[];
};
