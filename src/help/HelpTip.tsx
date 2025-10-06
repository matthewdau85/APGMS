import React from "react";
import { useHelpCenter } from "./HelpProvider";

type HelpTipProps = {
  slug: string;
  children: React.ReactNode;
  description?: string;
};

export default function HelpTip({ slug, children, description }: HelpTipProps) {
  const { open } = useHelpCenter();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        open({ pane: "search", docSlug: slug });
      }}
      title={description ?? "Open contextual help"}
      style={{
        border: "none",
        background: "rgba(15, 118, 110, 0.1)",
        color: "#0f766e",
        borderRadius: "999px",
        padding: "2px 10px",
        fontSize: "0.8rem",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
