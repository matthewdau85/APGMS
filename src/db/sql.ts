export type SqlQuery = { text: string; params: any[] };

export function sql(strings: TemplateStringsArray, ...values: any[]): SqlQuery {
  let text = "";
  const params: any[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  }
  return { text: text.replace(/\s+/g, " ").trim(), params };
}

export function sqlRaw(text: string, params: any[] = []): SqlQuery {
  return { text, params };
}
