import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBrowserStorageAvailable,
  loadWorkflowFromBrowser,
  removeWorkflowFromBrowser,
  saveWorkflowToBrowser,
} from "@/store/utils/browserWorkflowStorage";

const workflow = { version: 1, id: "wf-1", name: "Test", nodes: [], edges: [] };

describe("browserWorkflowStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uloží a načte workflow z prohlížeče", () => {
    expect(saveWorkflowToBrowser("wf-1", workflow)).toBeNull();
    expect(loadWorkflowFromBrowser("wf-1")).toEqual(workflow);
  });

  it("vrátí null pro neznámé workflow", () => {
    expect(loadWorkflowFromBrowser("nezname")).toBeNull();
  });

  it("odmítne příliš velký projekt místo tichého selhání", () => {
    const huge = { version: 1, id: "wf-2", name: "Huge", nodes: [], edges: [], blob: "x".repeat(5 * 1024 * 1024) };
    const error = saveWorkflowToBrowser("wf-2", huge);
    expect(error).toContain("příliš velký");
    expect(loadWorkflowFromBrowser("wf-2")).toBeNull();
  });

  it("smaže uložený projekt", () => {
    saveWorkflowToBrowser("wf-3", workflow);
    removeWorkflowFromBrowser("wf-3");
    expect(loadWorkflowFromBrowser("wf-3")).toBeNull();
  });

  it("nahlásí nedostupné úložiště místo výjimky", () => {
    expect(typeof isBrowserStorageAvailable()).toBe("boolean");
  });
});
