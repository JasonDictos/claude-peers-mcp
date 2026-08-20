// Unique ID for each Claude Code instance (generated on registration)
export type PeerId = string;

export interface Peer {
  id: PeerId;
  /** Human-readable alias, e.g. "goofy-joe". Unique among live peers. */
  name: string;
  pid: number;
  /** PID of the Claude Code process this peer's MCP server belongs to. */
  claude_pid: number | null;
  /** Namespace-safe session key: "<claude_pid>:<starttime>" (see runtime.ts). */
  claude_key: string | null;
  /** PID-namespace identity (host or container) this peer runs in. */
  runtime: string | null;
  /** Machine hostname — peers can live on different machines. */
  host: string | null;
  cwd: string;
  git_root: string | null;
  tty: string | null;
  summary: string;
  registered_at: string; // ISO timestamp
  last_seen: string; // ISO timestamp
}

export interface Message {
  id: number;
  from_id: PeerId;
  to_id: PeerId;
  /** Sender/recipient names at send time (survive peer death, for the log). */
  from_name: string;
  to_name: string;
  text: string;
  sent_at: string; // ISO timestamp
  delivered: boolean;
}

// --- Broker API types ---

export interface RegisterRequest {
  pid: number;
  claude_pid: number | null;
  claude_key?: string | null;
  runtime?: string | null;
  host?: string | null;
  cwd: string;
  git_root: string | null;
  tty: string | null;
  summary: string;
}

export interface RegisterResponse {
  id: PeerId;
  name: string;
}

export interface HeartbeatRequest {
  id: PeerId;
}

export interface SetSummaryRequest {
  id: PeerId;
  summary: string;
}

export interface ListPeersRequest {
  scope: "machine" | "directory" | "repo";
  // The requesting peer's context (used for filtering)
  cwd: string;
  git_root: string | null;
  exclude_id?: PeerId;
}

export interface SendMessageRequest {
  from_id: PeerId;
  /** Target: peer ID, peer name, or directory path (~ allowed). */
  to?: string;
  /** Legacy alias for `to` (pre-name clients). */
  to_id?: PeerId;
  text: string;
}

export interface SendMessageResponse {
  ok: boolean;
  error?: string;
  /** True when no live session matched: held for that mailbox until it returns. */
  queued_offline?: boolean;
  /** Resolved recipient on success. */
  to?: { id: PeerId; name: string };
  /** On ambiguous/no-match errors: peers the sender could target instead. */
  candidates?: Peer[];
}

export interface PollMessagesRequest {
  id: PeerId;
}

export interface PollMessagesResponse {
  messages: Message[];
}
