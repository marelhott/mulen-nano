import { useEffect, useRef } from 'react';
import { subscribeToGeneratedImageDeletion } from '../utils/generatedImageEvents';

export function useGeneratedImageDeletion(onDelete: (ids: Set<string>) => void): void {
  const callback = useRef(onDelete);
  callback.current = onDelete;
  useEffect(() => subscribeToGeneratedImageDeletion((ids) => callback.current(ids)), []);
}
