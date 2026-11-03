import React, { useEffect, useRef } from 'react';

/** Zavolá onMore, když se značka přiblíží k viditelné oblasti; `token` (např. počet zobrazených položek) znovu spustí kontrolu. */
export function InfiniteSentinel(props: { onMore: () => void; token: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(props.onMore);
  callback.current = props.onMore;
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) callback.current(); }, { rootMargin: '800px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.token]);
  return <div ref={ref} aria-hidden="true" className="h-px w-full" />;
}
