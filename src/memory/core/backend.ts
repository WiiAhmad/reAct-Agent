import type {
  ConversationTurn,
  InteractionEvent,
  LineageLink,
  LineageSourceKind,
  MemoryAtom,
  MemoryRecallFallback,
  MemoryScenario,
  NewConversationTurn,
  NewInteractionEvent,
  NewLineageLink,
  NewMemoryAtom,
  NewMemoryScenario,
  NewOffloadRef,
  NewPersonaProfile,
  NewTaskGraphNode,
  OffloadRef,
  PersonaProfile,
  PipelineCheckpointValue,
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
  getTaskCanvas(chatId: string): Promise<string | undefined>;
  getOffloadPath(chatId: string, nodeId: string): Promise<{ absolutePath: string; relativePath: string }>;
  getTaskCanvasPath(chatId: string): Promise<string>;
  findOffloadRefByNodeId(userId: string, nodeId: string): Promise<OffloadRef | undefined>;
  findOffloadRefByFilePath(userId: string, filePath: string): Promise<OffloadRef | undefined>;
  insertOffloadRef(ref: NewOffloadRef): Promise<number>;
  countOffloadRefs(userId: string): Promise<number>;
  insertTaskGraphNode(node: NewTaskGraphNode): Promise<number>;
  insertOffloadRefWithTaskGraphNode(ref: NewOffloadRef, node: NewTaskGraphNode): Promise<void>;
  deleteOffloadMetadata(nodeId: string): Promise<void>;
  listTaskGraphNodes(chatId: string, limit: number): Promise<TaskGraphNode[]>;
  getCheckpoint(userId: string, key: string): Promise<PipelineCheckpointValue | undefined>;
  setCheckpoint(userId: string, key: string, value: PipelineCheckpointValue): Promise<void>;
}
