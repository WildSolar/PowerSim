import { useState } from "react";
import { WIKI_SECTIONS } from "./wikiContent";
import "./modal.css";

export interface WikiPanelProps {
  onClose: () => void;
}

export function WikiPanel({ onClose }: WikiPanelProps) {
  const [activeId, setActiveId] = useState(WIKI_SECTIONS[0].id);
  const active = WIKI_SECTIONS.find((s) => s.id === activeId) ?? WIKI_SECTIONS[0];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <nav className="modal-nav">
          <h2>Wiki</h2>
          <ul>
            {WIKI_SECTIONS.map((s) => (
              <li key={s.id}>
                <button className={s.id === activeId ? "active" : ""} onClick={() => setActiveId(s.id)}>
                  <span className="modal-nav-icon">{s.icon}</span>
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="modal-content">
          <h2>
            {active.icon} {active.title}
          </h2>
          {active.blocks.map((block, i) => {
            if (block.type === "p") return <p key={i}>{block.text}</p>;
            if (block.type === "note")
              return (
                <div key={i} className="modal-note">
                  {block.text}
                </div>
              );
            return (
              <ul key={i} className="modal-list">
                {block.items?.map((item, j) => <li key={j}>{item}</li>)}
              </ul>
            );
          })}
        </div>
      </div>
    </div>
  );
}
