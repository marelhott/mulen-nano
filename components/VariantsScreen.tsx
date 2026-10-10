import React from 'react';
import { Download, Images, Trash2, X } from 'lucide-react';
import { ImageComparisonModal } from './ImageComparisonModal';
import { AtelierEmptyState, AtelierInfoRows, AtelierRightPanel, AtelierSection } from './atelier/AtelierLayout';
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
  deleteVariantsRun,
  getVariantsImage,
  getVariantsSource,
  listVariantsRuns,
  listVariantsThumbs,
  saveVariantsImage,
  saveVariantsRun,
  type VariantsRunRecord,
} from '../utils/variantsHistoryDB';
import {
  VARIANTS_DISTANCES,
  VARIANTS_GENERAL_PROMPT,
  VARIANTS_MAX_PER_MODEL,
  VARIANT_MODELS,
  buildVariantsPrompt,
  formatVariantsDate,
  planVariantTasks,
  variantModelById,
  type VariantModelId,
  type VariantsDistance,
} from '../utils/variantsPlan';
import type { ToastType } from './Toast';

type SourceImage = { name: string; dataUrl: string; mimeType: string };

type OutputStatus = 'pending' | 'running' | 'retrying' | 'done' | 'error';

type VariantOutput = {
  id: string;
  modelId: VariantModelId;
  variantIndex: number;
  runId: string;
  prompt: string;
  status: OutputStatus;
  /** Plný obraz (jen u živého běhu; u historie se dočítá z databáze při otevření). */
  dataUrl?: string;
  /** Miniatura z historie. */
  thumbUrl?: string;
  error?: string;
  attempt?: number;
  createdAt: number;
  sourceDataUrl: string;
  sourceName: string;
};

type HistoryRun = { run: VariantsRunRecord; items: VariantOutput[] };

type Preview = { generated: string; original: string | null; prompt: string; createdAt: number };

type RunMeta = {
  createdAt: number;
  sourceName: string;
  sourceData: string;
  mimeType: string;
  prompt: string;
  distance: VariantsDistance;
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

function historyItems(run: VariantsRunRecord, thumbs: Awaited<ReturnType<typeof listVariantsThumbs>>): VariantOutput[] {
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
    sourceName: run.sourceName,
  }));
}

// --- Karta a mřížka (šest náhledů na řádek) ---------------------------------------------------

function VariantCard(props: { output: VariantOutput; onOpen: (output: VariantOutput) => void }) {
  const { output, onOpen } = props;
  const model = variantModelById(output.modelId);
  const image = output.thumbUrl || output.dataUrl;
  const isDone = output.status === 'done' && !!image;

  return (
    <article className="group flex flex-col overflow-hidden card-surface card-surface-hover transition-all">
      <button
        type="button"
        className="relative bg-[var(--bg-panel)] cursor-zoom-in aspect-square overflow-hidden text-left"
        onClick={() => {
          if (isDone) onOpen(output);
        }}
      >
        {isDone ? (
          <img src={image} alt={`${model.title} ${output.variantIndex + 1}`} className="w-full h-full object-contain" loading="lazy" />
        ) : output.status === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-2 text-center bg-black/80 backdrop-blur-sm">
            <div className="w-6 h-6 bg-red-500/20 text-red-500 border border-red-500/30 rounded-md flex items-center justify-center mb-2">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
            <p className="text-[8px] font-bold text-red-400 leading-snug line-clamp-5" title={output.error}>{output.error}</p>
          </div>
        ) : (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md px-3 transition-all duration-300">
            <div className="w-full space-y-2">
              <div className="relative h-[2px] bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-[#a8bf8f] rounded-full shadow-[0_0_10px_rgba(126,217,87,0.5)]"
                  style={{ width: '0%', animation: 'growWidth 60s cubic-bezier(0.4, 0, 0.2, 1) forwards' }}
                />
              </div>
              <div className="text-center">
                <span className="text-[8px] text-[#a8bf8f] font-bold tracking-widest uppercase animate-pulse">
                  {output.status === 'retrying' ? `Opakuji ${Math.min(output.attempt || 2, 3)}/3` : output.status === 'running' ? 'Generuji' : 'Čeká'}
                </span>
              </div>
            </div>
          </div>
        )}
      </button>

      <div className="px-2 py-1.5 flex items-center justify-between gap-1 border-t border-[rgba(168,191,143,0.12)] bg-[linear-gradient(135deg,rgba(28,38,22,0.85)_0%,rgba(16,22,12,0.90)_100%)]">
        <div className="min-w-0 text-[8px] font-black uppercase tracking-[0.14em] text-[var(--text-secondary)] truncate">#{output.variantIndex + 1}</div>
        {isDone ? (
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              const href = output.dataUrl || (await getVariantsImage(output.id))?.dataUrl;
              if (!href) return;
              const link = document.createElement('a');
              link.href = href;
              link.download = `${output.sourceName.replace(/\.[^.]+$/, '')}-${model.id}-${output.variantIndex + 1}.png`;
              link.click();
            }}
            className="p-1 text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[color:var(--selection-surface)] rounded transition-colors"
            title="Stáhnout"
          >
            <Download className="w-3 h-3" strokeWidth={1.6} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ModelGrids(props: { items: VariantOutput[]; onOpen: (output: VariantOutput) => void }) {
  const groups = VARIANT_MODELS.map((model) => ({
    model,
    items: props.items.filter((item) => item.modelId === model.id).sort((a, b) => a.variantIndex - b.variantIndex),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-4">
      <style>{`@keyframes growWidth { 0% { width: 0%; } 10% { width: 15%; } 40% { width: 50%; } 70% { width: 80%; } 100% { width: 95%; } }`}</style>
      {groups.map(({ model, items }) => (
        <div key={model.id} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h3 className="mn-section-label">{model.title}</h3>
            <span className="text-[8px] text-[var(--text-3)]">{items.filter((item) => item.status === 'done').length}/{items.length}</span>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {items.map((output) => (
              <VariantCard key={output.id} output={output} onOpen={props.onOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RunHeader(props: {
  createdAt: number;
  sourceThumb?: string;
  sourceName: string;
  summary: string;
  live?: boolean;
  onReuseSource?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-color)] pb-2">
      {props.sourceThumb ? (
        <img src={props.sourceThumb} alt={props.sourceName} title={props.sourceName} className="h-9 w-9 shrink-0 rounded object-cover border border-[var(--border-color)]" />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-panel)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-primary)]">
          {props.live ? 'Právě teď · ' : ''}{formatVariantsDate(props.createdAt)}
        </div>
        <div className="truncate text-[8px] text-[var(--text-3)]" title={`${props.sourceName} · ${props.summary}`}>
          {props.sourceName} · {props.summary}
        </div>
      </div>
      {props.onReuseSource ? (
        <button type="button" onClick={props.onReuseSource} className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)]">
          Použít předlohu
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

// --- Obrazovka --------------------------------------------------------------------------------

export function VariantsScreen(props: {
  providerSettings: ProviderSettings;
  onOpenSettings: () => void;
  onOpenLibrary?: () => void;
  onToast: (toast: { message: string; type: ToastType }) => void;
  theme?: 'dark' | 'light';
}) {
  const { providerSettings, onOpenSettings, onOpenLibrary, onToast, theme = 'dark' } = props;

  const [source, setSource] = React.useState<SourceImage | null>(null);
  const [selectedModels, setSelectedModels] = React.useState<VariantModelId[]>(() =>
    readStored<VariantModelId[]>('variants.models', DEFAULT_MODELS, (raw) => {
      const ids = raw.split(',').filter((id): id is VariantModelId => VARIANT_MODELS.some((m) => m.id === id));
      return ids.length > 0 ? ids : null;
    }),
  );
  const [count, setCount] = React.useState<number>(() => readStored('variants.count', 4, (raw) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= VARIANTS_MAX_PER_MODEL ? n : null;
  }));
  const [distance, setDistance] = React.useState<VariantsDistance>(() =>
    readStored<VariantsDistance>('variants.distance', 'middle', (raw) => (VARIANTS_DISTANCES.some((d) => d.id === raw) ? (raw as VariantsDistance) : null)),
  );
  const [customPrompt, setCustomPrompt] = React.useState<string>(() => readStored('variants.prompt', '', (raw) => raw));
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [outputs, setOutputs] = React.useState<VariantOutput[]>([]);
  const [currentRun, setCurrentRun] = React.useState<{ id: string; createdAt: number; sourceThumb: string; sourceName: string; summary: string } | null>(null);
  const [history, setHistory] = React.useState<HistoryRun[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [activeConcurrency, setActiveConcurrency] = React.useState(4);
  const fileInputId = React.useMemo(() => makeId('variants-upload'), []);

  const runMeta = React.useRef(new Map<string, RunMeta>());
  const savedRuns = React.useRef(new Set<string>());
  const currentRunIdRef = React.useRef<string | null>(null);
  const historyWarned = React.useRef(false);
  const historyLimit = React.useRef(HISTORY_PAGE);

  const activePrompt = React.useMemo(() => buildVariantsPrompt(customPrompt, distance), [customPrompt, distance]);
  const totalImages = selectedModels.length * count;
  const completedCount = outputs.filter((item) => item.status === 'done').length;
  const errorCount = outputs.filter((item) => item.status === 'error').length;
  const runningCount = outputs.filter((item) => item.status === 'running').length;
  const retryingCount = outputs.filter((item) => item.status === 'retrying').length;
  const waitingCount = outputs.filter((item) => item.status === 'pending').length;

  // --- historie -------------------------------------------------------------------------------

  const loadHistory = React.useCallback(async (limit: number) => {
    try {
      const runs = await listVariantsRuns(limit);
      const loaded: HistoryRun[] = [];
      for (const run of runs) {
        if (run.id === currentRunIdRef.current) continue;
        loaded.push({ run, items: historyItems(run, await listVariantsThumbs(run.id)) });
      }
      historyLimit.current = limit;
      setHistory(loaded);
      setHasMoreHistory(runs.length >= limit);
    } catch {
      // historie je doplněk; bez ní se jen nezobrazí
    }
  }, []);

  React.useEffect(() => {
    void loadHistory(HISTORY_PAGE);
  }, [loadHistory]);

  const handleLoadMore = React.useCallback(() => {
    void loadHistory(historyLimit.current + HISTORY_PAGE);
  }, [loadHistory]);

  const handleDeleteRun = React.useCallback(
    async (runId: string) => {
      if (!window.confirm('Smazat tento běh včetně všech jeho obrázků z historie?')) return;
      try {
        await deleteVariantsRun(runId);
        await loadHistory(historyLimit.current);
      } catch (error) {
        onToast({ message: toUserFacingAiError(error, 'Smazání z historie selhalo.'), type: 'error' });
      }
    },
    [loadHistory, onToast],
  );

  const handleReuseSource = React.useCallback(
    async (run: VariantsRunRecord) => {
      try {
        const stored = await getVariantsSource(run.id);
        if (!stored) {
          onToast({ message: 'Předloha tohoto běhu už v historii není.', type: 'warning' });
          return;
        }
        setSource({ name: run.sourceName, dataUrl: stored.dataUrl, mimeType: stored.mimeType });
        onToast({ message: 'Předloha načtena z historie.', type: 'info' });
      } catch (error) {
        onToast({ message: toUserFacingAiError(error, 'Předlohu se nepodařilo načíst.'), type: 'error' });
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
        const [image, stored] = await Promise.all([getVariantsImage(output.id), getVariantsSource(output.runId)]);
        if (!image) {
          onToast({ message: 'Plný obrázek už v historii není.', type: 'warning' });
          return;
        }
        setPreview({ generated: image.dataUrl, original: stored?.dataUrl ?? null, prompt: output.prompt, createdAt: output.createdAt });
      } catch (error) {
        onToast({ message: toUserFacingAiError(error, 'Obrázek se nepodařilo otevřít.'), type: 'error' });
      }
    },
    [onToast],
  );

  const persistVariant = React.useCallback(
    async (output: VariantOutput, imageDataUrl: string) => {
      try {
        const meta = runMeta.current.get(output.runId);
        if (meta && !savedRuns.current.has(output.runId)) {
          savedRuns.current.add(output.runId);
          try {
            const sourceThumb = await createThumbnail(meta.sourceData, 200);
            await saveVariantsRun(
              {
                id: output.runId,
                createdAt: meta.createdAt,
                sourceName: meta.sourceName,
                sourceThumb,
                prompt: meta.prompt,
                distance: meta.distance,
                models: meta.models,
                countPerModel: meta.countPerModel,
              },
              { runId: output.runId, dataUrl: meta.sourceData, mimeType: meta.mimeType },
            );
          } catch (error) {
            savedRuns.current.delete(output.runId);
            throw error;
          }
        }
        const thumb = await createThumbnail(imageDataUrl, 360);
        await saveVariantsImage(
          { id: output.id, runId: output.runId, modelId: output.modelId, variantIndex: output.variantIndex, createdAt: Date.now(), dataUrl: imageDataUrl },
          thumb,
        );
      } catch {
        if (!historyWarned.current) {
          historyWarned.current = true;
          onToast({ message: 'Obrázky se nepodařilo uložit do historie Variant (zkontroluj místo v prohlížeči).', type: 'warning' });
        }
      }
    },
    [onToast],
  );

  // --- předloha a nastavení -------------------------------------------------------------------

  const toggleModel = React.useCallback((id: VariantModelId) => {
    setSelectedModels((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      writeStored('variants.models', next.join(','));
      return next;
    });
  }, []);

  const handleFileSelected = React.useCallback(async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await fileToDataUrl(file);
    setSource({ name: file.name, dataUrl, mimeType: file.type || 'image/jpeg' });
    try {
      await ImageDatabase.add(file, dataUrl, 'reference');
    } catch {
      // lokální knihovna nesmí blokovat generování
    }
  }, []);

  const handleDrop = React.useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      try {
        const file = await resolveDropToFile(e);
        await handleFileSelected(file ?? undefined);
      } catch (error: any) {
        onToast({ message: error?.message || 'Nepodařilo se vložit obrázek.', type: 'error' });
      }
    },
    [handleFileSelected, onToast],
  );

  // --- generování -----------------------------------------------------------------------------

  const runTasks = React.useCallback(
    async (targets: VariantOutput[], inputDataUrl: string, inputMime: string) => {
      const prepared = await optimizeVariantsInput(inputDataUrl, inputMime);
      const meta = targets[0] ? runMeta.current.get(targets[0].runId) : undefined;
      if (meta) {
        meta.sourceData = prepared.data;
        meta.mimeType = prepared.mimeType;
      }
      const bytes = estimateDataUrlBytes(prepared.data);
      const decision = decideAdaptiveConcurrency({ section: 'batch', itemCount: targets.length, averageBytes: bytes, maxBytes: bytes });
      setActiveConcurrency(decision.concurrency);

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
          const result = await provider.generateImage(
            [{ data: prepared.data, mimeType: prepared.mimeType }],
            output.prompt,
            model.resolution,
            'Original',
            false,
          );

          setOutputs((prev) => prev.map((item) => (item.id === output.id ? { ...item, status: 'done' as const, dataUrl: result.imageBase64 } : item)));
          await persistVariant(output, result.imageBase64);

          try {
            const recipe = buildBatchRecipe({
              provider: AIProviderType.OPENROUTER,
              prompt: output.prompt,
              effectivePrompt: output.prompt,
              promptMode: 'simple',
              resolution: model.resolution ?? 'Original',
              aspectRatio: 'Original',
              sourceImageCount: 1,
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
              params: { ...recipe, modelId: result.modelId || model.model, runId: output.runId },
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
              ? { ...item, status: 'error', error: toUserFacingAiError(entry.error, 'Varianta selhala.'), attempt: entry.attempts }
              : item,
          ),
        );
      });
      return { succeeded, failed };
    },
    [persistVariant, providerSettings],
  );

  const reportResult = React.useCallback(
    (succeeded: number, failed: number) => {
      if (succeeded > 0 && failed === 0) onToast({ message: `Varianty hotové. Vzniklo ${succeeded} obrázků.`, type: 'success' });
      else if (succeeded > 0) onToast({ message: `Varianty dokončeny částečně: ${succeeded} hotovo, ${failed} selhalo.`, type: 'warning' });
      else onToast({ message: 'Všechny varianty selhaly.', type: 'error' });
    },
    [onToast],
  );

  const handleGenerate = React.useCallback(async () => {
    if (!source) {
      onToast({ message: 'Nejdřív vlož předlohu.', type: 'error' });
      return;
    }
    if (selectedModels.length === 0) {
      onToast({ message: 'Vyber aspoň jeden model.', type: 'error' });
      return;
    }
    setIsGenerating(true);
    historyWarned.current = false;
    const runId = makeId('variants-run');
    const runCreatedAt = Date.now();
    const tasks = planVariantTasks(selectedModels, count, (modelId, index) => makeId(`variant-${modelId}-${index}`));
    const pending: VariantOutput[] = tasks.map((task, i) => ({
      id: task.id,
      modelId: task.modelId,
      variantIndex: task.variantIndex,
      runId,
      prompt: activePrompt,
      status: 'pending' as const,
      createdAt: runCreatedAt + i,
      sourceDataUrl: source.dataUrl,
      sourceName: source.name,
    }));
    const modelsUsed = VARIANT_MODELS.filter((m) => selectedModels.includes(m.id)).map((m) => m.id);
    runMeta.current.set(runId, {
      createdAt: runCreatedAt,
      sourceName: source.name,
      sourceData: source.dataUrl,
      mimeType: source.mimeType,
      prompt: activePrompt,
      distance,
      models: modelsUsed,
      countPerModel: count,
    });
    const sourceThumb = await createThumbnail(source.dataUrl, 120).catch(() => '');
    currentRunIdRef.current = runId;
    setCurrentRun({
      id: runId,
      createdAt: runCreatedAt,
      sourceThumb,
      sourceName: source.name,
      summary: `${modelsUsed.map((id) => variantModelById(id).title).join(', ')} · ${count}× na model · ${VARIANTS_DISTANCES.find((d) => d.id === distance)?.label}`,
    });
    setOutputs(pending);
    void loadHistory(historyLimit.current);
    try {
      const { succeeded, failed } = await runTasks(pending, source.dataUrl, source.mimeType);
      reportResult(succeeded, failed);
    } catch (error) {
      onToast({ message: toUserFacingAiError(error, 'Varianty se nepodařilo spustit.'), type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [activePrompt, count, distance, loadHistory, onToast, reportResult, runTasks, selectedModels, source]);

  const handleRetryFailed = React.useCallback(async () => {
    const failedOutputs = outputs.filter((item) => item.status === 'error');
    if (failedOutputs.length === 0 || !source) return;
    setIsGenerating(true);
    const ids = new Set(failedOutputs.map((item) => item.id));
    setOutputs((prev) => prev.map((item) => (ids.has(item.id) ? { ...item, status: 'pending' as const, error: undefined, attempt: undefined } : item)));
    try {
      const { succeeded, failed } = await runTasks(failedOutputs.map((item) => ({ ...item, status: 'pending' as const })), source.dataUrl, source.mimeType);
      reportResult(succeeded, failed);
    } catch (error) {
      onToast({ message: toUserFacingAiError(error, 'Opakování selhalo.'), type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [onToast, outputs, reportResult, runTasks, source]);

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
            <h2 className="text-[11px] font-[900] uppercase tracking-[0.3em] text-gray-200">Varianty</h2>
          </div>

          <button type="button" onClick={handleGenerate} disabled={!source || selectedModels.length === 0 || isGenerating} className="mn-action-primary">
            {isGenerating ? 'Běží…' : totalImages > 0 ? `Generovat ${totalImages} variant` : 'Generovat'}
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
            <div className="grid grid-cols-5 gap-y-1 pt-1">
              {Array.from({ length: VARIANTS_MAX_PER_MODEL }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setCount(n);
                    writeStored('variants.count', String(n));
                  }}
                  className={`mn-count-option ${count === n ? 'mn-count-option-active' : ''}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Předloha</h3>
            <div
              className={`mn-upload-zone ${dragActive ? 'border-[var(--accent)] bg-[var(--accent)]/5' : ''}`}
              style={{ minHeight: 220 }}
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
              {source ? (
                <div className="mn-upload-thumb group absolute inset-2">
                  <img src={source.dataUrl} alt={source.name} className="w-full h-full object-contain opacity-90 group-hover:opacity-100" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSource(null);
                    }}
                    className="absolute top-0 right-0 p-0.5 bg-black/60 text-white opacity-0 group-hover:opacity-100"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center cursor-pointer gap-2" onClick={() => document.getElementById(fileInputId)?.click()}>
                  <Images className="w-5 h-5 text-[var(--text-secondary)]" strokeWidth={1.6} />
                  <span className="text-[9px] font-semibold text-[var(--text-secondary)]">Přetáhni obraz nebo klikni</span>
                </div>
              )}
              <input
                id={fileInputId}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void handleFileSelected(e.target.files?.[0]);
                  e.currentTarget.value = '';
                }}
              />
            </div>
            {source ? <div className="truncate text-[8px] text-[var(--text-soft)]">{source.name}</div> : null}
          </div>

          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Vzdálenost od předlohy</h3>
            <div className="grid grid-cols-3 gap-1.5">
              {VARIANTS_DISTANCES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setDistance(item.id);
                    writeStored('variants.distance', item.id);
                  }}
                  className={`mn-option-button ${distance === item.id ? 'mn-option-button-active' : ''}`}
                  title={item.hint}
                >
                  <div className="text-[8px] font-black uppercase tracking-[0.18em] leading-tight">{item.label}</div>
                </button>
              ))}
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
                  value={customPrompt.trim().length === 0 ? VARIANTS_GENERAL_PROMPT : customPrompt}
                  onChange={(e) => {
                    const value = e.target.value;
                    const next = value === VARIANTS_GENERAL_PROMPT ? '' : value;
                    setCustomPrompt(next);
                    writeStored('variants.prompt', next);
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
                      writeStored('variants.prompt', '');
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
              <RunHeader
                live
                createdAt={currentRun.createdAt}
                sourceThumb={currentRun.sourceThumb}
                sourceName={currentRun.sourceName}
                summary={currentRun.summary}
              />
              <ModelGrids items={outputs} onOpen={handleOpen} />
            </div>
          ) : null}

          {history.map(({ run, items }) => (
            <div key={run.id} className="space-y-3">
              <RunHeader
                createdAt={run.createdAt}
                sourceThumb={run.sourceThumb}
                sourceName={run.sourceName}
                summary={`${run.models.map((id) => variantModelById(id).title).join(', ')} · ${run.countPerModel}× na model · ${VARIANTS_DISTANCES.find((d) => d.id === run.distance)?.label ?? 'Střed'} · ${items.length} obr.`}
                onReuseSource={() => void handleReuseSource(run)}
                onDelete={() => void handleDeleteRun(run.id)}
              />
              <ModelGrids items={items} onOpen={handleOpen} />
            </div>
          ))}

          {hasMoreHistory ? (
            <button
              type="button"
              onClick={handleLoadMore}
              className="w-full rounded-lg border border-[rgba(168,191,143,0.18)] bg-[rgba(24,34,18,0.70)] px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-white/70 hover:text-white transition-colors"
            >
              Načíst starší
            </button>
          ) : null}

          {outputs.length === 0 && history.length === 0 ? (
            <AtelierEmptyState
              title="Zatím žádné varianty"
              description="Vlož předlohu vlevo, vyber modely vpravo a spusť. Z jednoho obrazu vznikne sada sourozenců s jinou kompozicí. Každý běh se ukládá do historie i s předlohou."
            />
          ) : null}
        </div>
      </section>

      <AtelierRightPanel onOpenLibrary={onOpenLibrary}>
        <AtelierSection title="Modely">
          <div className="grid grid-cols-1 gap-1">
            {VARIANT_MODELS.map((model) => {
              const isActive = selectedModels.includes(model.id);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => toggleModel(model.id)}
                  className={`mn-option-button ${isActive ? 'mn-option-button-active' : ''}`}
                  aria-pressed={isActive}
                >
                  <div className="text-[8px] font-black uppercase tracking-[0.18em] leading-tight">{model.title}</div>
                  <div className={`mt-0.5 text-[6px] font-semibold leading-tight ${isActive ? 'text-[var(--accent-contrast)]/80' : 'text-[var(--text-3)]'}`}>
                    {model.subtitle}
                  </div>
                </button>
              );
            })}
          </div>
          {selectedModels.includes('flux') ? (
            <div className="rounded-md border border-[rgba(168,191,143,0.12)] bg-[rgba(20,28,15,0.55)] px-3 py-2 text-[8px] leading-relaxed text-[var(--text-3)]">
              {variantModelById('flux').note}
            </div>
          ) : null}
        </AtelierSection>

        <AtelierSection title="Stav úlohy">
          <AtelierInfoRows
            rows={[
              { label: 'Modelů', value: selectedModels.length },
              { label: 'Na model', value: count },
              { label: 'Celkem', value: totalImages },
              { label: 'Vzdálenost', value: VARIANTS_DISTANCES.find((d) => d.id === distance)?.label ?? 'Střed' },
              { label: 'Souběh', value: activeConcurrency },
              { label: 'Čeká', value: waitingCount },
              { label: 'Běží', value: runningCount },
              { label: 'Retry', value: retryingCount },
              { label: 'Hotovo', value: completedCount },
              { label: 'Chyby', value: errorCount },
            ]}
          />
        </AtelierSection>

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
