export type InteractionEventType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "offload_ref"
  | "autonomous_action";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EventMeta = Record<string, JsonValue>;

export type InteractionEvent<TMeta extends EventMeta = EventMeta> = {
  id: number;
  chatId: string;
  userId: string;
  type: InteractionEventType;
  content: string;
  toolName?: string;
  toolCallId?: string;
  offloaded?: boolean;
  meta: TMeta;
  createdAt: string;
};

export type NewInteractionEvent<TMeta extends EventMeta = EventMeta> = {
  chatId: string;
  userId: string;
  type: InteractionEventType;
  content: string;
  toolName?: string;
  toolCallId?: string;
  offloaded?: boolean;
  meta?: TMeta;
  createdAt?: string;
};

export type ConversationTurnRole = "user" | "assistant" | "system" | "tool";

export type ConversationTurn<TMeta extends EventMeta = EventMeta> = {
  id: number;
  chatId: string;
  userId: string;
  role: ConversationTurnRole;
  content: string;
  meta: TMeta;
  createdAt: string;
};

export type NewConversationTurn<TMeta extends EventMeta = EventMeta> = {
  chatId: string;
  userId: string;
  role: ConversationTurnRole;
  content: string;
  meta?: TMeta;
  createdAt?: string;
};

export type PipelineCheckpointValue = JsonValue;

export type PipelineCheckpoint<TValue extends PipelineCheckpointValue = PipelineCheckpointValue> = {
  userId: string;
  key: string;
  value: TValue;
  updatedAt: string;
};

export type MemoryAtom = {
  id: number;
  userId: string;
  text: string;
  importance: number;
  sourceConversationIds: number[];
  sourceLayer: "L1" | "L2" | "L3";
  createdAt: string;
  updatedAt: string;
};

export type NewMemoryAtom = {
  userId: string;
  text: string;
  importance?: number;
  sourceConversationIds?: number[];
  sourceLayer?: MemoryAtom["sourceLayer"];
};

export type UpsertMemoryAtomResult = {
  atom: MemoryAtom;
  created: boolean;
};

export type MemoryScenario = {
  id: number;
  userId: string;
  title: string;
  bodyMarkdown: string;
  atomIds: number[];
  createdAt: string;
  updatedAt: string;
};

export type NewMemoryScenario = {
  userId: string;
  title: string;
  bodyMarkdown: string;
  atomIds: number[];
};

export type PersonaProfile = {
  userId: string;
  markdown: string;
  sourceScenarioIds: number[];
  updatedAt: string;
};

export type NewPersonaProfile = {
  userId: string;
  markdown: string;
  sourceScenarioIds: number[];
};

export type MemoryRecallFallback = {
  missingKind: LineageNodeKind;
  missingId: string;
  fallbackKind: LineageNodeKind;
  fallbackId: string;
  linkType: string;
};

export type MemoryRecall = {
  persona?: PersonaProfile["markdown"];
  atoms: MemoryAtom[];
  scenarios: MemoryScenario[];
  conversations: ConversationTurn[];
  taskCanvas?: string;
  fallbackChain: MemoryRecallFallback[];
};

export type OffloadRef = {
  id: number;
  chatId: string;
  userId: string;
  nodeId: string;
  kind: string;
  title: string;
  filePath: string;
  summary: string;
  createdAt: string;
};

export type NewOffloadRef = {
  chatId: string;
  userId: string;
  nodeId: string;
  kind: string;
  title: string;
  filePath: string;
  summary: string;
  createdAt?: string;
};

export type TaskGraphNode = {
  id: number;
  chatId: string;
  userId: string;
  taskId?: number;
  nodeId: string;
  toolName?: string;
  args: EventMeta;
  summary: string;
  resultRef?: string;
  status: string;
  createdAt: string;
};

export type NewTaskGraphNode = {
  chatId: string;
  userId: string;
  taskId?: number;
  nodeId: string;
  toolName?: string;
  args?: EventMeta;
  summary: string;
  resultRef?: string;
  status: string;
  createdAt?: string;
};

export type TaskCanvasStatus = "active" | "completed" | "inactive";

export type TaskCanvas = {
  id: number;
  chatId: string;
  userId: string;
  label: string;
  filePath: string;
  status: TaskCanvasStatus;
  createdAt: string;
  updatedAt: string;
};

export type NewTaskCanvas = {
  chatId: string;
  userId: string;
  label: string;
  filePath?: string;
  status?: TaskCanvasStatus;
};

export type L15JudgmentSource = "rules" | "llm" | "fallback";

export type L15Judgment = {
  id: number;
  chatId: string;
  userId: string;
  sourceConversationId?: number;
  taskCompleted: boolean;
  isLongTask: boolean;
  isContinuation: boolean;
  selectedTaskId?: number;
  newTaskLabel?: string;
  source: L15JudgmentSource;
  createdAt: string;
};

export type NewL15Judgment = {
  chatId: string;
  userId: string;
  sourceConversationId?: number;
  taskCompleted: boolean;
  isLongTask: boolean;
  isContinuation: boolean;
  selectedTaskId?: number;
  newTaskLabel?: string;
  source: L15JudgmentSource;
  createdAt?: string;
};

export type TaskBoundaryResult = "long" | "short" | "pending";

export type TaskBoundary = {
  id: number;
  chatId: string;
  userId: string;
  startNodeSequence: number;
  result: TaskBoundaryResult;
  taskId?: number;
  createdAt: string;
};

export type NewTaskBoundary = {
  chatId: string;
  userId: string;
  startNodeSequence: number;
  result: TaskBoundaryResult;
  taskId?: number;
  createdAt?: string;
};

export type GeneratedSkillStatus = "draft" | "reviewed" | "rejected" | "exported";

export type GeneratedSkill = {
  id: number;
  sourceTaskId: number;
  chatId: string;
  userId: string;
  skillName: string;
  skillDescription: string;
  skillFocus?: string;
  skillFilePath: string;
  sourceCanvasFilePath: string;
  sourceNodeIds: string[];
  sourceEvidenceIds: string[];
  status: GeneratedSkillStatus;
  createdAt: string;
  updatedAt: string;
};

export type NewGeneratedSkill = {
  sourceTaskId: number;
  chatId: string;
  userId: string;
  skillName: string;
  skillDescription: string;
  skillFocus?: string;
  skillFilePath: string;
  sourceCanvasFilePath: string;
  sourceNodeIds: string[];
  sourceEvidenceIds: string[];
  status?: GeneratedSkillStatus;
  createdAt?: string;
  updatedAt?: string;
};

export type LineageNodeKind = "conversation" | "memory_atom" | "memory_scenario" | "persona";
export type LineageSourceKind = LineageNodeKind;
export type LineageTargetKind = LineageNodeKind;

export type LineageLink = {
  id: number;
  userId: string;
  sourceKind: LineageSourceKind;
  sourceId: string;
  targetKind: LineageTargetKind;
  targetId: string;
  linkType: string;
  createdAt: string;
};

export type NewLineageLink = {
  userId: string;
  sourceKind: LineageSourceKind;
  sourceId: string;
  targetKind: LineageTargetKind;
  targetId: string;
  linkType: string;
};
