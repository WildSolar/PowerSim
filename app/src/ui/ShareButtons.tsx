import { Check, Copy, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "./feedback";
import { canShareNatively, GAME_URL, shareLinks, shareNatively } from "./share";
import "./share.css";

/** The ways to share a line of text with the game's link: the browser's own share sheet where
 * there is one, each platform's share page, and copying. */
export function ShareButtons({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="share-buttons">
      {canShareNatively() && (
        <button className="share-native" onClick={() => void shareNatively(text)}>
          <Share2 size={15} strokeWidth={1.9} aria-hidden /> Share…
        </button>
      )}
      {shareLinks(text).map((l) => (
        <a key={l.id} className="share-link" href={l.href} target="_blank" rel="noopener noreferrer">
          {l.label}
        </a>
      ))}
      <button className="share-link" onClick={async () => setCopied(await copyText(`${text} ${GAME_URL}`))}>
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** The text to share, shown as it will read, and the ways to share it. */
export function SharePreview({ text }: { text: string }) {
  return (
    <>
      <p className="share-text">
        {text} <span className="share-url">{GAME_URL.replace(/^https:\/\//, "")}</span>
      </p>
      <ShareButtons text={text} />
    </>
  );
}

/** A small window for telling a friend about the game (the start screen's "Tell a friend"). */
export function ShareDialog({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="share-layer">
      <div className="share-scrim" onClick={onClose} />
      <div className="share-dialog" role="dialog" aria-labelledby="share-title">
        <header>
          <h2 id="share-title">Tell a friend</h2>
          <button className="share-close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        <p className="share-intro">Know someone who'd enjoy running a Swiss town's energy? Send them this:</p>
        <SharePreview text={text} />
      </div>
    </div>
  );
}
