import { reactionText, type MeasureReaction } from "../sim/approval";
import "./reactionBadge.css";

/** How the public is likely to take a decision: a five-dot gauge, the step's name (very unpopular to
 * very popular), and — if some group feels strongly for and another strongly against — that it splits
 * opinion. */
export function ReactionBadge({ reaction }: { reaction: MeasureReaction }) {
  return (
    <span
      className={`reaction ${reaction.tone}`}
      title={`How people are likely to take it, on balance — from very unpopular to very popular.${
        reaction.divisive ? " It splits opinion: some groups feel strongly for it, others strongly against, whichever way the balance tips." : ""
      }`}
      aria-label={reactionText(reaction)}
    >
      <span className={`reaction-gauge level-${reaction.level}`} aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i <= reaction.level ? "on" : undefined} />
        ))}
      </span>
      <span aria-hidden>
        {reaction.label}
        {reaction.divisive && <span className="reaction-split"> · splits opinion</span>}
      </span>
    </span>
  );
}
