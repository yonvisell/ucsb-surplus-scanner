import type { Category } from "./types";

type IdentifierKind = "serial" | "product" | "order" | "asset" | "unknown";
export interface LabelIdentifier {
  label: string;
  value: string;
  kind: IdentifierKind;
}
export interface LabelAnalysis {
  fields: Partial<{
    serial: string;
    manufacturer: string;
    model: string;
    category: Category;
  }>;
  identifiers: LabelIdentifier[];
}

// Other printed field names delimit values; they are never serial evidence.
const markerPattern =
  /(^[\s"'‘’“”`•·|]*|[\s;,|])((?:serial\s*(?:number|no\.?|#)?|s\s*\/\s*n|s\/n|sn|service\s+tag)|(?:mtm|machine\s+type\s+model|p\s*\/\s*n|part\s+(?:number|no\.?)|product\s+(?:number|no\.?))|(?:m\s*\/\s*o|mo|manufacturing\s+order)|(?:asset\s*(?:tag|number|no\.?))|(?:model\s+name|model)|(?:manufactured\s+(?:for|by)|manufacturer)|(?:fcc\s+id|ic|input|output|rating|rated|voltage|current|power|mfg\s+date|manufacturing\s+date|date|made\s+in|country|regulatory\s+model|type|ean|upc|imei|mac(?:\s+address)?))\s*(?:\([^\n)]*\))?(?:\s*[:#=]\s*|\s+|$)/gi;

function classify(label: string): {
  kind: IdentifierKind | "model" | "manufacturer" | "metadata";
  label: string;
} {
  const key = label.toLowerCase().replace(/[\s./#]/g, "");
  if (/^(serial(number|no)?|sn|servicetag)$/.test(key)) {
    return {
      kind: "serial",
      label: key === "servicetag" ? "Service tag" : "Serial number",
    };
  }
  if (
    /^(mtm|machinetypemodel|pn|part(number|no)|product(number|no))$/.test(key)
  ) {
    return {
      kind: "product",
      label: /^(mtm|machinetypemodel)$/.test(key)
        ? "MTM"
        : "Product / part number",
    };
  }
  if (/^(mo|manufacturingorder)$/.test(key))
    return { kind: "order", label: "MO" };
  if (key.startsWith("asset")) return { kind: "asset", label: "Asset tag" };
  if (key === "model" || key === "modelname")
    return { kind: "model", label: "Model" };
  if (/^(manufacturer|manufacturedfor|manufacturedby)$/.test(key))
    return { kind: "manufacturer", label: "Manufacturer" };
  return { kind: "metadata", label };
}

function trimValue(value: string): string {
  return value
    .trim()
    .replace(/^[;|,]+|[;|,]+$/g, "")
    .trim();
}

function isIdentifier(value: string): boolean {
  return (
    /^(?=.{3,64}$)[a-z0-9][a-z0-9._/-]*$/i.test(value) &&
    !/^(?:unknown|none|missing|unavailable|n\/a|serial|number|not|yes|no|null)$/i.test(
      value,
    ) &&
    !/^www\./i.test(value)
  );
}

function unique(values: string[]): string | undefined {
  const distinct = new Map(values.map((value) => [value.toUpperCase(), value]));
  return distinct.size === 1 ? distinct.values().next().value : undefined;
}

function laptopModel(model: string): boolean {
  // Family names alone can also occur in marketing text or desktop labels.
  return (
    /\b(?:thinkpad\s+(?:[a-z]\d|x1)|legion\s+(?:pro\s+|slim\s+)?[579]\b|ideapad\s+(?:slim\s+|gaming\s+)?\d|latitude\s+\d{3,4}\b|(?:elitebook|probook)\s+\d|macbook\s+(?:air|pro)\b|surface\s+laptop\b)/i.test(
      model,
    ) && !/\b(?:tower|desktop|aio|all.in.one)\b/i.test(model)
  );
}

/** Proposes fields only from explicit label evidence; untyped codes remain untyped. */
export function analyzeLabel(
  text: string,
  codes: { value: string; format: string }[],
): LabelAnalysis {
  const identifiers: LabelIdentifier[] = [];
  const models: string[] = [];
  const manufacturers: string[] = [];
  const nonSerialTokens = new Set<string>();

  function parse(source: string): number {
    const initialCount = identifiers.length;
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (/^\s*(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i.test(line)) continue;
      const markers = [...line.matchAll(markerPattern)];
      for (let index = 0; index < markers.length; index++) {
        const marker = markers[index];
        const field = classify(marker[2]);
        const start = marker.index! + marker[0].length;
        const end = markers[index + 1]?.index ?? line.length;
        let value = trimValue(line.slice(start, end));
        if (!value && index === markers.length - 1) {
          // OCR layout separates a field heading and its value with blank
          // lines. Stop at the next nonempty line, including another heading.
          let nextIndex = lineIndex + 1;
          while (nextIndex < lines.length && !lines[nextIndex].trim())
            nextIndex++;
          const nextLine = lines[nextIndex]?.trim() ?? "";
          if (![...nextLine.matchAll(markerPattern)].length)
            value = trimValue(nextLine);
        }
        if (!value) continue;
        if (field.kind !== "serial") {
          for (const token of value.match(/[a-z0-9][a-z0-9._/-]*/gi) ?? [])
            nonSerialTokens.add(token.toUpperCase());
        }
        if (field.kind === "metadata") continue;
        // OCR may read an isolated edge or quote before descriptive text.
        // Do not apply this cleanup to identifier values.
        if (field.kind === "model" || field.kind === "manufacturer") {
          value = value.replace(/^[\s"'‘’“”`•·|]+/u, "");
        }
        if (field.kind === "model") {
          if (value.length <= 100 && !/:\/\//.test(value)) models.push(value);
        } else if (field.kind === "manufacturer") {
          const known = value.match(
            /^(Lenovo|Dell|HP|Hewlett[- ]Packard|Apple|Microsoft|Samsung|Acer|ASUS|Toshiba|LG|Cisco|Epson)\b/i,
          )?.[1];
          if (known) {
            const canonical: Record<string, string> = {
              lenovo: "Lenovo",
              dell: "Dell",
              hp: "HP",
              apple: "Apple",
              microsoft: "Microsoft",
              samsung: "Samsung",
              acer: "Acer",
              asus: "ASUS",
              toshiba: "Toshiba",
              lg: "LG",
              cisco: "Cisco",
              epson: "Epson",
            };
            manufacturers.push(canonical[known.toLowerCase()] ?? "HP");
          }
        } else if (isIdentifier(value)) {
          identifiers.push({ kind: field.kind, label: field.label, value });
        }
      }
    }
    return identifiers.length - initialCount;
  }

  parse(text);
  for (const code of codes) {
    const value = code.value.trim();
    if (value && parse(value) === 0) {
      identifiers.push({
        label: code.format ? `Code (${code.format})` : "Code",
        value,
        kind: "unknown",
      });
    }
  }
  const fields: LabelAnalysis["fields"] = {};
  const model = unique(models);
  const manufacturer = unique(manufacturers);
  const order = unique(
    identifiers
      .filter((item) => item.kind === "order")
      .map((item) => item.value),
  );
  if (manufacturer === "Lenovo" && order) {
    const printedTokens = new Set(
      (text.match(/[a-z0-9][a-z0-9._/-]*/gi) ?? []).map((token) =>
        token.toUpperCase(),
      ),
    );
    for (const code of codes) {
      if (!/^qr(?:code)?$/i.test(code.format.replace(/[ _-]/g, ""))) continue;
      const value = code.value.trim().toUpperCase();
      if (!/^[A-Z0-9]+$/.test(value) || !value.endsWith(order.toUpperCase()))
        continue;
      const prefix = value.slice(0, -order.length);
      // Some Lenovo QR labels concatenate serial + MO. Splitting requires
      // independent printed agreement and must not reuse another named field.
      if (
        isIdentifier(prefix) &&
        printedTokens.has(prefix) &&
        !nonSerialTokens.has(prefix)
      ) {
        identifiers.push({
          label: "Serial (text + QR)",
          value: prefix,
          kind: "serial",
        });
      }
    }
  }
  const serial = unique(
    identifiers
      .filter((item) => item.kind === "serial")
      .map((item) => item.value),
  );
  if (serial) fields.serial = serial;
  if (model) fields.model = model;
  if (manufacturer) fields.manufacturer = manufacturer;
  if (model && laptopModel(model)) fields.category = "Laptop";
  return {
    fields,
    identifiers: identifiers.filter(
      (item, index) =>
        identifiers.findIndex(
          (other) =>
            other.kind === item.kind &&
            other.value.toUpperCase() === item.value.toUpperCase(),
        ) === index,
    ),
  };
}
