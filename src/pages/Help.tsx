import React, { useEffect, useState } from 'react';

type FeedPreview = {
  order: number;
  fileName: string;
  fileRelative: string;
  title?: string;
  preview: string;
};

export default function Help() {
  const [feedEntries, setFeedEntries] = useState<FeedPreview[]>([]);
  const [feedTotal, setFeedTotal] = useState<number | null>(null);
  const [feedTruncated, setFeedTruncated] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadFeed = async () => {
      if (typeof fetch !== "function") {
        if (!cancelled) {
          setFeedError("Fetch API is not available in this environment.");
          setFeedLoading(false);
        }
        return;
      }

      try {
        const response = await fetch("/api/ato-feed/manifest?limit=5&preview=true");
        if (!response.ok) {
          throw new Error(`Failed to load manifest (status ${response.status})`);
        }
        const data = await response.json();
        if (cancelled) return;

        const entries = Array.isArray(data.entries)
          ? (data.entries as FeedPreview[])
          : [];

        setFeedEntries(
          entries.map((entry) => ({
            order: entry.order,
            fileName: entry.fileName,
            fileRelative: entry.fileRelative,
            title: entry.title,
            preview: entry.preview ?? "",
          }))
        );
        setFeedTotal(typeof data.total === "number" ? data.total : null);
        setFeedTruncated(Boolean(data.truncated));
        setFeedLoading(false);
      } catch (error) {
        if (!cancelled) {
          setFeedError(error instanceof Error ? error.message : "Unknown error");
          setFeedLoading(false);
        }
      }
    };

    loadFeed();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Help & Guidance</h1>
      <p className="text-sm text-muted-foreground">
        Access support for PAYGW, GST, BAS and using this system.
      </p>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">Getting Started</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Set up your buffer accounts and payment schedule in <strong>Settings</strong>.</li>
          <li>Use the <strong>Wizard</strong> to define PAYGW and GST split rules.</li>
          <li>Review <strong>Dashboard</strong> for current obligations and payment alerts.</li>
          <li>Go to <strong>BAS</strong> to lodge your Business Activity Statement each quarter.</li>
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">ATO Compliance</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Use one-way tax accounts to prevent accidental use of withheld/collected funds.</li>
          <li>Audit trail with timestamped actions supports legal protection and evidence.</li>
          <li>Helps avoid wind-up notices, director penalties, and late lodgment fines.</li>
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">Support Links</h2>
        <ul className="list-disc pl-5 text-sm">
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/payg-withholding/">ATO PAYGW Guide</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/gst/">ATO GST Information</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/business-activity-statements-(bas)/">ATO BAS Portal</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/super-for-employers/">ATO Super Obligations</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/General/Online-services/">ATO Online Services</a></li>
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">ATO Knowledge Feed</h2>
          <p className="text-sm text-muted-foreground">
            Live excerpts from <code>docs/_codex_feed</code> are ingested into the app for quick reference.
          </p>
        </div>
        {feedLoading ? (
          <p className="text-sm text-muted-foreground">Loading manifest…</p>
        ) : feedError ? (
          <p className="text-sm text-red-600">{feedError}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Showing {feedEntries.length} of {feedTotal ?? feedEntries.length} chunks
              {feedTruncated ? " (truncated)" : ""}.
            </p>
            <ul className="space-y-3">
              {feedEntries.map((entry) => {
                const title = entry.title || entry.fileRelative || entry.fileName;
                return (
                  <li
                    key={entry.order}
                    className="bg-card border rounded-lg p-3 space-y-2 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{title}</span>
                      <span className="text-xs text-muted-foreground">#{entry.order}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {entry.preview ? entry.preview : "No preview available for this chunk."}
                    </p>
                    <div>
                      <a
                        className="text-xs font-medium text-blue-600 hover:underline"
                        href={`/api/ato-feed/chunk/${entry.order}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View full chunk
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
