import React from "react";
import { useSupport } from "../context/SupportContext";
import { getHelpArticleById } from "../support/helpContent";

type HelpTipProps = {
  articleId: string;
  label?: string;
};

export default function HelpTip({ articleId, label }: HelpTipProps) {
  const { openHelpCenter } = useSupport();
  const article = getHelpArticleById(articleId);
  const accessibleLabel = label ?? article?.title ?? "Open help";
  const searchQuery = article ? article.keywords.join(" ") || article.title : undefined;

  return (
    <button
      type="button"
      className="help-tip"
      onClick={() => openHelpCenter({ articleId, query: searchQuery })}
      aria-label={accessibleLabel}
      title={article?.title ?? accessibleLabel}
    >
      ?
    </button>
  );
}
