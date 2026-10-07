// Fills the generated regions of the docs design pages from the tokens in
// web/src/design.css, so the docs always show the values the web UI uses.
// With --check it writes nothing and fails if any region is out of date.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema } from "effect";

const designFile = "web/src/design.css";

const tokensPage = "docs/src/content/docs/design/index.md";

const coloursPage = "docs/src/content/docs/design/colours.mdx";

const themeFile = "docs/theme.css";

const check = process.argv.includes("--check");

class DesignReferenceError extends Schema.TaggedError<DesignReferenceError>()(
  "DesignReferenceError",
  { message: Schema.String },
) {}

type Tokens = ReadonlyMap<string, string>;

const media = {
  dark: "(prefers-color-scheme: dark)",
  p3: "(color-gamut: p3)",
  p3Dark: "(color-gamut: p3) and (prefers-color-scheme: dark)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
} as const;

const normalise = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")").trim();

const declarations = (block: string): Tokens =>
  new Map(
    [
      ...block
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/--triage-([\w-]+):\s*([^;]+);/g),
    ].map(([, name = "", value = ""]) => [name, normalise(value)]),
  );

const parseDesign = (css: string) =>
  Effect.gen(function* () {
    const root = /^:root \{([\s\S]*?)^\}/m.exec(css)?.[1];

    if (root === undefined) {
      return yield* new DesignReferenceError({
        message: `No top-level :root block in ${designFile}`,
      });
    }

    const blocks = new Map(
      [...css.matchAll(/^@media (.+?) \{\s*:root \{([\s\S]*?)^ {2}\}/gm)].map(
        ([, query = "", block = ""]) => [query, declarations(block)],
      ),
    );

    const block = (query: string) =>
      Effect.fromNullishOr(blocks.get(query)).pipe(
        Effect.mapError(
          () =>
            new DesignReferenceError({
              message: `No @media ${query} :root block in ${designFile}`,
            }),
        ),
      );

    return {
      root: declarations(root),
      dark: yield* block(media.dark),
      p3: yield* block(media.p3),
      p3Dark: yield* block(media.p3Dark),
      reducedMotion: yield* block(media.reducedMotion),
    };
  });

type Design = Effect.Success<ReturnType<typeof parseDesign>>;

const merge = (...layers: ReadonlyArray<Tokens>): Tokens =>
  new Map(layers.flatMap((layer) => [...layer]));

const resolve = (tokens: Tokens, value: string): string =>
  value.replace(/var\(--triage-([\w-]+)\)/g, (match, name: string) => {
    const referenced = tokens.get(name);

    return referenced === undefined ? match : resolve(tokens, referenced);
  });

const isColour = (value: string) =>
  /^(oklch|color-mix)\(/.test(value) && !value.includes(" / ");

const code = (value: string) => `\`${value}\``;

const token = (name: string) => code(`--triage-${name}`);

const table = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
) => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map(
    (row) =>
      `|${row.map((cell) => (cell === "" ? " |" : ` ${cell} |`)).join("")}`,
  ),
];

// The hand-written last column of each table row, by token, so regenerating
// a table keeps it.
const handWritten = (region: ReadonlyArray<string>) =>
  new Map(
    region.flatMap((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      const name = /^`--triage-([\w-]+)`$/.exec(cells[1] ?? "")?.[1];

      return name === undefined ? [] : [[name, cells.at(-2) ?? ""]];
    }),
  );

interface Region {
  readonly name: string;
  readonly render: (current: ReadonlyArray<string>) => ReadonlyArray<string>;
}

type Comment = (text: string) => string;

const markdownComment: Comment = (text) => `<!-- ${text} -->`;

const mdxComment: Comment = (text) => `{/* ${text} */}`;

const cssComment: Comment = (text) => `/* ${text} */`;

const fill = (
  file: string,
  content: string,
  comment: Comment,
  regions: ReadonlyArray<Region>,
) =>
  Effect.gen(function* () {
    let lines = content.split("\n");

    for (const region of regions) {
      const start = lines.findIndex(
        (line) => line.trim() === comment(`generated:${region.name}`),
      );

      const end = lines.findIndex(
        (line) => line.trim() === comment(`/generated:${region.name}`),
      );

      if (start === -1 || end <= start) {
        return yield* new DesignReferenceError({
          message: `${file} is missing the ${comment(`generated:${region.name}`)} and ${comment(`/generated:${region.name}`)} markers`,
        });
      }

      lines = [
        ...lines.slice(0, start + 1),
        "",
        ...region.render(lines.slice(start + 1, end)),
        "",
        ...lines.slice(end),
      ];
    }

    return lines.join("\n");
  });

const tokenRegions = (design: Design) => {
  const { root } = design;

  const named = (pattern: RegExp) =>
    [...root].filter(([name]) => pattern.test(name));

  const size = (value: string) => /^calc\((\S+) \*/.exec(value)?.[1] ?? value;

  const weights = named(/^font-weight-/);
  const lineHeights = named(/^line-height-/);

  const regions: ReadonlyArray<Region & { readonly pattern: RegExp }> = [
    {
      name: "font-families",
      pattern: /^font-family-/,
      render: () =>
        table(
          ["Token", "Value"],
          named(/^font-family-/).map(([name, value]) => [
            token(name),
            code(value),
          ]),
        ),
    },
    {
      name: "font-sizes",
      pattern: /^font-size-(?!scale$)/,
      render: () =>
        table(
          ["Token", "Size"],
          named(/^font-size-(?!scale$)/).map(([name, value]) => [
            token(name),
            size(value),
          ]),
        ),
    },
    {
      name: "font-weights",
      pattern: /^(font-weight|line-height)-/,
      render: () =>
        table(
          ["Weight", "Value", "Line height", "Value"],
          Array.from(
            { length: Math.max(weights.length, lineHeights.length) },
            (_, index) => {
              const weight = weights[index];
              const lineHeight = lineHeights[index];

              return [
                weight === undefined ? "" : token(weight[0]),
                weight?.[1] ?? "",
                lineHeight === undefined ? "" : token(lineHeight[0]),
                lineHeight?.[1] ?? "",
              ];
            },
          ),
        ),
    },
    {
      name: "spacing",
      pattern: /^space-/,
      render: () =>
        table(
          ["Token", "Size"],
          named(/^space-/).map(([name, value]) => [token(name), value]),
        ),
    },
    {
      name: "shape",
      pattern: /^border-(width|radius-)/,
      render: (current) => {
        const usedFor = handWritten(current);

        return table(
          ["Token", "Value", "Used for"],
          named(/^border-(width|radius-)/).map(([name, value]) => [
            token(name),
            value,
            usedFor.get(name) ?? "",
          ]),
        );
      },
    },
    {
      name: "motion",
      pattern: /^duration-/,
      render: () =>
        table(
          ["Token", "Value", "Reduced motion"],
          named(/^duration-/).map(([name, value]) => [
            token(name),
            value,
            design.reducedMotion.get(name) ?? value,
          ]),
        ),
    },
    {
      name: "elevation",
      pattern: /^(scrim|shadow)$/,
      render: (current) => {
        const usedFor = handWritten(current);

        return table(
          ["Token", "Value", "Used for"],
          named(/^(scrim|shadow)$/).map(([name, value]) => [
            token(name),
            code(value),
            usedFor.get(name) ?? "",
          ]),
        );
      },
    },
  ];

  return regions;
};

const colourRegions = (design: Design) => {
  const light = merge(design.root);
  const lightP3 = merge(light, design.p3);
  const dark = merge(design.root, design.dark);
  const darkP3 = merge(dark, design.p3, design.p3Dark);

  const colours = [...design.root].flatMap(([name, value]) =>
    isColour(value) ? [name] : [],
  );

  // Neutrals come before the first colour that's more vivid in wide gamut.
  const firstVivid = colours.findIndex((name) => design.p3.has(name));
  const neutrals = colours.slice(0, firstVivid);
  const vivid = colours.slice(firstVivid);

  const swatches = (names: ReadonlyArray<string>, srgb: Tokens, p3: Tokens) => {
    const chips = names.map((name) => {
      const base = resolve(srgb, srgb.get(name) ?? "");
      const wide = resolve(p3, p3.get(name) ?? "");

      const spans = (base === wide ? [base] : [base, wide])
        .map((value) => `<span style={{ background: "${value}" }} />`)
        .join("");

      return `    <div className="swatch"><div className="chip">${spans}</div><span className="name">${name}</span></div>`;
    });

    return ['  <div className="swatches">', ...chips, "  </div>"];
  };

  const palette = (theme: string, srgb: Tokens, p3: Tokens) => [
    `<div className="palette ${theme}">`,
    ...swatches(neutrals, srgb, p3),
    ...swatches(vivid, srgb, p3),
    "</div>",
  ];

  const values = (srgb: Tokens, p3: Tokens) =>
    table(
      ["Token", "sRGB", "Wide gamut"],
      colours.map((name) => {
        const base = srgb.get(name) ?? "";
        const wide = p3.get(name) ?? "";

        return [token(name), code(base), base === wide ? "" : code(wide)];
      }),
    );

  const regions: ReadonlyArray<Region> = [
    { name: "palette-light", render: () => palette("light", light, lightP3) },
    { name: "values-light", render: () => values(light, lightP3) },
    { name: "palette-dark", render: () => palette("dark", dark, darkP3) },
    { name: "values-dark", render: () => values(dark, darkP3) },
  ];

  const themes: Region = {
    name: "palette-themes",
    render: () =>
      (
        [
          ["light", light],
          ["dark", dark],
        ] as const
      ).flatMap(([theme, tokens], index) => [
        ...(index === 0 ? [] : [""]),
        `.palette.${theme} {`,
        ...neutrals.map(
          (name) =>
            `  --palette-${name}: ${resolve(tokens, tokens.get(name) ?? "")};`,
        ),
        "}",
      ]),
  };

  return { colours, regions, themes };
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const design = yield* parseDesign(yield* fs.readFileString(designFile));

  const tokens = tokenRegions(design);
  const colours = colourRegions(design);

  // A token none of the tables cover would be missing from the docs.
  const inProse = new Set(["font-size-scale"]);

  const uncovered = [...design.root.keys()].filter(
    (name) =>
      !inProse.has(name) &&
      !colours.colours.includes(name) &&
      !tokens.some((region) => region.pattern.test(name)),
  );

  if (uncovered.length > 0) {
    return yield* new DesignReferenceError({
      message: `No docs table covers ${uncovered.map((name) => `--triage-${name}`).join(", ")}. Add it to scripts/generate-design-reference.ts.`,
    });
  }

  const files: ReadonlyArray<
    readonly [string, Comment, ReadonlyArray<Region>]
  > = [
    [tokensPage, markdownComment, tokens],
    [coloursPage, mdxComment, colours.regions],
    [themeFile, cssComment, [colours.themes]],
  ];

  const stale: Array<string> = [];

  for (const [file, comment, regions] of files) {
    const current = yield* fs.readFileString(file);
    const next = yield* fill(file, current, comment, regions);

    if (next !== current) {
      stale.push(file);

      if (!check) {
        yield* fs.writeFileString(file, next);
      }
    }
  }

  if (check && stale.length > 0) {
    return yield* new DesignReferenceError({
      message: `The design docs are out of date with ${designFile}: ${stale.join(", ")}. Run \`mise run docs:gen\`.`,
    });
  }

  yield* Effect.log(
    check
      ? "The design docs are up to date"
      : `Updated ${stale.length} design docs file(s)`,
  );
});

program.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
