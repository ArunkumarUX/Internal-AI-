/**
 * Structured analysis over uploaded CSV files for the "Data analysis" skill.
 * The model describes a query as JSON; nothing it sends is executed as code.
 */

export type Table = { columns: string[]; rows: string[][]; decimalComma?: boolean };

export function parseCsv(text: string, maxRows = 50000): Table {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const delimiter =
    (text.split("\n", 1)[0].match(/;/g)?.length ?? 0) >
    (text.split("\n", 1)[0].match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  for (let i = 0; i < text.length && rows.length <= maxRows; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim())) rows.push(row);
  }
  const [header = [], ...body] = rows;
  const columns = header.map((h, i) => h.trim() || `column_${i + 1}`);
  return {
    columns,
    rows: body.map((r) => columns.map((_, i) => (r[i] ?? "").trim())),
    // Semicolon-separated files normally use a decimal comma (1.234,56).
    decimalComma: delimiter === ";",
  };
}

const num = (v: string, decimalComma = false) => {
  let cleaned = v.replace(/[£$€₹%\s]/g, "");
  cleaned = decimalComma
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/,/g, "");
  return cleaned && !Number.isNaN(Number(cleaned)) ? Number(cleaned) : null;
};

export function describe(table: Table) {
  return table.columns.map((c, i) => {
    const values = table.rows.slice(0, 200).map((r) => r[i]).filter(Boolean);
    const numeric = values.length > 0 && values.every((v) => num(v, table.decimalComma) !== null);
    return { name: c, type: numeric ? "number" : "text", sample: values.slice(0, 3) };
  });
}

type Filter = { column: string; op: string; value: string | number };
type Metric = { fn: "count" | "sum" | "avg" | "min" | "max"; column?: string; as?: string };
export type Query = {
  select?: string[];
  filters?: Filter[];
  group_by?: string[];
  metrics?: Metric[];
  sort?: { column: string; direction?: "asc" | "desc" }[];
  limit?: number;
};

export function runQuery(table: Table, q: Query) {
  const index = (name: string) => {
    const i = table.columns.findIndex((c) => c.toLowerCase() === String(name).toLowerCase());
    if (i < 0) throw new Error(`Unknown column "${name}". Columns: ${table.columns.join(", ")}`);
    return i;
  };
  const n = (v: string) => num(v, table.decimalComma);
  let rows = table.rows;
  for (const f of q.filters ?? []) {
    const i = index(f.column);
    const target = String(f.value ?? "").toLowerCase();
    const fv = typeof f.value === "number" ? f.value : n(String(f.value ?? ""));
    rows = rows.filter((r) => {
      const v = r[i] ?? "";
      const vn = n(v);
      switch (f.op) {
        case "=": case "==": case "eq": return v.toLowerCase() === target || (vn !== null && vn === fv);
        case "!=": case "ne": return v.toLowerCase() !== target && !(vn !== null && vn === fv);
        case ">": return vn !== null && fv !== null && vn > fv;
        case ">=": return vn !== null && fv !== null && vn >= fv;
        case "<": return vn !== null && fv !== null && vn < fv;
        case "<=": return vn !== null && fv !== null && vn <= fv;
        case "contains": return v.toLowerCase().includes(target);
        default: throw new Error(`Unsupported filter operator "${f.op}".`);
      }
    });
  }
  let columns: string[];
  let out: (string | number)[][];
  const metrics = q.metrics ?? [];
  if (q.group_by?.length || metrics.length) {
    const keys = (q.group_by ?? []).map(index);
    const groups = new Map<string, string[][]>();
    for (const r of rows) {
      const k = JSON.stringify(keys.map((i) => r[i]));
      let group = groups.get(k);
      if (!group) groups.set(k, (group = []));
      group.push(r);
    }
    // An overall aggregate with no matching rows is still one row (count 0).
    if (!keys.length && !groups.size) groups.set("[]", []);
    const ms = metrics.length ? metrics : [{ fn: "count" as const }];
    columns = [
      ...(q.group_by ?? []).map((c) => table.columns[index(c)]),
      ...ms.map((m) => m.as || (m.column ? `${m.fn}(${m.column})` : m.fn)),
    ];
    out = [...groups.entries()].map(([k, members]) => [
      ...(JSON.parse(k) as string[]),
      ...ms.map((m) => {
        if (m.fn === "count") return members.length;
        const i = index(m.column ?? "");
        const values = members.map((r) => n(r[i])).filter((v): v is number => v !== null);
        if (!values.length) return 0;
        const total = values.reduce((a, b) => a + b, 0);
        const value =
          m.fn === "sum" ? total
          : m.fn === "avg" ? total / values.length
          : m.fn === "min" ? Math.min(...values)
          : Math.max(...values);
        return Math.round(value * 100) / 100;
      }),
    ]);
  } else {
    const picked = (q.select?.length ? q.select : table.columns).map(index);
    columns = picked.map((i) => table.columns[i]);
    out = rows.map((r) => picked.map((i) => r[i]));
  }
  // Grouped results default to the first metric, highest first.
  const sorts = q.sort?.length
    ? q.sort
    : q.group_by?.length || metrics.length
      ? [{ column: columns[columns.length - (metrics.length || 1)], direction: "desc" as const }]
      : [];
  for (const s of [...sorts].reverse()) {
    const i = columns.findIndex((c) => c.toLowerCase() === s.column.toLowerCase());
    if (i < 0) continue;
    const dir = s.direction === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const x = typeof a[i] === "number" ? (a[i] as number) : n(String(a[i]));
      const y = typeof b[i] === "number" ? (b[i] as number) : n(String(b[i]));
      if (x !== null && y !== null) return (x - y) * dir;
      return String(a[i]).localeCompare(String(b[i])) * dir;
    });
  }
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const sort = sorts[0];
  return {
    columns,
    rows: out.slice(0, limit),
    matched: out.length,
    sortedBy: sort ? { column: columns.find((c) => c.toLowerCase() === sort.column.toLowerCase()), direction: sort.direction ?? "asc" } : undefined,
  };
}

export function toMarkdown(result: {
  columns: string[];
  rows: (string | number)[][];
  matched: number;
  sortedBy?: { column?: string; direction: string };
}) {
  const esc = (v: string | number) => String(v).replace(/\|/g, "\\|");
  // Name the top and bottom rows only when they really are the extremes:
  // sorted by a numeric column and every matching row is shown.
  const col = result.sortedBy?.column ? result.columns.indexOf(result.sortedBy.column) : -1;
  const labels = (r: (string | number)[]) =>
    r.filter((_, i) => i !== col && typeof r[i] !== "number").join(" / ") || "(all rows)";
  const numeric = col >= 0 && result.rows.length > 1 && result.rows.every((r) => typeof r[col] === "number");
  let summary = "";
  if (numeric && result.rows.length === result.matched) {
    const [hi, lo] = result.sortedBy!.direction === "desc"
      ? [result.rows[0], result.rows.at(-1)!]
      : [result.rows.at(-1)!, result.rows[0]];
    summary = `By ${result.columns[col]}: highest is ${labels(hi)} (${hi[col]}), lowest is ${labels(lo)} (${lo[col]}).\n\n`;
  }
  return summary + [
    `| ${result.columns.map(esc).join(" | ")} |`,
    `| ${result.columns.map(() => "---").join(" | ")} |`,
    ...result.rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
    result.matched > result.rows.length ? `\n(showing ${result.rows.length} of ${result.matched} rows)` : "",
  ].join("\n");
}
