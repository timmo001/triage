// Connects the header's gw-theme-picker to the page's theme: the Triage theme,
// Snag, or one the visitor imports, in auto, light, dark or Darker.
import type { GwThemePicker } from "@timmo001/groundwork-ui/gw-theme-picker.ts";
import { on } from "@timmo001/groundwork-ui/on.ts";
import { pageTheme, type ThemeMode } from "@timmo001/groundwork-tokens/page";
import { themeChoices, themeOptions } from "./options.js";
import { stateTones } from "./tones.js";

const page = pageTheme({
  ...themeOptions,
  themes: themeChoices,
  tones: stateTones,
});

const modes: ReadonlyArray<ThemeMode> = ["auto", "light", "dark", "darker"];

const choices = (custom: string | null) => [
  ...themeChoices.map(({ id, name }) => ({ value: id, label: name })),
  ...(custom === null ? [] : [{ value: "custom", label: custom }]),
];

/** Keeps `picker` in step with the page's theme and applies what it picks. */
export const bindThemePicker = (picker: GwThemePicker) => {
  const sync = () => {
    const state = page.state();
    picker.mode = state.mode;
    picker.theme = state.theme;
    picker.themes = choices(state.custom);
  };

  sync();

  const stops = [
    page.subscribe(sync),
    on(picker, "mode", (event) => {
      const mode = modes.find((known) => known === event.detail.mode);

      if (mode !== undefined) {
        page.setMode(mode);
      }
    }),
    on(picker, "theme", (event) => page.setTheme(event.detail.id)),
    on(picker, "import", (event) => {
      void page.importTheme(event.detail.text).then((result) => {
        picker.status = result.ok
          ? result.misses.length === 0
            ? `Using ${result.name}`
            : `Using ${result.name}. Some colors miss their contrast target: ${result.misses.join(", ")}`
          : result.error;
      });
    }),
    on(picker, "reset", () => {
      page.reset();
      picker.status = "";
    }),
  ];

  return () => {
    for (const stop of stops) stop();
  };
};
