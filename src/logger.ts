import { Cause, Inspectable, Logger, References } from "effect";

const pad = (value: number, length = 2) =>
  value.toString().padStart(length, "0");

const time = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;

const quoted = (text: string) =>
  /[\s"=]/.test(text) ? JSON.stringify(text) : text;

/**
 * Formats a log like Effect's default logger, but with annotations such as an
 * HTTP request's method, URL and status on the same line as `key=value`
 * pairs instead of a multi-line object, so each entry is one line.
 */
export const formatLine = Logger.make<unknown, string>(
  ({ cause, date, fiber, logLevel, message }) => {
    const now = date.getTime();

    const spans = fiber
      .getRef(References.CurrentLogSpans)
      .map(([label, start]) => ` ${label}=${now - start}ms`)
      .join("");

    const line = [
      `[${time(date)}] ${logLevel.toUpperCase()} (#${fiber.id})${spans}:`,
      ...(Array.isArray(message) ? message : [message]).map((part) =>
        Inspectable.toStringUnknown(part, 0),
      ),
      ...Object.entries(fiber.getRef(References.CurrentLogAnnotations)).map(
        ([key, annotation]) =>
          `${key}=${quoted(Inspectable.toStringUnknown(annotation, 0))}`,
      ),
    ].join(" ");

    return cause.reasons.length > 0 ? `${line}\n${Cause.pretty(cause)}` : line;
  },
);
