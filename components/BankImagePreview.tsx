import React from 'react';
import { ArrowLeft, ArrowRight, Info, Minus, Plus, Scan, X } from 'lucide-react';
import { getBankUrls } from '../services/bankService';
import type { BankItem } from '../utils/bankIndex';

export function BankImagePreview({ item, position, total, onClose, onStep, onDetails }: {
  item: BankItem; position: number; total: number;
  onClose: () => void; onStep: (step: number) => void; onDetails: () => void;
}) {
  const [url, setUrl] = React.useState('');
  const [error, setError] = React.useState('');
  const [zoom, setZoom] = React.useState(1);
  const dialog = React.useRef<HTMLDivElement>(null);
  const scroll = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    let cancelled = false;
    setUrl(''); setError(''); setZoom(1);
    scroll.current?.scrollTo(0, 0);
    if (item.itemKey) void getBankUrls([item.itemKey]).then((urls) => {
      if (cancelled) return;
      const original = urls[item.itemKey!];
      if (original) setUrl(original);
      else setError('Originál se nepodařilo načíst.');
    }).catch(() => { if (!cancelled) setError('Originál se nepodařilo načíst.'); });
    else setError('Originál není k dispozici.');
    return () => { cancelled = true; };
  }, [item.id, item.itemKey]);
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const action = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-[var(--bg-panel-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-30';
  return <div data-bank-preview ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Náhled: ${item.title}`} style={{ position: 'absolute', zIndex: 30 }} className="inset-0 flex min-h-0 flex-col bg-[var(--bg-elevated)] text-[var(--text-primary)] outline-none" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); onStep(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); onStep(1); }
    if (event.key === 'Tab') {
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="flex min-h-14 items-center gap-2 border-b border-[var(--border-color)] px-3 text-xs">
      <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
      <span className="shrink-0 text-[var(--text-secondary)]">{position + 1} / {total}</span>
      <button className={action} type="button" title="Zmenšit" aria-label="Zmenšit" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}><Minus size={16} /></button>
      <button className={action} type="button" title="Přizpůsobit oknu" aria-label="Přizpůsobit oknu" onClick={() => setZoom(1)}><Scan size={16} /></button>
      <button className={action} type="button" title="Zvětšit" aria-label="Zvětšit" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.5))}><Plus size={16} /></button>
      <button className={action} type="button" title="Podrobnosti obrázku" aria-label="Podrobnosti obrázku" onClick={onDetails}><Info size={16} /></button>
      <button className={action} type="button" title="Zavřít náhled" aria-label="Zavřít náhled" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="relative min-h-0 flex-1">
      <div ref={scroll} className="h-full w-full overflow-auto" data-bank-preview-scroll>
        <div className="relative" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          {url ? <img src={url} alt={item.title} className="absolute inset-0 h-full w-full object-contain" onError={() => setError('Originál se nepodařilo načíst.')} /> : null}
          {(!url || error) && <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-secondary)]">{error || 'Načítám originál…'}</p>}
        </div>
      </div>
      <button type="button" aria-label="Předchozí obrázek" title="Předchozí obrázek" disabled={position <= 0} onClick={() => onStep(-1)} className={`${action} absolute left-3 top-1/2 bg-[var(--bg-elevated)]`}><ArrowLeft size={18} /></button>
      <button type="button" aria-label="Další obrázek" title="Další obrázek" disabled={position >= total - 1} onClick={() => onStep(1)} className={`${action} absolute right-3 top-1/2 bg-[var(--bg-elevated)]`}><ArrowRight size={18} /></button>
    </div>
  </div>;
}
