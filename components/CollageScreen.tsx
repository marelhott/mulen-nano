import React from 'react';
import { ImageModelSelector } from './ImageModelSelection';
import { imageModelInputError } from '../constants/imageModels';
import { Images, Trash2, X } from 'lucide-react';
import { ImageComparisonModal } from './ImageComparisonModal';
import { AtelierEmptyState, AtelierRightPanel, AtelierSection } from './atelier/AtelierLayout';
import { ModelGrids, type VariantOutput } from './VariantsScreen';
import { AIProviderType, type ProviderSettings } from '../services/aiProvider';
import { ProviderFactory } from '../services/providerFactory';
import { fileToDataUrl, resolveDropToFile } from './styleTransfer/utils';
import { createThumbnail, saveToGallery } from '../utils/galleryDB';
import { ImageDatabase } from '../utils/imageDatabase';
import { buildBatchRecipe } from '../utils/generationRecipe';
import { toUserFacingAiError } from '../utils/aiErrorMessage';
import { decideAdaptiveConcurrency, estimateDataUrlBytes, runConcurrentTasks } from '../utils/concurrencyRunner';
import { optimizeVariantsInput } from '../utils/variantsInput';
import {
  COLLAGE_GENERAL_PROMPT,
  COLLAGE_MAX_PER_MODEL,
  COLLAGE_MAX_SOURCES,
  COLLAGE_MIN_SOURCES,
  buildCollageEditInstruction,
  buildCollagePrompt,
  collageInputBudget,
  rotateInputs,
} from '../utils/collagePlan';
import {
  deleteCollageImage,
  deleteCollageRun,
  getCollageImage,
  getCollageSource,
  listCollageRuns,
  listCollageThumbs,
  saveCollageImage,
  saveCollageRun,
  type CollageRunRecord,
} from '../utils/collageHistoryDB';
import { VARIANT_MODELS, formatVariantsDate, isInstructionEditModel, planVariantTasks, variantModelById, type VariantModelId } from '../utils/variantsPlan';
import type { ToastType } from './Toast';

type SourceImage = { id: string; name: string; dataUrl: string; mimeType: string };

type HistoryRun = { run: CollageRunRecord; items: VariantOutput[] };

type Preview = { generated: string; original: string | null; prompt: string; createdAt: number };

type RunMeta = {
  createdAt: number;
  sources: Array<{ name: string; dataUrl: string; mimeType: string }>;
  prompt: string;
  models: VariantModelId[];
  countPerModel: number;
};

const DEFAULT_MODELS: VariantModelId[] = ['gpt', 'gemini', 'flux', 'seedream', 'muse'];
const HISTORY_PAGE = 5;

function makeId(prefix: string): string {
  return globalThis.crypto?.randomUUID ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStored<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // úložiště může být zakázané; nastavení se prostě nezapamatuje
  }
}

function sourcesLabel(names: string[]): string {
  return names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} dalších`;
}

function historyItems(run: CollageRunRecord, thumbs: Awaited<ReturnType<typeof listCollageThumbs>>): VariantOutput[] {
  return thumbs.map((thumb) => ({
    id: thumb.id,
    modelId: thumb.modelId,
    variantIndex: thumb.variantIndex,
    runId: run.id,
    prompt: run.prompt,
    status: 'done' as const,
    thumbUrl: thumb.thumb,
    createdAt: thumb.createdAt,
    sourceDataUrl: '',
    sourceName: 'kolaz',
  }));
}

function CollageRunHeader(props: {
  createdAt: number;
  sourceThumbs: string[];
  sourceNames: string[];
  summary: string;
  live?: boolean;
  onReuseSources?: () => void;
  onDelete?: () => void;
}) {
  const label = sourcesLabel(props.sourceNames);
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-color)] pb-2">
      <div className="flex shrink-0 -space-x-2">
        {props.sourceThumbs.slice(0, 4).map((thumb, i) => (
          <img key={i} src={thumb} alt={props.sourceNames[i] ?? ''} title={props.sourceNames[i]} className="h-9 w-9 rounded object-cover border border-[var(--border-color)]" />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-primary)]">
          {props.live ? 'Právě teď · ' : ''}{formatVariantsDate(props.createdAt)}
        </div>
        <div className="truncate text-[8px] text-[var(--text-3)]" title={`${label} · ${props.summary}`}>
          {label} · {props.summary}
        </div>
      </div>
      {props.onReuseSources ? (
        <button type="button" onClick={props.onReuseSources} className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)]">
          Použít vstupy
        </button>
      ) : null}
      {props.onDelete ? (
        <button type="button" onClick={props.onDelete} className="p-1 text-[var(--text-secondary)] hover:text-red-400" title="Smazat běh z historie">
          <Trash2 className="w-3 h-3" strokeWidth={1.6} />
        </button>
      ) : null}
    </div>
  );
}

export function CollageScreen(props: {
  providerSettings: ProviderSettings;
  onOpenSettings: () => void;
  onOpenLibrary?: () => void;
  onToast: (toast: { message: string; type: ToastType }) => void;
  theme?: 'dark' | 'light';
}) {
  const { providerSettings, onOpenSettings, onOpenLibrary, onToast, theme = 'dark' } = props;

  const [sources, setSources] = React.useState<SourceImage[]>([]);
  const [selectedModels, setSelectedModels] = React.useState<VariantModelId[]>(() =>
    readStored<VariantModelId[]>('collage.models', DEFAULT_MODELS, (raw) => {
      const ids = raw.split(',').filter((id): id is VariantModelId => VARIANT_MODELS.some((m) => m.id === id));
      return ids.length > 0 ? ids : null;
    }),
  );
  const [count, setCount] = React.useState<number>(() =>
    readStored('collage.count', 3, (raw) => {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= COLLAGE_MAX_PER_MODEL ? n : null;
    }),
  );
  const [customPrompt, setCustomPrompt] = React.useState<string>(() => readStored('collage.prompt', '', (raw) => raw));
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [outputs, setOutputs] = React.useState<VariantOutput[]>([]);
  const [currentRun, setCurrentRun] = React.useState<{ id: string; createdAt: number; sourceThumbs: string[]; sourceNames: string[]; summary: string } | null>(null);
  const [history, setHistory] = React.useState<HistoryRun[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const fileInputId = React.useMemo(() => makeId('collage-upload'), []);

  const runMeta = React.useRef(new Map<string, RunMeta>());
  const savedRuns = React.useRef(new Set<string>());
  const historyWarned = React.useRef(false);

  const activePrompt = React.useMemo(() => buildCollagePrompt(customPrompt), [customPrompt]);
  const totalImages = selectedModels.length * count;
  const errorCount = outputs.filter((item) => item.status === 'error').length;
  const canGenerate = sources.length >= COLLAGE_MIN_SOURCES && selectedModels.length > 0 && !isGenerating;

  // --- historie -------------------------------------------------------------------------------

  const historyLoading = React.useRef(false);
  const historyEnd = React.useRef<number | undefined>(undefined);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const fetchHistoryPage = React.useCallback(async (reset: boolean) => {
    if (historyLoading.current) return;
    historyLoading.current = true;
    try {
      const runs = await listCollageRuns(HISTORY_PAGE, reset ? undefined : historyEnd.current);
      const loaded: HistoryRun[] = [];
      for (const run of runs) {
        loaded.push({ run, items: historyItems(run, await listCollageThumbs(run.id)) });
      }
      if (runs.length > 0) historyEnd.current = runs[runs.length - 1].createdAt;
      setHistory((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((entry) => entry.run.id));
        return [...base, ...loaded.filter((entry) => !seen.has(entry.run.id))];
      });
      setHasMoreHistory(runs.length >= HISTORY_PAGE);
    } catch (error) {
      console.error('Historie Koláže se nenačetla', error);
    } finally {
      historyLoading.current = false;
    }
  }, []);

  const loadHistory = React.useCallback(() => fetchHistoryPage(true), [fetchHistoryPage]);

  React.useEffect(() => {
    void fetchHistoryPage(true);
  }, [fetchHistoryPage]);

  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMoreHistory) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchHistoryPage(false);
      },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchHistoryPage, hasMoreHistory, history.length]);

  const handleDeleteImage = React.useCallback(
    async (output: VariantOutput) => {
      setOutputs((prev) => prev.filter((item) => item.id !== output.id));
      setHistory((prev) => prev.map((entry) => ({ ...entry, items: entry.items.filter((item) => item.id !== output.id) })).filter((entry) => entry.items.length > 0));
      try {
        await deleteCollageImage(output.id);
      } catch (error) {
        onToast({ message: toUserFacingAiError(error, 'Smazání obrázku selhalo.'), type: 'error' });
      }
    },
    [onToast],
  );

  const handleDeleteRun = React.useCallback(
    async (runId: string) => {
      if (!window.confirm('Smazat tento běh včetně všech jeho obrázků z historie?')) return;
      try {
        await deleteCollageRun(runId);
        await loadHistory();
      } catch (error) {
        onToast({ message: toUserFacingAiError(error, 'Smazání z historie selhalo.'), type: 'error' });
      }
    },
    [loadHistory, onToast],
  );

  const handleReuseSources = React.useCallback(
    async (run: CollageRunRecord) => {
      try {
        const stored = await getCollageSource(run.id);
        if (!stored || stored.sources.length === 0) {
          onToast({ message: 'Vstupy tohoto běhu už v historii nejsou.', type: 'warning' });
          return;
        }
        setSources(stored.sources.slice(0, COLLAGE_MAX_SOURCES).map((item) => ({ id: makeId('collage-src'), ...item })));
        onToast({ message: 'Vstupy načteny z historie.', type: 'info' });
      } catch (error) {
        onToast({ message: toUserFacingAiError(error, 'Vstupy se nepodařilo načíst.'), type: 'error' });
      }
    },
    [onToast],
  );

  const handleOpen = React.useCallback(
    async (output: VariantOutput) => {
      if (output.dataUrl) {
        setPreview({ generated: output.dataUrl, original: output.sourceDataUrl || null, prompt: output.prompt, createdAt: output.createdAt });
        return;
      }
      try {
        const [image, stored] = await Promise.all([getCollageImage(output.id), getCollageSource(output.runId)]);
        if (!image) {
          onToast({ message: 'Plný obrázek už v historii není.', type: 'warning' });
          return;
        }
        setPreview({ generated: image.dataUrl, original: stored?.sources[0]?.dataUrl ?? null, prompt: output.prompt, createdAt: output.createdAt });
      } catch (error) {
        onToast({ message: toUserFacingAiError(error, 'Obrázek se nepodařilo otevřít.'), type: 'error' });
      }
    },
    [onToast],
  );

  const persistCollage = React.useCallback(
    async (output: VariantOutput, imageDataUrl: string) => {
      try {
        const meta = runMeta.current.get(output.runId);
        if (meta && !savedRuns.current.has(output.runId)) {
          savedRuns.current.add(output.runId);
          try {
            const sourceThumbs = await Promise.all(meta.sources.map((item) => createThumbnail(item.dataUrl, 200)));
            await saveCollageRun(
              {
                id: output.runId,
                createdAt: meta.createdAt,
                sourceNames: meta.sources.map((item) => item.name),
                sourceThumbs,
                prompt: meta.prompt,
                models: meta.models,
                countPerModel: meta.countPerModel,
              },
              { runId: output.runId, sources: meta.sources },
            );
          } catch (error) {
            savedRuns.current.delete(output.runId);
            throw error;
          }
        }
        const thumb = await createThumbnail(imageDataUrl, 360);
        await saveCollageImage(
          { id: output.id, runId: output.runId, modelId: output.modelId, variantIndex: output.variantIndex, createdAt: Date.now(), dataUrl: imageDataUrl },
          thumb,
        );
      } catch {
        if (!historyWarned.current) {
          historyWarned.current = true;
          onToast({ message: 'Obrázky se nepodařilo uložit do historie Koláže (zkontroluj místo v prohlížeči).', type: 'warning' });
        }
      }
    },
    [onToast],
  );

  // --- vstupy a nastavení ---------------------------------------------------------------------

  const toggleModel = React.useCallback((id: VariantModelId) => {
    setSelectedModels((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      writeStored('collage.models', next.join(','));
      return next;
    });
  }, []);

  const addFiles = React.useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith('image/'));
      if (images.length === 0) return;
      const loaded: SourceImage[] = [];
      for (const file of images) {
        const dataUrl = await fileToDataUrl(file);
        loaded.push({ id: makeId('collage-src'), name: file.name, dataUrl, mimeType: file.type || 'image/jpeg' });
        try {
          await ImageDatabase.add(file, dataUrl, 'reference');
        } catch {
          // lokální knihovna nesmí blokovat generování
        }
      }
      setSources((prev) => {
        const room = COLLAGE_MAX_SOURCES - prev.length;
        if (loaded.length > room) onToast({ message: `Nejvýš ${COLLAGE_MAX_SOURCES} vstupních obrázků.`, type: 'warning' });
        return [...prev, ...loaded.slice(0, Math.max(0, room))];
      });
    },
    [onToast],
  );

  const handleDrop = React.useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      try {
        const dropped = Array.from(e.dataTransfer.files as FileList).filter((f) => f.type.startsWith('image/'));
        if (dropped.length > 0) {
          await addFiles(dropped);
          return;
        }
        const file = await resolveDropToFile(e);
        if (file) await addFiles([file]);
      } catch (error: any) {
        onToast({ message: error?.message || 'Nepodařilo se vložit obrázek.', type: 'error' });
      }
    },
    [addFiles, onToast],
  );

  // --- generování -----------------------------------------------------------------------------

  const runTasks = React.useCallback(
    async (targets: VariantOutput[], runSources: Array<{ name: string; dataUrl: string; mimeType: string }>) => {
      const budget = collageInputBudget(runSources.length);
      const prepared = await Promise.all(runSources.map((item) => optimizeVariantsInput(item.dataUrl, item.mimeType, budget)));
      const bytes = prepared.reduce((sum, item) => sum + estimateDataUrlBytes(item.data), 0);
      const decision = decideAdaptiveConcurrency({ section: 'batch', itemCount: targets.length, averageBytes: bytes, maxBytes: bytes });
      const inputs = prepared.map((item) => ({ data: item.data, mimeType: item.mimeType }));

      const results = await runConcurrentTasks({
        items: targets,
        concurrency: decision.concurrency,
        onTaskStateChange: ({ index, status, attempt }) => {
          const output = targets[index];
          if (!output) return;
          setOutputs((prev) =>
            prev.map((item) =>
              item.id === output.id
                ? { ...item, status: status === 'done' ? 'done' : status === 'error' ? 'error' : status, error: status === 'error' ? item.error : undefined, attempt }
                : item,
            ),
          );
        },
        worker: async (output) => {
          const model = variantModelById(output.modelId);
          const provider = ProviderFactory.getProvider(AIProviderType.OPENROUTER, providerSettings, model.model);
          // Qwen Edit bere první vstup jako základ, proto se základní obrázek střídá podle varianty.
          const ordered = isInstructionEditModel(model.model) ? rotateInputs(inputs, output.variantIndex) : inputs;
          const result = await provider.generateImage(ordered, output.prompt, model.resolution, 'Original', false);

          setOutputs((prev) => prev.map((item) => (item.id === output.id ? { ...item, status: 'done' as const, dataUrl: result.imageBase64 } : item)));
          await persistCollage(output, result.imageBase64);

          try {
            const recipe = buildBatchRecipe({
              provider: AIProviderType.OPENROUTER,
              prompt: output.prompt,
              effectivePrompt: output.prompt,
              promptMode: 'simple',
              resolution: model.resolution ?? 'Original',
              aspectRatio: 'Original',
              sourceImageCount: inputs.length,
              styleImageCount: 0,
              createdAt: Date.now(),
            });
            const thumbnail = await createThumbnail(result.imageBase64);
            await saveToGallery({
              id: output.id,
              url: result.imageBase64,
              thumbnail,
              prompt: output.prompt,
              resolution: model.resolution ?? 'Original',
              aspectRatio: 'Original',
              params: { ...recipe, section: 'Koláž', modelId: result.modelId || model.model, runId: output.runId },
            });
          } catch {
            // galerie nesmí shodit běh
          }
          return result;
        },
      });

      let succeeded = 0;
      let failed = 0;
      results.forEach((entry) => {
        const output = targets[entry.index];
        if (!output) return;
        if (entry.status === 'fulfilled') {
          succeeded += 1;
          return;
        }
        failed += 1;
        setOutputs((prev) =>
          prev.map((item) =>
            item.id === output.id
              ? { ...item, status: 'error', error: toUserFacingAiError(entry.error, 'Koláž selhala.'), attempt: entry.attempts }
              : item,
          ),
        );
      });
      return { succeeded, failed };
    },
    [persistCollage, providerSettings],
  );

  const reportResult = React.useCallback(
    (succeeded: number, failed: number) => {
      if (succeeded > 0 && failed === 0) onToast({ message: `Koláže hotové. Vzniklo ${succeeded} obrázků.`, type: 'success' });
      else if (succeeded > 0) onToast({ message: `Koláže dokončeny částečně: ${succeeded} hotovo, ${failed} selhalo.`, type: 'warning' });
      else onToast({ message: 'Všechny koláže selhaly.', type: 'error' });
    },
    [onToast],
  );

  const runSourcesRef = React.useRef<Array<{ name: string; dataUrl: string; mimeType: string }>>([]);

  const handleGenerate = React.useCallback(async () => {
    if (sources.length < COLLAGE_MIN_SOURCES) {
      onToast({ message: `Vlož aspoň ${COLLAGE_MIN_SOURCES} obrázky.`, type: 'error' });
      return;
    }
    if (selectedModels.length === 0) {
      onToast({ message: 'Vyber aspoň jeden model.', type: 'error' });
      return;
    }
    const incompatible = selectedModels.map((id) => imageModelInputError(variantModelById(id).model, sources.length)).find(Boolean);
    if (incompatible) {
      onToast({ type: 'error', message: incompatible });
      return;
    }
    setIsGenerating(true);
    historyWarned.current = false;
    const runId = makeId('collage-run');
    const runCreatedAt = Date.now();
    const runSources = sources.map(({ name, dataUrl, mimeType }) => ({ name, dataUrl, mimeType }));
    runSourcesRef.current = runSources;
    const tasks = planVariantTasks(selectedModels, count, (modelId, index) => makeId(`collage-${modelId}-${index}`));
    const pending: VariantOutput[] = tasks.map((task, i) => ({
      id: task.id,
      modelId: task.modelId,
      variantIndex: task.variantIndex,
      runId,
      // Vlastní prompt platí pro všechny modely; výchozí Qwen nahradí instrukcí „uprav obrázek 1…“.
      prompt: customPrompt.trim().length === 0 && isInstructionEditModel(variantModelById(task.modelId).model) ? buildCollageEditInstruction(runSources.length) : activePrompt,
      status: 'pending' as const,
      createdAt: runCreatedAt + i,
      sourceDataUrl: runSources[0].dataUrl,
      sourceName: 'kolaz',
    }));
    const modelsUsed = VARIANT_MODELS.filter((m) => selectedModels.includes(m.id)).map((m) => m.id);
    runMeta.current.set(runId, { createdAt: runCreatedAt, sources: runSources, prompt: activePrompt, models: modelsUsed, countPerModel: count });
    const sourceThumbs = await Promise.all(runSources.map((item) => createThumbnail(item.dataUrl, 120).catch(() => '')));
    setCurrentRun({
      id: runId,
      createdAt: runCreatedAt,
      sourceThumbs,
      sourceNames: runSources.map((item) => item.name),
      summary: `${modelsUsed.map((id) => variantModelById(id).title).join(', ')} · ${count}× na model · ${runSources.length} vstupy`,
    });
    setOutputs(pending);
    void loadHistory();
    try {
      const { succeeded, failed } = await runTasks(pending, runSources);
      reportResult(succeeded, failed);
    } catch (error) {
      onToast({ message: toUserFacingAiError(error, 'Koláže se nepodařilo spustit.'), type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [activePrompt, count, customPrompt, loadHistory, onToast, reportResult, runTasks, selectedModels, sources]);

  const handleRetryFailed = React.useCallback(async () => {
    const failedOutputs = outputs.filter((item) => item.status === 'error');
    if (failedOutputs.length === 0 || runSourcesRef.current.length === 0) return;
    setIsGenerating(true);
    const ids = new Set(failedOutputs.map((item) => item.id));
    setOutputs((prev) => prev.map((item) => (ids.has(item.id) ? { ...item, status: 'pending' as const, error: undefined, attempt: undefined } : item)));
    try {
      const { succeeded, failed } = await runTasks(failedOutputs.map((item) => ({ ...item, status: 'pending' as const })), runSourcesRef.current);
      reportResult(succeeded, failed);
    } catch (error) {
      onToast({ message: toUserFacingAiError(error, 'Opakování selhalo.'), type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [onToast, outputs, reportResult, runTasks]);

  return (
    <div className="flex-1 relative flex min-w-0 canvas-surface h-full overflow-hidden">
      <aside
        className="w-[360px] shrink-0 h-full overflow-y-auto custom-scrollbar cairn-panel-left text-[11px]"
        style={
          theme === 'dark'
            ? {
                backdropFilter: 'blur(32px) saturate(200%)',
                background: 'linear-gradient(160deg,rgba(32,44,24,0.94) 0%,rgba(20,28,15,0.96) 100%)',
                boxShadow: '4px 0 48px rgba(0,0,0,0.50), inset 0 0 120px rgba(125,154,100,0.08)',
              }
            : {
                background: '#ffffff',
                borderRight: '1px solid #cdd8ba',
              }
        }
      >
        <div className="p-6 flex flex-col gap-6 min-h-full">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-4 bg-[#a8bf8f] rounded-full shadow-[0_0_10px_rgba(168,191,143,0.5)]" />
            <h2 className="text-[11px] font-[900] uppercase tracking-[0.3em] text-gray-200">Koláž</h2>
          </div>

          <button type="button" onClick={handleGenerate} disabled={!canGenerate} className="mn-action-primary">
            {isGenerating ? 'Běží…' : totalImages > 0 ? `Generovat ${totalImages} koláží` : 'Generovat'}
          </button>

          {errorCount > 0 && !isGenerating && (
            <button
              type="button"
              onClick={handleRetryFailed}
              className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-amber-400 transition-all hover:border-amber-500/60 hover:bg-amber-500/20"
            >
              Retry {errorCount} selhalo
            </button>
          )}

          <div className="space-y-1">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Počet na model</h3>
            <div className="mn-count-selector">
              {Array.from({ length: COLLAGE_MAX_PER_MODEL }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setCount(n);
                    writeStored('collage.count', String(n));
                  }}
                  className={`mn-count-option ${count === n ? 'mn-count-option-active' : ''}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              Vstupy ({sources.length}/{COLLAGE_MAX_SOURCES}, min. {COLLAGE_MIN_SOURCES})
            </h3>
            <div
              className={`mn-upload-zone ${dragActive ? 'border-[var(--accent)] bg-[var(--accent)]/5' : ''}`}
              style={{ minHeight: 160 }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
              }}
              onDrop={handleDrop}
            >
              {sources.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5 p-1.5">
                  {sources.map((item) => (
                    <div key={item.id} className="group relative aspect-square overflow-hidden rounded bg-[var(--bg-panel)]">
                      <img src={item.dataUrl} alt={item.name} title={item.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setSources((prev) => prev.filter((entry) => entry.id !== item.id))}
                        className="absolute right-1 top-1 rounded bg-black/70 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        title="Odebrat"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                  {sources.length < COLLAGE_MAX_SOURCES ? (
                    <button
                      type="button"
                      onClick={() => document.getElementById(fileInputId)?.click()}
                      className="flex aspect-square items-center justify-center rounded border border-dashed border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                      title="Přidat obrázek"
                    >
                      +
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center cursor-pointer gap-2" onClick={() => document.getElementById(fileInputId)?.click()}>
                  <Images className="w-5 h-5 text-[var(--text-secondary)]" strokeWidth={1.6} />
                  <span className="text-[9px] font-semibold text-[var(--text-secondary)]">Přetáhni 2 a více obrazů nebo klikni</span>
                </div>
              )}
              <input
                id={fileInputId}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void addFiles(Array.from(e.target.files ?? []));
                  e.currentTarget.value = '';
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setShowPrompt((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg border border-[rgba(168,191,143,0.18)] bg-[linear-gradient(135deg,rgba(35,48,26,0.70)_0%,rgba(20,28,15,0.80)_100%)] px-2 py-1"
            >
              <span className="pl-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--text-primary)]">Obecný prompt</span>
              <span className="pr-0.5 text-[9px] text-[var(--text-secondary)]">{showPrompt ? '−' : '+'}</span>
            </button>
            {showPrompt ? (
              <>
                <textarea
                  value={customPrompt.trim().length === 0 ? COLLAGE_GENERAL_PROMPT : customPrompt}
                  onChange={(e) => {
                    const value = e.target.value;
                    const next = value === COLLAGE_GENERAL_PROMPT ? '' : value;
                    setCustomPrompt(next);
                    writeStored('collage.prompt', next);
                  }}
                  className="w-full min-h-[260px] max-h-[360px] resize-none rounded-none border-0 border-b border-[var(--border-color)] bg-transparent p-1.5 text-[10px] font-medium text-[var(--text-primary)] placeholder-gray-500 outline-none transition-all focus:border-[var(--accent)] focus:ring-0 custom-scrollbar"
                />
                <div className="flex items-center justify-between text-[8px] text-[var(--text-3)]">
                  <span>{customPrompt.trim().length === 0 ? 'Výchozí znění' : 'Upraveno'}</span>
                  <button
                    type="button"
                    disabled={customPrompt.trim().length === 0}
                    onClick={() => {
                      setCustomPrompt('');
                      writeStored('collage.prompt', '');
                    }}
                    className="font-bold uppercase tracking-wider hover:text-[var(--accent)] disabled:opacity-40"
                  >
                    Obnovit výchozí
                  </button>
                </div>
              </>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full px-3 py-2 rounded-lg border border-[rgba(168,191,143,0.18)] bg-[rgba(24,34,18,0.70)] backdrop-blur-sm text-[10px] font-bold uppercase tracking-widest text-white/70 hover:text-white transition-colors"
          >
            Settings
          </button>
        </div>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col h-full overflow-y-auto custom-scrollbar">
        <div className="p-5 space-y-8">
          {currentRun && outputs.length > 0 ? (
            <div className="space-y-3">
              <CollageRunHeader live createdAt={currentRun.createdAt} sourceThumbs={currentRun.sourceThumbs} sourceNames={currentRun.sourceNames} summary={currentRun.summary} />
              <ModelGrids items={outputs} onOpen={handleOpen} onDelete={handleDeleteImage} />
            </div>
          ) : null}

          {history.filter(({ run }) => run.id !== currentRun?.id).map(({ run, items }) => (
            <div key={run.id} className="space-y-3">
              <CollageRunHeader
                createdAt={run.createdAt}
                sourceThumbs={run.sourceThumbs}
                sourceNames={run.sourceNames}
                summary={`${run.models.map((id) => variantModelById(id).title).join(', ')} · ${run.countPerModel}× na model · ${items.length} obr.`}
                onReuseSources={() => void handleReuseSources(run)}
                onDelete={() => void handleDeleteRun(run.id)}
              />
              <ModelGrids items={items} onOpen={handleOpen} onDelete={handleDeleteImage} />
            </div>
          ))}

          {hasMoreHistory ? <div ref={sentinelRef} className="h-10 text-center text-[8px] font-bold uppercase tracking-widest text-[var(--text-3)]">Načítám starší…</div> : null}

          {outputs.length === 0 && history.length === 0 ? (
            <AtelierEmptyState
              title="Zatím žádné koláže"
              description="Vlož dva a více obrazů vlevo, vyber modely vpravo a spusť. Z nich vznikne jedno sjednocené umělecké dílo, ve kterém se nápady prolnou (ne doslovná koláž), podle hesla méně je více. Každý běh se ukládá do historie i se vstupy."
            />
          ) : null}
        </div>
      </section>

      <AtelierRightPanel onOpenLibrary={onOpenLibrary} modelSelector={false}>
        <ImageModelSelector inputCount={sources.length} selected={selectedModels.map((id) => variantModelById(id).model)}
          onSelect={(model) => { const item = VARIANT_MODELS.find((entry) => entry.model === model); if (item) toggleModel(item.id); }} disabled={isGenerating} />

        <AtelierSection title="Aktivní Prompt">
          <div className="rounded-md border border-[rgba(168,191,143,0.18)] bg-[rgba(28,40,20,0.70)] px-3 py-3">
            <div className="text-[8px] font-black uppercase tracking-[0.18em] text-[var(--accent)]">
              {customPrompt.trim().length === 0 ? 'Obecný prompt' : 'Upravený prompt'}
            </div>
            <p className="mt-2 max-h-[260px] overflow-y-auto custom-scrollbar whitespace-pre-wrap text-[8px] leading-relaxed text-[var(--text-secondary)]">{activePrompt}</p>
          </div>
        </AtelierSection>
      </AtelierRightPanel>

      <ImageComparisonModal
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        generatedImage={preview?.generated || null}
        originalImage={preview?.original || null}
        prompt={preview?.prompt || activePrompt}
        timestamp={preview?.createdAt}
        resolution="1K"
        aspectRatio="Original"
      />
    </div>
  );
}
