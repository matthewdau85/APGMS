import React from "react";
import helpIndexData from "../help/HelpIndex.json";
import { HelpIndex } from "../help/types";
import { useHelp } from "../help/useHelp";
import HelpTip from "../components/HelpTip";

const helpIndex = helpIndexData as HelpIndex;

export default function Help() {
  const { openWithTag, openWithMode, openDrawer } = useHelp();

  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Help & Guidance</h1>
          <p className="text-sm text-muted-foreground">
            Explore guides, compliance tips, and release notes for PAYGW, GST, and BAS operations.
          </p>
        </div>
        <HelpTip label="Open drawer" />
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">What’s New</h2>
        {helpIndex.whatsNew.map((entry) => (
          <article key={entry.id} id={entry.slug} className="bg-card p-4 rounded-xl shadow space-y-2">
            <header className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{entry.title}</h3>
              <span className="text-xs text-gray-500">{formatDate(entry.date)}</span>
            </header>
            <p className="text-sm text-gray-700">{entry.summary}</p>
            <footer className="text-sm text-blue-600">
              <button type="button" className="underline" onClick={() => openDrawer()}>
                View in help drawer
              </button>
            </footer>
          </article>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Topics</h2>
        {helpIndex.topics.map((topic) => (
          <article key={topic.id} id={topic.slug} className="bg-card p-4 rounded-xl shadow space-y-2">
            <header className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{topic.title}</h3>
              <span className="text-xs text-gray-500">
                Last updated {topic.lastUpdated ? new Date(topic.lastUpdated).toLocaleDateString() : "recently"}
              </span>
            </header>
            <p className="text-sm text-gray-700">{topic.summary}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {topic.modes.map((mode) => (
                <button
                  type="button"
                  key={`${topic.id}-mode-${mode}`}
                  className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded"
                  onClick={() => openWithMode(mode)}
                >
                  {mode}
                </button>
              ))}
              {topic.tags.map((tag) => (
                <button
                  type="button"
                  key={`${topic.id}-tag-${tag}`}
                  className="px-2 py-1 bg-slate-100 text-slate-700 rounded"
                  onClick={() => openWithTag(tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
            {topic.links.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-blue-700">
                {topic.links.map((link) => (
                  <li key={`${topic.id}-${link.href}`}>
                    <a href={link.href} target="_blank" rel="noreferrer" className="underline">
                      {link.text}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
