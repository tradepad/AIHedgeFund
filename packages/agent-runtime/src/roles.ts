import type { AgentRole } from "@arf/contracts";

export type AgentTool =
  | "web_research"
  | "internal_knowledge_search"
  | "source_inspection"
  | "pine_docs"
  | "indicator_library"
  | "repository"
  | "pine_compiler"
  | "runner"
  | "datasets"
  | "report_ingestion"
  | "evidence_read"
  | "analytics"
  | "deployment_config"
  | "paper_engine"
  | "decision_command";

/** Tool allowlists per role (CLAUDE.md §11.4). No role receives shell, database or arbitrary network access. */
export const ROLE_TOOL_ALLOWLIST: Record<AgentRole, readonly AgentTool[]> = {
  CHIEF_RESEARCH_ORCHESTRATOR: ["internal_knowledge_search", "evidence_read"],
  IDEA_SCOUT: ["web_research", "internal_knowledge_search"],
  INDICATOR_RESEARCHER: ["source_inspection", "pine_docs", "indicator_library"],
  STRATEGY_ARCHITECT: ["internal_knowledge_search", "evidence_read"],
  PINE_ENGINEER: ["repository", "pine_compiler", "pine_docs"],
  BACKTEST_ENGINEER: ["runner", "datasets", "report_ingestion"],
  ROBUSTNESS_VALIDATOR: ["evidence_read", "analytics"],
  FORWARD_TEST_OPERATOR: ["deployment_config", "paper_engine"],
  STRATEGY_JUDGE: ["evidence_read", "decision_command"],
  DATA_INTEGRITY_ANALYST: ["datasets", "evidence_read", "analytics"],
  PORTFOLIO_RESEARCHER: ["evidence_read", "analytics"],
};

export function isToolAllowed(role: AgentRole, tool: AgentTool): boolean {
  return ROLE_TOOL_ALLOWLIST[role].includes(tool);
}
