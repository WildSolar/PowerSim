import { useEffect, type RefObject } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { hasModifier, isTypingTarget } from "../ui/keyboard";

const PAN_PX_PER_SEC = 450;
const ROTATE_DEG_PER_SEC = 60;
const TILT_DEG_PER_SEC = 40;

const HANDLED_KEYS = new Set(["w", "a", "s", "d", "q", "e", "f", "r"]);

/** Hold-to-move camera controls: WASD pans (relative to the current view direction,
 * so W is always "up the screen"), Q/E rotate, R/F tilt the view toward/away from the
 * horizon. Runs its own frame loop only while a key is held. */
export function useMapKeyboard(mapRef: RefObject<MlMap | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const held = new Set<string>();
    let rafId: number | null = null;
    let lastTime = 0;

    const frame = (now: number) => {
      const map = mapRef.current;
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      if (map && held.size > 0) {
        const dx = (held.has("d") ? 1 : 0) - (held.has("a") ? 1 : 0);
        const dy = (held.has("s") ? 1 : 0) - (held.has("w") ? 1 : 0);
        if (dx !== 0 || dy !== 0) {
          const d = PAN_PX_PER_SEC * dt;
          map.panBy([dx * d, dy * d], { animate: false });
        }
        const turn = (held.has("e") ? 1 : 0) - (held.has("q") ? 1 : 0);
        if (turn !== 0) map.setBearing(map.getBearing() + turn * ROTATE_DEG_PER_SEC * dt);
        const tilt = (held.has("r") ? 1 : 0) - (held.has("f") ? 1 : 0);
        if (tilt !== 0) map.setPitch(map.getPitch() + tilt * TILT_DEG_PER_SEC * dt);
      }
      rafId = held.size > 0 ? requestAnimationFrame(frame) : null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!HANDLED_KEYS.has(key) || hasModifier(e) || isTypingTarget(e.target)) return;
      held.add(key);
      if (rafId === null) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    // Keys released while the window is unfocused never fire keyup.
    const onBlur = () => held.clear();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [mapRef, enabled]);
}
