"use client";

import { useState } from 'react';
import { generateWorkflowId } from '@/store/workflowStore';

interface ProjectSetupModalProps { isOpen: boolean; onClose: () => void; onSave: (id: string, name: string, directoryPath: string) => void; mode: 'new' | 'settings'; }

export function ProjectSetupModal({ isOpen, onClose, onSave, mode }: ProjectSetupModalProps) {
  const [name, setName] = useState('Nový workflow');
  const [directoryPath, setDirectoryPath] = useState('');
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="w-full max-w-md rounded-xl border border-neutral-700 bg-neutral-900 p-5"><h2 className="text-base font-semibold text-white">{mode === 'new' ? 'Nový workflow' : 'Nastavení workflow'}</h2><p className="mt-2 text-sm text-neutral-400">Workflow používá jedinou AI gateway OpenRouter. Model se vybírá přímo v uzlu.</p><input className="mt-5 w-full rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm text-white" value={name} onChange={(e) => setName(e.target.value)} /><input className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm text-white" placeholder="Volitelná složka pro výstupy" value={directoryPath} onChange={(e) => setDirectoryPath(e.target.value)} /><div className="mt-5 flex justify-end gap-2"><button className="text-sm text-neutral-400" onClick={onClose}>Zavřít</button><button className="rounded-md bg-white px-3 py-2 text-sm text-black" onClick={() => { onSave(generateWorkflowId(), name.trim() || 'Nový workflow', directoryPath); onClose(); }}>Uložit</button></div></div></div>;
}
