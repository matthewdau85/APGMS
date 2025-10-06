export interface HelpLink {
  href: string;
  text: string;
}

export interface HelpTopic {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  modes: string[];
  lastUpdated: string | null;
  summary: string;
  body: string;
  links: HelpLink[];
}

export interface WhatsNewEntry {
  id: string;
  slug: string;
  title: string;
  date: string;
  tags: string[];
  lastUpdated: string | null;
  summary: string;
  body: string;
  links: HelpLink[];
}

export interface HelpIndex {
  generatedAt: string;
  topics: HelpTopic[];
  whatsNew: WhatsNewEntry[];
  tags: string[];
  modes: string[];
}
