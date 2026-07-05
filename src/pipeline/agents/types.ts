export interface ReviewContext {
  title: string;
  description: string;
  files: string[];
  diff: string;
  docs: string[];
}

export interface AgentFinding {
  file: string;
  line: number;
  severity: 'low' | 'medium' | 'high';
  issue: string;
  suggestion: string;
}

export interface AgentResponse {
  findings: AgentFinding[];
  summary: string;
}

export type AgentName = 'bug' | 'security' | 'performance' | 'style' | 'summary';
export type AgentPrompts = Record<AgentName, string>;

export interface OrchestratorResult {
  bug: AgentResponse;
  security: AgentResponse;
  performance: AgentResponse;
  style: AgentResponse;
  overallSummary: string;
}
