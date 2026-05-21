import type {
  ConversationTurn,
  InteractionEvent,
  LineageLink,
  LineageSourceKind,
  MemoryAtom,
  MemoryRecallFallback,
  MemoryScenario,
  GeneratedSkill,
  L15Judgment,
  L1EvidenceEntry,
  NewConversationTurn,
  NewGeneratedSkill,
  NewInteractionEvent,
  NewL15Judgment,
  NewL1EvidenceEntry,
  NewLineageLink,
  NewMemoryAtom,
  NewMemoryScenario,
  NewOffloadRef,
  NewPersonaProfile,
  NewTaskBoundary,
  NewTaskCanvas,
  NewTaskGraphNode,
  OffloadRef,
  PersonaProfile,
  PipelineCheckpointValue,
  TaskBoundary,
  TaskCanvas,
  TaskCanvasRecall,
  TaskCanvasStatus,
  TaskGraphNode,
  UpsertMemoryAtomResult,
} from "./types";

export interface MemoryBackend {
  init(): Promise<void>;
  insertInteractionEvent(event: NewInteractionEvent): Promise<number>;
  insertConversationTurn(turn: NewConversationTurn): Promise<number>;
  listInteractionEvents(userId: string, chatId: string, limit: number): Promise<InteractionEvent[]>;
  listConversationTurns(userId: string, chatId: string, limit: number): Promise<ConversationTurn[]>;
  listPendingConversationEvidence(userId: string, afterConversationId: number, limit: number): Promise<ConversationTurn[]>;
  listMemoryAtoms(userId: string, limit: number): Promise<MemoryAtom[]>;
  countMemoryAtoms(userId: string): Promise<number>;
  searchMemoryAtoms(userId: string, query: string, limit: number): Promise<MemoryAtom[]>;
  searchMemoryAtomsByVector(userId: string, query: string, limit: number): Promise<MemoryAtom[]>;
  listExistingMemoryAtomIds(userId: string, atomIds: number[]): Promise<Set<number>>;
  upsertMemoryAtom(atom: NewMemoryAtom): Promise<UpsertMemoryAtomResult>;
  insertMemoryScenario(scenario: NewMemoryScenario): Promise<number>;
  countMemoryScenarios(userId: string): Promise<number>;
  searchMemoryScenarios(userId: string, query: string, limit: number): Promise<MemoryScenario[]>;
  getPersona(userId: string): Promise<PersonaProfile | undefined>;
  upsertPersona(profile: NewPersonaProfile): Promise<PersonaProfile>;
  insertLineageLink(link: NewLineageLink): Promise<number>;
  listLineageTargets(userId: string, sourceKind: LineageSourceKind, sourceId: string): Promise<LineageLink[]>;
  getFallbackChain(userId: string, missingKind: LineageSourceKind, missingId: string): Promise<MemoryRecallFallback[]>;
  searchConversationTurns(userId: string, query: string, limit: number): Promise<ConversationTurn[]>;
  countConversationTurns(userId: string): Promise<number>;
  createTaskCanvas(task: NewTaskCanvas): Promise<TaskCanvas>;
  getTaskCanvasById(userId: string, taskId: number): Promise<TaskCanvas | undefined>;
  getActiveTaskCanvas(userId: string, chatId: string): Promise<TaskCanvas | undefined>;
  getTaskCanvasForUser(userId: string, chatId: string): Promise<string | undefined>;
  listTaskCanvases(userId: string, chatId: string, limit: number): Promise<TaskCanvas[]>;
  updateTaskCanvasStatus(taskId: number, status: TaskCanvasStatus): Promise<void>;
  recordL15Judgment(judgment: NewL15Judgment): Promise<L15Judgment>;
  insertTaskBoundary(boundary: NewTaskBoundary): Promise<TaskBoundary>;
  getTaskCanvas(chatId: string): Promise<string | undefined>;
  getOffloadPath(chatId: string, nodeId: string): Promise<{ absolutePath: string; relativePath: string }>;
  getTaskCanvasPath(chatId: string): Promise<string>;
  getTaskCanvasFilePath(taskId: number): Promise<{ absolutePath: string; relativePath: string } | undefined>;
  findOffloadRefByNodeId(userId: string, nodeId: string): Promise<OffloadRef | undefined>;
  findOffloadRefByFilePath(userId: string, filePath: string): Promise<OffloadRef | undefined>;
  insertOffloadRef(ref: NewOffloadRef): Promise<number>;
  countOffloadRefs(userId: string): Promise<number>;
  insertTaskGraphNode(node: NewTaskGraphNode): Promise<number>;
  insertOffloadRefWithTaskGraphNode(ref: NewOffloadRef, node: NewTaskGraphNode): Promise<void>;
  deleteOffloadMetadata(nodeId: string): Promise<void>;
  listTaskGraphNodes(chatId: string, limit: number): Promise<TaskGraphNode[]>;
  listTaskGraphNodesForTask(taskId: number, limit: number): Promise<TaskGraphNode[]>;
  insertL1EvidenceEntry(entry: NewL1EvidenceEntry): Promise<L1EvidenceEntry>;
  listL1EvidenceEntriesForTask(taskId: number, limit: number): Promise<L1EvidenceEntry[]>;
  listPendingL1EvidenceEntriesForTask(taskId: number, limit: number): Promise<L1EvidenceEntry[]>;
  updateL1EvidenceNodeMapping(taskId: number, mapping: Record<string, string>): Promise<void>;
  getL1EvidenceJsonlPath(chatId: string): Promise<{ absolutePath: string; relativePath: string }>;
  upsertTaskCanvasSearchText(input: { taskId: number; chatId: string; userId: string; label: string; status: TaskCanvasStatus; filePath: string; canvas: string }): Promise<void>;
  searchTaskCanvases(userId: string, query: string, limit: number, chatId?: string): Promise<TaskCanvasRecall[]>;
  insertGeneratedSkill(skill: NewGeneratedSkill): Promise<GeneratedSkill>;
  countGeneratedSkills(userId: string): Promise<number>;
  countGeneratedSkillsByName(userId: string, skillName: string): Promise<number>;
  listGeneratedSkills(userId: string, limit: number): Promise<GeneratedSkill[]>;
  getCheckpoint(userId: string, key: string): Promise<PipelineCheckpointValue | undefined>;
  setCheckpoint(userId: string, key: string, value: PipelineCheckpointValue): Promise<void>;
}
