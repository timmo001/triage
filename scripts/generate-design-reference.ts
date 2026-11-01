// Fills the generated regions of the docs design pages from the tokens in
// web/src/design.css, with the colours resolved through the Triage theme in
// web/src/theme/themes.generated.css, so the docs always show the values the
// web UI uses. With --check it writes nothing and fails if any region is out
// of date.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema } from "effect";

const designFile = "web/src/design.css";

const themeCssFile = "web/src/theme/themes.generated.css";

const tokensPage = "docs/src/content/docs/design/index.md";

const coloursPage = "docs/src/content/docs/design/colours.mdx";

const themeFile = "docs/theme.css";

const check = process.argv.includes("--check");

class DesignReferenceError extends Schema.TaggedError<DesignReferenceError>()(
  "DesignReferenceError",
  { message: Schema.String },
) {}

type Tokens = ReadonlyMap<string, string>;

const reducedMotion = "(prefers-reduced-motion: reduce)";

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

    const motion = yield* Effect.fromNullishOr(blocks.get(reducedMotion)).pipe(
      Effect.mapError(
        () =>
          new DesignReferenceError({
            message: `No @media ${reducedMotion} :root block in ${designFile}`,
          }),
      ),
    );

    return { root: declarations(root), reducedMotion: motion };
  });

type Design = Effect.Success<ReturnType<typeof parseDesign>>;

// The Triage theme's roles and tones in one mode, by their full property name.
type Theme = ReadonlyMap<string, string>;

const parseTheme = (css: string) =>
  Effect.gen(function* () {
    const mode = (selector: string): Theme =>
      new Map(
        [...css.matchAll(/^(.+?) \{([\s\S]*?)^\}/gm)]
          .filter(([, found]) => found === selector)
          .flatMap(([, , block = ""]) => [
            ...block.matchAll(/(--(?:gw|app)-[\w-]+):\s*([^;]+);/g),
          ])
          .map(([, name = "", value = ""]) => [name, normalise(value)]),
      );

    const light = mode('[data-gw-theme="triage"]');
    const dark = mode('[data-gw-theme="triage"][data-gw-mode="dark"]');

    if (light.size === 0 || dark.size === 0) {
      return yield* new DesignReferenceError({
        message: `No Triage theme in ${themeCssFile}. Run \`mise run theme:gen\`.`,
      });
    }

    return { light, dark };
  });

const resolve = (tokens: Tokens, theme: Theme, value: string): string =>
  value
    .replace(/var\(--triage-([\w-]+)\)/g, (match, name: string) => {
      const referenced = tokens.get(name);

      return referenced === undefined
        ? match
        : resolve(tokens, theme, referenced);
    })
    .replace(
      /var\((--(?:gw|app)-[\w-]+)\)/g,
      (match, name: string) => theme.get(name) ?? match,
    );

// What a colour token points at in the theme: a role or a state's tone.
const source = (value: string) =>
  /^var\(--((?:gw-color|app-tone)-[\w-]+)\)$/.exec(value)?.[1];

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

const colourRegions = (
  design: Design,
  theme: { readonly light: Theme; readonly dark: Theme },
) => {
  const colours = [...design.root].flatMap(([name, value]) =>
    source(value) === undefined ? [] : [name],
  );

  // Neutrals and the accent come from the theme's roles, the states from
  // their tones.
  const neutrals = colours.filter((name) =>
    source(design.root.get(name) ?? "")?.startsWith("gw-"),
  );

  const states = colours.filter((name) => !neutrals.includes(name));

  const value = (mode: Theme, name: string) =>
    resolve(design.root, mode, design.root.get(name) ?? "");

  const swatches = (names: ReadonlyArray<string>, mode: Theme) => [
    '  <div className="swatches">',
    ...names.map(
      (name) =>
        `    <div className="swatch"><div className="chip"><span style={{ background: "${value(mode, name)}" }} /></div><span className="name">${name}</span></div>`,
    ),
    "  </div>",
  ];

  const palette = (name: string, mode: Theme) => [
    `<div className="palette ${name}">`,
    ...swatches(neutrals, mode),
    ...swatches(states, mode),
    "</div>",
  ];

  const values = (mode: Theme) =>
    table(
      ["Token", "From", "Value"],
      colours.map((name) => [
        token(name),
        code(`--${source(design.root.get(name) ?? "") ?? ""}`),
        code(value(mode, name)),
      ]),
    );

  const regions: ReadonlyArray<Region> = [
    { name: "palette-light", render: () => palette("light", theme.light) },
    { name: "values-light", render: () => values(theme.light) },
    { name: "palette-dark", render: () => palette("dark", theme.dark) },
    { name: "values-dark", render: () => values(theme.dark) },
  ];

  const themes: Region = {
    name: "palette-themes",
    render: () =>
      (
        [
          ["light", theme.light],
          ["dark", theme.dark],
        ] as const
      ).flatMap(([name, mode], index) => [
        ...(index === 0 ? [] : [""]),
        `.palette.${name} {`,
        ...neutrals.flatMap((neutral) =>
          neutral === "accent"
            ? []
            : [`  --palette-${neutral}: ${value(mode, neutral)};`],
        ),
        "}",
      ]),
  };

  return { colours, regions, themes };
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const design = yield* parseDesign(yield* fs.readFileString(designFile));
  const theme = yield* parseTheme(yield* fs.readFileString(themeCssFile));

  const tokens = tokenRegions(design);
  const colours = colourRegions(design, theme);

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
