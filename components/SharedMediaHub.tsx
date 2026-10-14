import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Images, Library, Trash2, Upload, X } from 'lucide-react';
import { BANK_AUTH_EVENT, BANK_CHANGED_EVENT, bankLogin, bankStatus, getBankUrls, hasBankToken, type BankStatus } from '../services/bankService';
import { archiveSourceFile, MEDIA_CHANGED_EVENT, syncLibraryToR2 } from '../services/mediaSync';
import { deleteImage, getAllImages, type GalleryImage } from '../utils/galleryDB';
import type { BankItem } from '../utils/bankIndex';
import type { ToastType } from './Toast';
import { importLegacyCloudLibrary } from '../utils/singleUserMediaStore';

type Tab = 'library' | 'feed';
type Toast = { message: string; type: ToastType };
const OPEN_EVENT = 'mulen:open-media';
const BankScreen = React.lazy(() => import('./BankScreen').then((module) => ({ default: module.BankScreen })));
const BankGate = React.lazy(() => import('./BankScreen').then((module) => ({ default: module.BankGate })));

export function openSharedMedia(tab: Tab = 'library'): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: tab }));
}

export function deliverFiles(input: HTMLInputElement, files: File[]): void {
  const transfer = new DataTransfer();
  for (const file of input.multiple ? files : files.slice(0, 1)) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function Feed(props: { onToast: (toast: Toast) => void; onChoose?: (files: File[]) => void }) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('');
  const [visible, setVisible] = useState(80);
  const [preview, setPreview] = useState<GalleryImage | null>(null);
  const download = async (image: GalleryImage) => {
    try {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error('Stažení originálu selhalo.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `${image.id}.${blob.type.split('/')[1] || 'png'}`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { props.onToast({ message: error instanceof Error ? error.message : 'Stažení selhalo.', type: 'error' }); }
  };
  const reload = useCallback(async () => { setImages(await getAllImages()); setLoading(false); }, []);
  useEffect(() => {
    void reload();
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void reload(), 300); };
    window.addEventListener(MEDIA_CHANGED_EVENT, changed);
    window.addEventListener(BANK_CHANGED_EVENT, changed);
    const refresh = setInterval(changed, 4 * 60 * 1000);
    return () => { clearTimeout(timer); clearInterval(refresh); window.removeEventListener(MEDIA_CHANGED_EVENT, changed); window.removeEventListener(BANK_CHANGED_EVENT, changed); };
  }, [reload]);
  const label = (image: GalleryImage) => String(image.params?.section || image.params?.operation || 'Nano');
  const sections = [...new Set(images.map(label))];
  const filtered = images.filter((image) => (!section || label(image) === section) && image.prompt.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const groups = new Map<string, GalleryImage[]>();
  for (const image of filtered.slice(0, visible)) {
    const key = String(image.params?.runId || image.params?.recipe?.runId || `legacy-${Math.floor(image.timestamp / 60000)}`);
    groups.set(key, [...(groups.get(key) || []), image]);
  }
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap gap-4 border-b border-[var(--border-color)] p-4 text-sm">
      <input aria-label="Hledat ve výsledcích" placeholder="Hledat podle promptu" value={query} onChange={(e) => { setQuery(e.target.value); setVisible(80); }} className="min-w-0 flex-1 bg-transparent p-1 text-[var(--text-primary)]" />
      <select aria-label="Sekce výsledků" value={section} onChange={(e) => { setSection(e.target.value); setVisible(80); }} className="bg-[var(--bg-panel)] text-[var(--text-primary)]"><option value="">Všechny sekce</option>{sections.map((name) => <option key={name}>{name}</option>)}</select>
      <span className="text-[var(--text-secondary)]">{filtered.length} výsledků</span>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6 custom-scrollbar">
      {!filtered.length && <p className="py-12 text-center text-sm text-[var(--text-secondary)]">{loading ? 'Načítám…' : 'Zatím žádné výsledky.'}</p>}
      {[...groups.entries()].map(([id, group]) => <section key={id} className="mb-6">
        <h3 className="mb-2 text-[10px] text-[var(--text-secondary)]">{new Date(Math.max(...group.map((image) => image.timestamp))).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })} · {label(group[0])}</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{group.map((image) => <article key={image.id} className="min-w-0 overflow-hidden rounded-md border border-[var(--border-color)]">
          <button type="button" className="block aspect-square w-full" onClick={() => setPreview(image)} aria-label={`Zvětšit: ${image.prompt}`}><img src={image.thumbnail || image.url} alt={image.prompt} loading="lazy" className="h-full w-full object-cover" /></button>
          <div className="flex items-center gap-2 p-2 text-[11px] text-[var(--text-secondary)]"><span className="min-w-0 flex-1 truncate" title={image.prompt}>{image.prompt}</span>
            <button type="button" onClick={() => void download(image)} title="Stáhnout originál" className="p-1"><Download className="h-4 w-4" /></button>
            <button type="button" title="Smazat výsledek" className="p-1" onClick={() => { if (window.confirm('Smazat tento výsledek i z R2?')) void deleteImage(image.id).then(reload).catch((error: Error) => props.onToast({ message: error.message, type: 'error' })); }}><Trash2 className="h-4 w-4" /></button>
          </div>
        </article>)}</div>
      </section>)}
      {filtered.length > visible && <button type="button" className="mn-action-secondary" onClick={() => setVisible((count) => count + 80)}>Další výsledky</button>}
    </div>
    {preview && <div className="absolute inset-0 z-10 flex flex-col bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center gap-4 pb-3 text-sm text-[var(--text-primary)]"><span className="min-w-0 flex-1 truncate">{preview.prompt}</span>
        {props.onChoose && <button type="button" onClick={() => void fetch(preview.url).then((response) => { if (!response.ok) throw new Error('Stažení originálu selhalo.'); return response.blob(); }).then((blob) => props.onChoose?.([new File([blob], `${preview.id}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type })])).catch((error: Error) => props.onToast({ message: error.message, type: 'error' }))}>Použít jako vstup</button>}
        <button type="button" title="Zavřít detail" onClick={() => setPreview(null)}><X className="h-4 w-4" /></button>
      </div>
      <img src={preview.url} alt={preview.prompt} className="min-h-0 flex-1 object-contain" />
    </div>}
  </div>;
}

export function SharedMediaHub(props: { open: boolean; onClose: () => void; onToast: (toast: Toast) => void; theme: 'dark' | 'light' }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('library');
  const [target, setTarget] = useState<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [authed, setAuthed] = useState(hasBankToken);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nativeInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const open = props.open || internalOpen;
  const close = useCallback(() => { setInternalOpen(false); setTarget(null); callbacks.current.onClose(); }, []);
  const toast = useCallback((value: Toast) => callbacks.current.onToast(value), []);

  useEffect(() => {
    const sync = () => { setAuthed(hasBankToken()); void syncLibraryToR2().catch(() => toast({ message: 'Některé lokální obrázky zatím nejsou v R2. Synchronizaci lze zopakovat v knihovně.', type: 'warning' })); };
    const click = (event: MouseEvent) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !/image\//.test(input.accept) || input.closest('[data-bank-ui]')) return;
      event.preventDefault();
      setTarget(input); setTab('library'); setInternalOpen(true);
    };
    const archive = (files: File[]) => {
      for (const file of files.filter((file) => file.type.startsWith('image/'))) void archiveSourceFile(file).catch(() => toast({ message: `Zdroj ${file.name} se nepodařilo uložit do knihovny.`, type: 'error' }));
    };
    const change = (event: Event) => { const input = event.target; if (input instanceof HTMLInputElement && input.type === 'file' && !input.closest('[data-bank-ui]')) archive(Array.from(input.files || [])); };
    const drop = (event: DragEvent) => { if (event.target instanceof Element && !event.target.closest('[data-bank-ui]')) archive(Array.from(event.dataTransfer?.files || [])); };
    const show = (event: Event) => { setTab((event as CustomEvent<Tab>).detail || 'library'); setTarget(null); setInternalOpen(true); };
    document.addEventListener('click', click, true); document.addEventListener('change', change, true); document.addEventListener('drop', drop, true);
    window.addEventListener(OPEN_EVENT, show); window.addEventListener(BANK_AUTH_EVENT, sync); window.addEventListener('online', sync);
    sync();
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('change', change, true); document.removeEventListener('drop', drop, true); window.removeEventListener(OPEN_EVENT, show); window.removeEventListener(BANK_AUTH_EVENT, sync); window.removeEventListener('online', sync); };
  }, [toast]);
  useEffect(() => { if (props.open) setTab('library'); }, [props.open]);
  useEffect(() => {
    if (!open) return;
    void bankStatus().then(setStatus).catch(() => setStatus({ configured: false, missing: ['/api/bank'] }));
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); close(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []).filter((element) => element.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.body.style.overflow = overflow; previous?.focus(); document.removeEventListener('keydown', key, true); };
  }, [open, close]);

  const useFiles = (files: File[]) => { if (target?.isConnected) { deliverFiles(target, files); close(); } else toast({ message: 'Vstup už není otevřený. Vyber obrázek znovu.', type: 'warning' }); };
  const choose = async (items: BankItem[]) => {
    setBusy(true);
    try {
      const urls = await getBankUrls(items.map((item) => item.itemKey!));
      const files: File[] = [];
      for (const item of items) {
        const response = await fetch(urls[item.itemKey!]);
        if (!response.ok) throw new Error('Stažení zdroje selhalo.');
        files.push(new File([await response.blob()], item.fileName || item.title, { type: item.contentType || 'image/png' }));
      }
      useFiles(files);
    } catch (failure) { toast({ message: failure instanceof Error ? failure.message : 'Výběr selhal.', type: 'error' }); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  return createPortal(<div data-bank-ui className="fixed inset-0 z-[10000] bg-black/60 p-2 sm:p-6" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Sdílená knihovna a výsledky" tabIndex={-1} aria-busy={busy} className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] outline-none">
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border-color)] p-3 sm:p-4 text-xs">
        <button type="button" aria-pressed={tab === 'library'} className={`flex items-center gap-2 ${tab === 'library' ? 'text-[var(--accent)]' : ''}`} onClick={() => setTab('library')}><Library className="h-4 w-4" />Knihovna zdrojů</button>
        <button type="button" aria-pressed={tab === 'feed'} className={`flex items-center gap-2 ${tab === 'feed' ? 'text-[var(--accent)]' : ''}`} onClick={() => setTab('feed')}><Images className="h-4 w-4" />Všechny výsledky</button>
        {authed && <button type="button" disabled={busy} onClick={() => { setBusy(true); void syncLibraryToR2().then(() => toast({ message: 'Lokální obrázky jsou synchronizované do R2.', type: 'success' })).catch(() => toast({ message: 'Synchronizace není dokončená. Lokální data zůstala zachovaná.', type: 'error' })).finally(() => setBusy(false)); }}>Synchronizovat</button>}
        {authed && <button type="button" disabled={busy} onClick={() => {
          if (!window.confirm('Načíst starou knihovnu ze Supabase a zkopírovat ji do R2? Může obsahovat i dříve smazané obrázky. Původní data se nesmažou.')) return;
          setBusy(true);
          void importLegacyCloudLibrary().then(() => syncLibraryToR2()).then(() => toast({ message: 'Import staré knihovny a synchronizace do R2 dokončeny.', type: 'success' })).catch(() => toast({ message: 'Import není dokončený. Původní data zůstala zachovaná.', type: 'error' })).finally(() => setBusy(false));
        }}>Import staré knihovny</button>}
        {target && <button type="button" disabled={busy} className="ml-auto flex items-center gap-2" onClick={() => nativeInput.current?.click()}><Upload className="h-4 w-4" />Z počítače</button>}
        <button type="button" title="Zavřít knihovnu" onClick={close} className={`${target ? '' : 'ml-auto'} p-2`}><X className="h-4 w-4" /></button>
        <input ref={nativeInput} type="file" hidden accept={target?.accept || 'image/*'} multiple={target?.multiple} onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) useFiles(files); }} />
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <React.Suspense fallback={<p className="m-auto text-sm">Načítám knihovnu…</p>}>
        {!authed || !status?.configured ? <BankGate status={status} error={error} onLogin={async (password) => { try { await bankLogin(password); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Přihlášení selhalo.'); } }} /> : tab === 'library' ? <BankScreen theme={props.theme} onToast={toast} onChoose={target ? (items) => { if (!busy) void choose(items); } : undefined} multiple={target?.multiple} /> : <Feed onToast={toast} onChoose={target ? useFiles : undefined} />}
        </React.Suspense>
      </div>
    </div>
  </div>, document.body);
}
