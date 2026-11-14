import { useEffect, useRef, useState } from "react";

export function useBecameVisible() {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- IntersectionObserver defers loading image bytes until the tile scrolls into view
  useEffect(() => {
    const element = ref.current;
    if (element === null || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, visible };
}
