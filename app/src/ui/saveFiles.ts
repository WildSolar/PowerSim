import { toDateMs } from "../sim/calendar";

/** Offers text to the player as a file to keep. */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "commune-zero-schlieren-2031-03.txt" */
export function saveFileName(municipality: string, simTimeMs: number): string {
  const d = new Date(toDateMs(simTimeMs));
  const slug = municipality
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `commune-zero-${slug}-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}.txt`;
}

/** When a save was made, in the player's own time: "today 14:05", or a date. */
export function savedAtLabel(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString("de-CH")} ${time}`;
}
