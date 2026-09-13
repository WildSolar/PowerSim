import { useState } from "react";
import { WIKI_SECTIONS } from "./wikiContent";
import "./wiki.css";

export interface WikiPanelProps {
  onClose: () => void;
}

export function WikiPanel({ onClose }: WikiPanelProps) {
  const [activeId, setActiveId] = useState(WIKI_SECTIONS[0].id);
  const active = WIKI_SECTIONS.find((s) => s.id === activeId) ?? WIKI_SECTIONS[0];

  return (
    <div className="wiki-backdrop" onClick={onClose}>
      <div className="wiki-modal" onClick={(e) => e.stopPropagation()}>
        <button className="wiki-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <nav className="wiki-nav">
          <h2>Wiki</h2>
          <ul>
            {WIKI_SECTIONS.map((s) => (
              <li key={s.id}>
                <button className={s.id === activeId ? "active" : ""} onClick={() => setActiveId(s.id)}>
                  <span className="wiki-nav-icon">{s.icon}</span>
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="wiki-content">
          <h2>
            {active.icon} {active.title}
          </h2>
          {active.blocks.map((block, i) => {
            if (block.type === "p") return <p key={i}>{block.text}</p>;
            if (block.type === "note")
              return (
                <div key={i} className="wiki-note">
                  {block.text}
                </div>
              );
            return (
              <ul key={i} className="wiki-list">
                {block.items?.map((item, j) => <li key={j}>{item}</li>)}
              </ul>
            );
          })}
        </div>
      </div>
    </div>
  );
}
