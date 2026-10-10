import { describe, expect, test } from "bun:test";
import { namesRedactor, parseRegistries } from "./coreNames.js";

const registries = {
  devices: JSON.stringify({
    data: {
      devices: [
        { name: "Desk lamp", name_by_user: "Reading light", entry_type: null },
        { name: "Sun", name_by_user: null, entry_type: "service" },
      ],
    },
  }),
  entities: JSON.stringify({
    data: {
      entities: [
        { entity_id: "light.reading_light", name: null },
        { entity_id: "sensor.example_power", name: "Bench power" },
      ],
    },
  }),
  areas: JSON.stringify({
    data: { areas: [{ name: "Study" }, { name: "Hue" }] },
  }),
  floors: JSON.stringify({ data: { floors: [{ name: "Upstairs" }] } }),
  people: JSON.stringify({ data: { items: [{ name: "Alex Example" }] } }),
  config: JSON.stringify({ data: { location_name: "Example House" } }),
};

describe("parseRegistries", () => {
  test("reads names, leaving out services' and entities' own", () => {
    const core = parseRegistries(registries);

    expect(core.entityIds).toEqual([
      "light.reading_light",
      "sensor.example_power",
    ]);
    expect(core.names).toEqual([
      ["Reading light", "<device>"],
      ["Desk lamp", "<device>"],
      ["Bench power", "<entity>"],
      ["Study", "<area>"],
      ["Hue", "<area>"],
      ["Upstairs", "<floor>"],
      ["Alex Example", "<user>"],
      ["Example House", "<home>"],
    ]);
  });

  test("skips registries it can't read", () => {
    expect(parseRegistries({ devices: "not json", areas: "{}" })).toEqual({
      entityIds: [],
      names: [],
    });
  });
});

describe("namesRedactor", () => {
  const redactNames = namesRedactor(parseRegistries(registries));

  test("replaces entity IDs' object IDs and names", () => {
    expect(
      redactNames(
        "Error setting up light.reading_light (Reading light) in Study for Alex Example",
      ),
    ).toBe("Error setting up light.<entity> (<device>) in <area> for <user>");
  });

  test("leaves code, loggers and paths alone", () => {
    const traceback =
      'File "/usr/src/homeassistant/homeassistant/components/hue/light.py", line 10, in hue.light.reading_light_update';

    expect(redactNames(traceback)).toBe(traceback);
  });

  test("doesn't replace part of a longer word or ID", () => {
    expect(redactNames("Studying light.reading_light_2")).toBe(
      "Studying light.reading_light_2",
    );
  });

  test("changes nothing without registries", () => {
    expect(namesRedactor({ entityIds: [], names: [] })("Study")).toBe("Study");
  });
});
