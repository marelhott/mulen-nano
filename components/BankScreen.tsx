import React from 'react';
import { FileText, FolderPlus, Link as LinkIcon, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import {
  BANK_INBOX_ID,
  addFolder,
  deleteFolder,
  emptyBankIndex,
  filterItems,
  folderPath,
  moveFolder,
  moveItems,
  parseTags,
  renameFolder,
  tagCounts,
  updateItem,
  type BankFolder,
  type BankIndex,
  type BankItem,
  type BankItemKind,
} from '../utils/bankIndex';
import {
  BankAuthError,
  BANK_CHANGED_EVENT,
  BANK_AUTH_EVENT,
  addBankEntry,
  bankLogin,
  bankLogout,
  bankStatus,
  deleteBankItems,
  getBankUrls,
  getCachedBankUrl,
  hasBankToken,
  loadBankIndex,
  mutateBank,
  uploadBankImage,
  type BankStatus,
} from '../services/bankService';
import { toUserFacingAiError } from '../utils/aiErrorMessage';
import type { ToastType } from './Toast';

const PAGE_SIZE = 120;

const KIND_LABELS: Record<BankItemKind, string> = { image: 'Obrázek', note: 'Nápad', prompt: 'Prompt', link: 'Odkaz' };
const KIND_FILTERS: Array<{ id: BankItemKind | null; label: string }> = [
  { id: null, label: 'Vše' },
  { id: 'image', label: 'Obrázky' },
  { id: 'note', label: 'Nápady' },
  { id: 'prompt', label: 'Prompty' },
  { id: 'link', label: 'Odkazy' },
];

function makeId(): string {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function flattenFolders(index: BankIndex): Array<{ folder: BankFolder; depth: number }> {
  const out: Array<{ folder: BankFolder; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of index.folders.filter((f) => f.parentId === parentId)) {
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const SUPPORTED_UPLOAD = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// --- přihlášení -----------------------------------------------------------------------------------

export function BankGate(props: { status: BankStatus | null; error: string; onLogin: (passphrase: string) => Promise<void> }) {
  const [passphrase, setPassphrase] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const { status } = props;

  if (!status) return <div className="m-auto text-[10px] font-bold uppercase tracking-widest text-[var(--text-3)]">Načítám…</div>;

  if (!status.configured) {
    return (
      <div className="m-auto max-w-md space-y-3 p-6 text-[11px] leading-relaxed text-[var(--text-secondary)]">
        <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-[var(--text-primary)]">Databanka není nakonfigurovaná</h2>
        <p>Na serveru chybí tyto proměnné prostředí:</p>
        <ul className="list-disc pl-5 font-mono text-[10px]">
          {status.missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p>Nastav je (lokálně v .env.local, na Vercelu v Environment Variables), vytvoř soukromý bucket v Cloudflare R2 a nastav mu CORS. Pak stránku obnov.</p>
      </div>
    );
  }

  return (
    <form
      className="m-auto w-full max-w-xs space-y-3 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!passphrase || busy) return;
        setBusy(true);
        try {
          await props.onLogin(passphrase);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-[var(--text-primary)]">Databanka</h2>
      <input
        type="password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="PIN k Databance"
        aria-label="PIN k Databance"
        inputMode="numeric"
        pattern="[0-9]{6}"
        minLength={6}
        maxLength={6}
        autoComplete="current-password"
        autoFocus
        className="w-full border-0 border-b border-[var(--border-color)] bg-transparent p-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      {props.error ? <div className="text-[9px] font-bold text-red-400">{props.error}</div> : null}
      <button type="submit" disabled={!passphrase || busy} className="mn-action-primary">
        {busy ? 'Ověřuji…' : 'Odemknout'}
      </button>
    </form>
  );
}

// --- karta, detail --------------------------------------------------------------------------------

function ItemCard(props: { item: BankItem; selected: boolean; version: number; onSelect: () => void; onImageError: (key: string) => void }) {
  const { item, selected } = props;
  const thumb = getCachedBankUrl(item.thumbKey);
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={`group flex flex-col overflow-hidden card-surface card-surface-hover text-left transition-all ${selected ? 'ring-1 ring-[var(--accent)]' : ''}`}
      data-version={props.version}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-[var(--bg-panel)]">
        {item.kind === 'image' ? (
          thumb ? (
            <img src={thumb} alt={item.title} loading="lazy" className="h-full w-full object-cover" onError={() => item.thumbKey && props.onImageError(item.thumbKey)} />
          ) : null
        ) : (
          <div className="flex h-full w-full flex-col gap-1 p-2">
            <div className="flex items-center gap-1 text-[var(--accent)]">
              {item.kind === 'link' ? <LinkIcon className="h-3 w-3" strokeWidth={1.6} /> : <FileText className="h-3 w-3" strokeWidth={1.6} />}
              <span className="text-[7px] font-black uppercase tracking-widest">{KIND_LABELS[item.kind]}</span>
            </div>
            <p className="line-clamp-6 whitespace-pre-wrap text-[9px] leading-snug text-[var(--text-secondary)]">{item.text || item.url || ''}</p>
          </div>
        )}
      </div>
      <div className="truncate border-t border-[rgba(168,191,143,0.12)] px-2 py-1.5 text-[8px] font-black uppercase tracking-[0.12em] text-[var(--text-secondary)]">{item.title}</div>
    </button>
  );
}

function ItemDetail(props: {
  item: BankItem;
  index: BankIndex;
  onSave: (id: string, patch: { title: string; text: string; url: string; tags: string[]; folderId: string }) => Promise<void>;
  onDelete: (item: BankItem) => Promise<void>;
  onClose: () => void;
}) {
  const { item } = props;
  const [title, setTitle] = React.useState(item.title);
  const [text, setText] = React.useState(item.text ?? '');
  const [url, setUrl] = React.useState(item.url ?? '');
  const [tags, setTags] = React.useState(item.tags.join(', '));
  const [folderId, setFolderId] = React.useState(item.folderId);
  const [full, setFull] = React.useState<string | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setTitle(item.title);
    setText(item.text ?? '');
    setUrl(item.url ?? '');
    setTags(item.tags.join(', '));
    setFolderId(item.folderId);
    setFull(undefined);
    if (item.kind !== 'image' || !item.itemKey) return undefined;
    let cancelled = false;
    void getBankUrls([item.itemKey])
      .then((urls) => {
        if (!cancelled) setFull(urls[item.itemKey!]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.id, item.itemKey, item.kind, item.title, item.text, item.url, item.tags, item.folderId]);

  const field = 'w-full border-0 border-b border-[var(--border-color)] bg-transparent p-1.5 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';
  const label = 'text-[8px] font-bold uppercase tracking-wider text-[var(--text-3)]';

  return (
    <aside className="absolute inset-0 z-10 flex h-full w-full flex-col gap-3 overflow-y-auto border-l border-[var(--border-color)] bg-[var(--bg-panel)] p-4 custom-scrollbar lg:static lg:w-[320px] lg:shrink-0">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-primary)]">{KIND_LABELS[item.kind]}</span>
        <button type="button" onClick={props.onClose} className="p-1 text-[var(--text-secondary)] hover:text-[var(--accent)]" title="Zavřít">
          <X className="h-3 w-3" />
        </button>
      </div>
      {item.kind === 'image' ? (
        full ? (
          <a href={full} target="_blank" rel="noopener noreferrer" title="Otevřít v plné velikosti">
            <img src={full} alt={item.title} className="max-h-[320px] w-full object-contain bg-[var(--bg-panel)]" />
          </a>
        ) : (
          <div className="flex h-40 items-center justify-center bg-[var(--bg-panel)] text-[8px] font-bold uppercase tracking-widest text-[var(--text-3)]">Načítám…</div>
        )
      ) : null}
      <label className="space-y-0.5">
        <span className={label}>Název</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </label>
      {item.kind === 'link' ? (
        <label className="space-y-0.5">
          <span className={label}>Odkaz</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} className={field} />
        </label>
      ) : null}
      <label className="space-y-0.5">
        <span className={label}>{item.kind === 'image' ? 'Poznámka' : 'Text'}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={item.kind === 'image' ? 3 : 8} className={`${field} resize-none custom-scrollbar`} />
      </label>
      <label className="space-y-0.5">
        <span className={label}>Štítky (oddělené čárkou)</span>
        <input value={tags} onChange={(e) => setTags(e.target.value)} className={field} />
      </label>
      <label className="space-y-0.5">
        <span className={label}>Složka</span>
        <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={`${field} bg-[var(--bg-card)]`}>
          {flattenFolders(props.index).map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {`${'  '.repeat(depth)}${folder.name}`}
            </option>
          ))}
        </select>
      </label>
      <div className="text-[8px] text-[var(--text-3)]">
        {new Date(item.createdAt).toLocaleString('cs-CZ')} · {item.source ?? ''}
        {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
      </div>
      <div className="mt-auto flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await props.onSave(item.id, { title: title.trim() || item.title, text, url, tags: parseTags(tags), folderId });
            } finally {
              setBusy(false);
            }
          }}
          className="mn-action-primary flex-1"
        >
          Uložit
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm('Smazat položku z Databanky včetně souboru?')) return;
            setBusy(true);
            try {
              await props.onDelete(item);
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg border border-red-500/30 px-3 text-red-400 hover:bg-red-500/10"
          title="Smazat"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
      </div>
    </aside>
  );
}

// --- obrazovka ------------------------------------------------------------------------------------

export function BankScreen(props: { onToast: (toast: { message: string; type: ToastType }) => void; theme?: 'dark' | 'light'; onChoose?: (items: BankItem[]) => void; multiple?: boolean }) {
  const { onToast, theme = 'dark' } = props;

  const [status, setStatus] = React.useState<BankStatus | null>(null);
  const [authed, setAuthed] = React.useState<boolean>(() => hasBankToken());
  const [loginError, setLoginError] = React.useState('');
  const [index, setIndex] = React.useState<BankIndex>(() => emptyBankIndex());
  const [loaded, setLoaded] = React.useState(false);
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [tag, setTag] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<BankItemKind | null>(null);
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [checked, setChecked] = React.useState<string[]>([]);
  const [moveTarget, setMoveTarget] = React.useState(BANK_INBOX_ID);
  const [visible, setVisible] = React.useState(PAGE_SIZE);
  const [urlVersion, setUrlVersion] = React.useState(0);
  const [uploading, setUploading] = React.useState<{ done: number; total: number } | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{ kind: BankItemKind; title: string; text: string; url: string } | null>(null);
  const fileInputId = React.useMemo(() => `bank-upload-${makeId()}`, []);
  const retriedKeys = React.useRef(new Set<string>());

  const handleError = React.useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof BankAuthError) {
        setAuthed(false);
        setLoginError('Přihlášení není platné, zadej PIN znovu.');
        return;
      }
      onToast({ message: toUserFacingAiError(error, fallback), type: 'error' });
    },
    [onToast],
  );

  React.useEffect(() => {
    let cancelled = false;
    void bankStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false, missing: ['/api/bank (server neodpovídá)'] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = React.useCallback(async () => {
    try {
      setIndex(await loadBankIndex());
      setLoaded(true);
    } catch (error) {
      handleError(error, 'Databanku se nepodařilo načíst.');
    }
  }, [handleError]);

  React.useEffect(() => {
    if (authed && status?.configured) void reload();
  }, [authed, status?.configured, reload]);

  React.useEffect(() => {
    const changed = () => { if (hasBankToken()) void reload(); };
    const auth = () => setAuthed(hasBankToken());
    window.addEventListener(BANK_CHANGED_EVENT, changed);
    window.addEventListener(BANK_AUTH_EVENT, auth);
    return () => {
      window.removeEventListener(BANK_CHANGED_EVENT, changed);
      window.removeEventListener(BANK_AUTH_EVENT, auth);
    };
  }, [reload]);

  const scopeItems = React.useMemo(() => filterItems(index, { folderId, kind, query }), [index, folderId, kind, query]);
  const items = React.useMemo(() => (tag ? scopeItems.filter((item) => item.tags.includes(tag)) : scopeItems), [scopeItems, tag]);
  const tags = React.useMemo(() => tagCounts(scopeItems), [scopeItems]);
  const shown = items.slice(0, visible);
  const selected = selectedId ? index.items.find((item) => item.id === selectedId) ?? null : null;
  const folderCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of index.items) counts.set(item.folderId, (counts.get(item.folderId) ?? 0) + 1);
    return counts;
  }, [index.items]);

  // Odkazy na náhledy se podepisují po dávkách jen pro zobrazené položky.
  React.useEffect(() => {
    const keys = shown.map((item) => item.thumbKey).filter((key): key is string => !!key && !getCachedBankUrl(key));
    if (keys.length === 0) return undefined;
    let cancelled = false;
    void getBankUrls(keys)
      .then(() => {
        if (!cancelled) setUrlVersion((v) => v + 1);
      })
      .catch((error) => {
        if (!cancelled) handleError(error, 'Náhledy se nepodařilo načíst.');
      });
    return () => {
      cancelled = true;
    };
  }, [shown, handleError]);

  const handleImageError = React.useCallback(
    (key: string) => {
      if (retriedKeys.current.has(key)) return;
      retriedKeys.current.add(key);
      void getBankUrls([key], { force: true })
        .then(() => setUrlVersion((v) => v + 1))
        .catch((error) => handleError(error, 'Náhled se nepodařilo obnovit.'));
    },
    [handleError],
  );

  const applyIndex = React.useCallback(
    async (mutator: (current: BankIndex) => BankIndex, failure: string) => {
      try {
        setIndex(await mutateBank(mutator));
        return true;
      } catch (error) {
        handleError(error, failure);
        return false;
      }
    },
    [handleError],
  );

  const handleUploadFiles = React.useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => SUPPORTED_UPLOAD.includes(file.type));
      if (images.length < files.length) onToast({ message: 'Některé soubory nejsou JPEG, PNG, WebP ani GIF, přeskočeno.', type: 'warning' });
      if (images.length === 0) return;
      const target = folderId ?? BANK_INBOX_ID;
      let ok = 0;
      let duplicates = 0;
      setUploading({ done: 0, total: images.length });
      for (const file of images) {
        try {
          const item = await uploadBankImage(file, { folderId: target });
          if (item.reused) duplicates += 1;
          else ok += 1;
        } catch (error) {
          handleError(error, `Nahrání ${file.name} selhalo.`);
          if (error instanceof BankAuthError) break;
        }
        setUploading((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
      setUploading(null);
      if (ok > 0 || duplicates > 0) {
        await reload();
        onToast({ message: `Přidáno ${ok} obrázků, přeskočeno ${duplicates} duplicit.`, type: 'success' });
      }
    },
    [folderId, handleError, onToast, reload],
  );

  const handleSaveItem = React.useCallback(
    async (id: string, patch: { title: string; text: string; url: string; tags: string[]; folderId: string }) => {
      const ok = await applyIndex((current) => updateItem(current, id, patch), 'Uložení položky selhalo.');
      if (ok) onToast({ message: 'Uloženo.', type: 'success' });
    },
    [applyIndex, onToast],
  );

  const handleDeleteItem = React.useCallback(
    async (item: BankItem) => {
      try {
        await deleteBankItems([item.id]);
        setSelectedId(null);
        await reload();
      } catch (error) {
        handleError(error, 'Smazání selhalo.');
      }
    },
    [handleError, reload],
  );

  const handleCreateFolder = React.useCallback(async () => {
    const name = (newFolderName ?? '').trim();
    setNewFolderName(null);
    if (!name) return;
    await applyIndex((current) => addFolder(current, { id: makeId(), name, parentId: folderId }), 'Složku se nepodařilo vytvořit.');
  }, [applyIndex, folderId, newFolderName]);

  const handleAddDraft = React.useCallback(async () => {
    if (!draft) return;
    const title = draft.title.trim() || (draft.text.trim() || draft.url.trim()).slice(0, 48);
    if (!title) return;
    const item: BankItem = {
      id: makeId(),
      kind: draft.kind,
      title,
      text: draft.text.trim() || undefined,
      url: draft.kind === 'link' ? draft.url.trim() || undefined : undefined,
      folderId: folderId ?? BANK_INBOX_ID,
      tags: [],
      createdAt: Date.now(),
      source: 'ručně',
    };
    try {
      await addBankEntry(item);
      setDraft(null);
      await reload();
    } catch (error) {
      handleError(error, 'Položku se nepodařilo přidat.');
    }
  }, [draft, folderId, handleError, reload]);

  const pathLabel = folderId ? folderPath(index, folderId).map((f) => f.name).join(' / ') : 'Vše';

  const panelStyle =
    theme === 'dark'
      ? { background: 'linear-gradient(160deg,rgba(32,44,24,0.94) 0%,rgba(20,28,15,0.96) 100%)', boxShadow: '4px 0 48px rgba(0,0,0,0.50)' }
      : { background: '#ffffff', borderRight: '1px solid #cdd8ba' };

  if (!authed || !status?.configured) {
    return (
      <div className="flex flex-1 canvas-surface">
        <BankGate
          status={status}
          error={loginError}
          onLogin={async (passphrase) => {
            try {
              await bankLogin(passphrase);
              setLoginError('');
              setAuthed(true);
            } catch (error: any) {
              setLoginError(String(error?.message || 'Přihlášení selhalo.'));
            }
          }}
        />
      </div>
    );
  }

  const rowClass = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[10px] font-semibold ${active ? 'bg-[color:var(--selection-surface)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`;

  return (
    <div data-bank-ui className="relative flex h-full min-w-0 flex-1 overflow-hidden canvas-surface">
      <aside className="flex h-full w-[140px] sm:w-[220px] shrink-0 flex-col gap-4 overflow-y-auto p-3 sm:p-5 custom-scrollbar cairn-panel-left" style={panelStyle}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-4 w-1.5 rounded-full bg-[#a8bf8f] shadow-[0_0_10px_rgba(168,191,143,0.5)]" />
            <h2 className="text-[11px] font-[900] uppercase tracking-[0.3em] text-[var(--text-primary)]">Zdroje</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              bankLogout();
              setAuthed(false);
              setIndex(emptyBankIndex());
              setLoaded(false);
            }}
            className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-3)] hover:text-[var(--accent)]"
          >
            Zamknout
          </button>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Složky</h3>
            <button type="button" onClick={() => setNewFolderName('')} className="p-1 text-[var(--text-secondary)] hover:text-[var(--accent)]" title={folderId ? 'Nová podsložka' : 'Nová složka'}>
              <FolderPlus className="h-3 w-3" strokeWidth={1.6} />
            </button>
          </div>
          <button type="button" className={rowClass(folderId === null)} onClick={() => setFolderId(null)}>
            <span>Vše</span>
            <span className="text-[8px] opacity-60">{index.items.length}</span>
          </button>
          {flattenFolders(index).map(({ folder, depth }) => (
            <div key={folder.id} className="group flex items-center" style={{ paddingLeft: depth * 12 }}>
              <button type="button" className={rowClass(folderId === folder.id)} onClick={() => setFolderId(folder.id)}>
                <span className="truncate">{folder.name}</span>
                <span className="text-[8px] opacity-60">{folderCounts.get(folder.id) ?? 0}</span>
              </button>
              {folder.id !== BANK_INBOX_ID ? (
                <div className="hidden shrink-0 group-hover:flex">
                  <button
                    type="button"
                    className="px-1 text-[9px] text-[var(--text-3)] hover:text-[var(--accent)]"
                    title="Přejmenovat"
                    onClick={() => {
                      const name = window.prompt('Nový název složky', folder.name);
                      if (name) void applyIndex((current) => renameFolder(current, folder.id, name), 'Přejmenování selhalo.');
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="px-1 text-[9px] text-[var(--text-3)] hover:text-[var(--accent)]"
                    title="Přesunout do kořene"
                    onClick={() => void applyIndex((current) => moveFolder(current, folder.id, null), 'Přesun selhal.')}
                  >
                    ⇱
                  </button>
                  <button
                    type="button"
                    className="px-1 text-[9px] text-[var(--text-3)] hover:text-red-400"
                    title="Smazat složku (položky se přesunou výš)"
                    onClick={() => {
                      if (!window.confirm(`Smazat složku „${folder.name}“? Položky zůstanou, přesunou se do nadřazené složky.`)) return;
                      if (folderId === folder.id) setFolderId(null);
                      void applyIndex((current) => deleteFolder(current, folder.id), 'Smazání složky selhalo.');
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {newFolderName !== null ? (
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={() => void handleCreateFolder()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateFolder();
                if (e.key === 'Escape') setNewFolderName(null);
              }}
              placeholder={folderId ? 'Název podsložky' : 'Název složky'}
              className="w-full border-0 border-b border-[var(--accent)] bg-transparent p-1 text-[10px] text-[var(--text-primary)] outline-none"
            />
          ) : null}
        </div>

        <div className="space-y-1.5">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Štítky</h3>
          {tags.length === 0 ? <div className="text-[9px] text-[var(--text-3)]">Zatím žádné.</div> : null}
          <div className="flex flex-wrap gap-1">
            {tags.map(({ tag: name, count }) => (
              <button
                key={name}
                type="button"
                onClick={() => setTag(tag === name ? null : name)}
                className={`rounded-full border px-2 py-0.5 text-[8px] font-bold ${tag === name ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                #{name} <span className="opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section
        className="flex h-full min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          void handleUploadFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-color)] px-5 py-3">
          <div className="min-w-0 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-primary)]">
            {pathLabel} <span className="text-[var(--text-3)]">· {items.length}</span>
          </div>
          <div className="relative min-w-[160px] flex-1">
            <Search className="pointer-events-none absolute left-1 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat v názvech, textech a štítcích"
              className="w-full border-0 border-b border-[var(--border-color)] bg-transparent py-1 pl-6 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex gap-1">
            {KIND_FILTERS.map((entry) => (
              <button
                key={entry.label}
                type="button"
                onClick={() => setKind(entry.id)}
                className={`rounded px-2 py-1 text-[8px] font-bold uppercase tracking-wider ${kind === entry.id ? 'text-[var(--accent)]' : 'text-[var(--text-3)] hover:text-[var(--text-primary)]'}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => document.getElementById(fileInputId)?.click()} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)]">
            <Upload className="h-3 w-3" strokeWidth={1.6} /> Nahrát
          </button>
          <button type="button" onClick={() => setDraft({ kind: 'note', title: '', text: '', url: '' })} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)]">
            <Plus className="h-3 w-3" strokeWidth={1.6} /> Nápad
          </button>
          <input
            id={fileInputId}
            type="file"
            accept={SUPPORTED_UPLOAD.join(',')}
            multiple
            className="hidden"
            onChange={(e) => {
              void handleUploadFiles(Array.from(e.target.files ?? []));
              e.currentTarget.value = '';
            }}
          />
        </div>

        {uploading ? (
          <div className="border-b border-[var(--border-color)] px-5 py-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--accent)]">
            Nahrávám {Math.min(uploading.done + 1, uploading.total)}/{uploading.total}…
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-color)] px-5 py-2 text-[11px] text-[var(--text-secondary)]">
          <button type="button" onClick={() => setChecked(items.filter((item) => !props.onChoose || item.kind === 'image').map((item) => item.id).slice(0, props.onChoose && !props.multiple ? 1 : undefined))}>Vybrat vše</button>
          <button type="button" onClick={() => setChecked([])}>Zrušit výběr ({checked.length})</button>
          <select aria-label="Cílová složka" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="min-w-0 max-w-48 bg-[var(--bg-panel)] p-1">
            {flattenFolders(index).map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{'– '.repeat(depth)}{folder.name}</option>)}
          </select>
          <button type="button" disabled={!checked.length} onClick={() => void applyIndex((current) => moveItems(current, checked, moveTarget), 'Přesun selhal.')}>Přesunout</button>
          <button type="button" disabled={!checked.length} onClick={() => {
            if (!window.confirm(`Smazat ${checked.length} vybraných položek z knihovny?`)) return;
            void deleteBankItems(checked).then(() => { setChecked([]); return reload(); }).catch((error) => handleError(error, 'Smazání selhalo.'));
          }}><Trash2 className="h-3 w-3" aria-label="Smazat vybrané" /></button>
          {props.onChoose && <button type="button" disabled={!checked.length} className="ml-auto text-[var(--accent)]" onClick={() => props.onChoose?.(index.items.filter((item) => checked.includes(item.id) && item.kind === 'image'))}>Použít vybrané ({checked.length})</button>}
        </div>

        {draft ? (
          <div className="space-y-2 border-b border-[var(--border-color)] px-5 py-3">
            <div className="flex items-center gap-2">
              {(['note', 'prompt', 'link'] as BankItemKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraft({ ...draft, kind: k })}
                  className={`text-[8px] font-bold uppercase tracking-wider ${draft.kind === k ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'}`}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
              <button type="button" onClick={() => setDraft(null)} className="ml-auto p-1 text-[var(--text-3)] hover:text-[var(--accent)]">
                <X className="h-3 w-3" />
              </button>
            </div>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Název (volitelný)"
              className="w-full border-0 border-b border-[var(--border-color)] bg-transparent p-1 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            {draft.kind === 'link' ? (
              <input
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://…"
                className="w-full border-0 border-b border-[var(--border-color)] bg-transparent p-1 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            ) : null}
            <textarea
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              rows={4}
              placeholder={draft.kind === 'prompt' ? 'Text promptu' : 'Text nápadu'}
              className="w-full resize-none border-0 border-b border-[var(--border-color)] bg-transparent p-1 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] custom-scrollbar"
            />
            <button type="button" onClick={() => void handleAddDraft()} className="mn-action-primary">
              Přidat do {folderId ? 'vybrané složky' : 'Doručených'}
            </button>
          </div>
        ) : null}

        <div className={`flex-1 overflow-y-auto p-5 custom-scrollbar ${dragActive ? 'bg-[var(--accent)]/5 outline outline-1 outline-dashed outline-[var(--accent)]' : ''}`}>
          {shown.length > 0 ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))' }}>
              {shown.map((item) => (
                <div key={item.id} className="relative min-w-0">
                  <ItemCard item={item} selected={checked.includes(item.id) || item.id === selectedId} version={urlVersion} onSelect={() => {
                    if (!props.onChoose) setSelectedId(item.id);
                    else if (item.kind === 'image') setChecked((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : props.multiple ? [...current, item.id] : [item.id]);
                  }} onImageError={handleImageError} />
                  {(!props.onChoose || item.kind === 'image') && <input type="checkbox" aria-label={`Vybrat ${item.title}`} checked={checked.includes(item.id)} onChange={(e) => setChecked((current) => e.target.checked ? props.onChoose && !props.multiple ? [item.id] : [...current, item.id] : current.filter((id) => id !== item.id))} className="absolute left-2 top-2 h-4 w-4 accent-[var(--accent)]" />}
                </div>
              ))}
            </div>
          ) : (
            <div className="m-auto max-w-sm pt-16 text-center text-[10px] leading-relaxed text-[var(--text-3)]">
              {!loaded
                ? 'Načítám…'
                : index.items.length === 0
                  ? 'Databanka je prázdná. Přetáhni sem obrázky z počítače, nebo klikni na Nahrát či Nápad. Nahrané obrázky spadnou do složky Doručené.'
                  : 'Nic neodpovídá filtru.'}
            </div>
          )}
          {items.length > visible ? (
            <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)} className="mx-auto mt-4 block text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)]">
              Zobrazit dalších {Math.min(PAGE_SIZE, items.length - visible)}
            </button>
          ) : null}
        </div>
      </section>

      {selected ? <ItemDetail key={selected.id} item={selected} index={index} onSave={handleSaveItem} onDelete={handleDeleteItem} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}
