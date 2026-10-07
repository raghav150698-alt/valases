export type PracticalTask = {
  title?: string; description?: string; instructions?: string;
  metadata?: Record<string, unknown>; expected_output?: Record<string, unknown>;
  grading_config?: { checkpoints?: Array<{ id: string; label: string; weight: number; expected: unknown }> };
};
export function createPracticalTrial(task: PracticalTask, previousIds: string[] = [], choose?: (length: number) => number): PracticalTask {
  const bank = task.metadata?.case_bank as { version: number; cases: PracticalTask[] } | undefined;
  if (!bank?.cases?.length) return structuredClone(task);
  const fresh = bank.cases.filter(row => !previousIds.includes(String(row.metadata?.case_id)));
  const choices = fresh.length ? fresh : bank.cases;
  let index: number;
  if (choose) index = choose(choices.length);
  else {
    const random = new Uint32Array(1), bound = Math.floor(2 ** 32 / choices.length) * choices.length;
    do { crypto.getRandomValues(random); } while (random[0] >= bound);
    index = random[0] % choices.length;
  }
  const selected = structuredClone(choices[index]);
  selected.metadata = { ...selected.metadata, case_selection: { case_id: selected.metadata?.case_id, bank_version: bank.version, case_count: bank.cases.length } };
  return selected;
}
