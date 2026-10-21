// Záložní úložiště workflow v prohlížeči.
//
// Workflow editor umí ukládat projekty na lokální disk, což je v serverless
// nasazení nedostupné (API pro filesystem je v produkci vypnuté). Aby šel editor
// používat i v cloudu, ukládá se projekt v takovém případě do localStorage.

const KEY_PREFIX = "mulen-workflow-project:";
const MAX_BYTES = 4 * 1024 * 1024;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isBrowserStorageAvailable(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const probe = "__mulen_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Uloží workflow do prohlížeče. Vrací chybu, když se nevejde nebo je úložiště zakázané. */
export function saveWorkflowToBrowser(workflowId: string, workflow: unknown): string | null {
  const store = storage();
  if (!store) return "Prohlížeč nedovolil lokální úložiště.";

  let payload: string;
  try {
    payload = JSON.stringify(workflow);
  } catch {
    return "Workflow se nepodařilo serializovat.";
  }

  if (payload.length > MAX_BYTES) {
    return 'Projekt je příliš velký pro úložiště prohlížeče (limit 4 MB). Zmenši vložené obrázky nebo použij "Open project" se souborem .json.';
  }

  try {
    store.setItem(KEY_PREFIX + workflowId, payload);
    return null;
  } catch {
    return "Úložiště prohlížeče je plné. Smaž starší projekty nebo použij soubor .json.";
  }
}

export function loadWorkflowFromBrowser<T = unknown>(workflowId: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY_PREFIX + workflowId);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function removeWorkflowFromBrowser(workflowId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY_PREFIX + workflowId);
  } catch {
    // ignore
  }
}
