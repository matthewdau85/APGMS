import React from 'react';
import Page from '../components/Page';
import type { PageMeta } from '../help/HelpContext';
import { helpArticles } from '../help/helpArticles';

export const meta: PageMeta = {
  title: 'Help Center',
  description: 'Browse help topics and open the in-app help drawer.',
  helpSlug: 'getting-started',
  route: '/help',
};

export default function Help() {
  return (
    <Page meta={meta}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Help & Guidance</h1>
          <p className="text-sm text-muted-foreground">
            Use <strong>Shift + /</strong> anywhere in the app to open the help drawer. Search articles below
            or jump straight to the documentation site.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {helpArticles.map((article) => (
            <div key={article.slug} className="bg-card p-4 rounded-xl shadow space-y-2">
              <h2 className="text-lg font-semibold">{article.title}</h2>
              <p className="text-sm text-muted-foreground">{article.summary}</p>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-[#00716b]">Help drawer search: "{article.title}"</span>
                <a
                  className="text-blue-600 hover:underline"
                  href={article.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in docs ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Page>
  );
}
