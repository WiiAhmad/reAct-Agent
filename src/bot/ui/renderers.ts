function normalizeLines(lines: string[]): string {
  return lines.filter(Boolean).join("\n");
}

export function buildRichMemorySummary(input: {
  memoryStatus: string;
  recall: {
    persona?: string;
    atoms: Array<{ id: number; text: string; importance: number }>;
    scenarios: Array<{ id: number; title: string }>;
    taskCanvas?: string;
  };
  memoryUpdateSummary: string;
}): string {
  const persona = input.recall.persona?.trim() || "Belum ada L3 persona.";
  const scenarios = input.recall.scenarios.length
    ? input.recall.scenarios.map((scenario) => `- #${scenario.id}: ${scenario.title}`).join("\n")
    : "Belum ada scenario.";
  const atoms = input.recall.atoms.length
    ? input.recall.atoms.map((atom) => `- #${atom.id}: ${atom.text}`).join("\n")
    : "Belum ada memory atom.";
  const activeCanvas = input.recall.taskCanvas ? "Active canvas: yes" : "Active canvas: no";

  return normalizeLines([
    "# Memory status",
    input.memoryStatus.trim(),
    "",
    "# L3 Persona snapshot",
    persona,
    "",
    "# L2 Scenarios summary",
    scenarios,
    "",
    "# Top L1 atoms",
    atoms,
    "",
    "# Active canvas",
    activeCanvas,
    "",
    "# Memory Update summary",
    input.memoryUpdateSummary.trim(),
  ]);
}

export function renderStartScreen(): string {
  return normalizeLines([
    "Halo. Bot siap.",
    "",
    "Gunakan Menu untuk navigasi, atau Help untuk ringkasan perintah publik.",
    "Perintah publik: /start, /menu, /help.",
  ]);
}

export function renderMainMenuScreen(): string {
  return normalizeLines([
    "Menu utama",
    "",
    "Memory membuka ringkasan memory dan pengaturan Memory Update.",
    "Jobs membuka pengelolaan autonomous jobs dari menu.",
    "Help menampilkan perintah publik dan panduan singkat.",
  ]);
}

export function renderHelpScreen(): string {
  return normalizeLines([
    "Help",
    "",
    "Perintah publik:",
    "/start - buka start screen",
    "/menu - buka menu utama",
    "/help - tampilkan bantuan ini",
    "",
    "Memory Update dan Jobs tersedia dari menu, bukan lewat command tambahan.",
  ]);
}

export function renderMemorySummaryScreen(summary: string): string {
  return normalizeLines([
    "Memory summary",
    "",
    "Memory Update dikelola dari menu.",
    "",
    summary.trim(),
  ]);
}

export function renderJobsScreen(summary: string): string {
  return normalizeLines([
    "Jobs",
    "",
    "Autonomous jobs dikelola dari menu.",
    "",
    summary.trim(),
  ]);
}
