import { CheckStatus } from "./checks";

const COLORS: Record<CheckStatus, string> = {
  pass: "#1f9d55",
  warn: "#f0ad4e",
  fail: "#d9534f"
};

export function renderBadge(label: string, status: CheckStatus, valueText?: string): string {
  const color = COLORS[status];
  const text = valueText ?? status.toUpperCase();
  const left = label.toUpperCase();
  const right = text;
  const leftWidth = 6 * left.length + 20;
  const rightWidth = 6 * right.length + 20;
  const width = leftWidth + rightWidth;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${left}: ${right}">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7" />
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1" />
    <stop offset=".9" stop-color="#000" stop-opacity=".3" />
    <stop offset="1" stop-color="#000" stop-opacity=".5" />
  </linearGradient>
  <mask id="round">
    <rect width="${width}" height="20" rx="3" fill="#fff" />
  </mask>
  <g mask="url(#round)">
    <rect width="${leftWidth}" height="20" fill="#555" />
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}" />
    <rect width="${width}" height="20" fill="url(#smooth)" />
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
    <text x="${leftWidth / 2}" y="14">${escapeText(left)}</text>
    <text x="${leftWidth + rightWidth / 2}" y="14">${escapeText(right)}</text>
  </g>
</svg>`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
