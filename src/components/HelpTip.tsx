import React from "react";
import { useHelp } from "../help/useHelp";

interface HelpTipProps {
  tag?: string;
  mode?: string;
  label?: string;
  className?: string;
}

export default function HelpTip({ tag, mode, label = "Help", className }: HelpTipProps) {
  const { openWithTag, openWithMode, openDrawer } = useHelp();

  const handleClick = () => {
    if (tag) {
      openWithTag(tag);
    } else if (mode) {
      openWithMode(mode);
    } else {
      openDrawer();
    }
  };

  return (
    <button
      type="button"
      className={`help-tip ${className ?? ""}`.trim()}
      onClick={handleClick}
      aria-label={label}
    >
      <span className="help-tip__icon">?</span>
      <span className="help-tip__label">{label}</span>
    </button>
  );
}
