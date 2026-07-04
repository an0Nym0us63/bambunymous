import { useEffect, useRef } from "react";

export default function useSwipeToClose(ref, onClose, threshold = 80) {
  const startY = useRef(null);

  useEffect(() => {
    const el = ref?.current;
    if (!el || !onClose) return;

    const onStart = (e) => { startY.current = e.touches[0].clientY; };
    const onMove  = (e) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0) el.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = (e) => {
      const dy = startY.current !== null ? e.changedTouches[0].clientY - startY.current : 0;
      el.style.transform = "";
      startY.current = null;
      if (dy > threshold) onClose();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove",  onMove,  { passive: true });
    el.addEventListener("touchend",   onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, [ref, onClose, threshold]);
}
