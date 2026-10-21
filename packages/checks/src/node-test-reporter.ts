import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { TestEvent } from "node:test/reporters";
import { inspect } from "node:util";

export default async function* report(events: AsyncIterable<TestEvent>) {
  const output = new Map<string, string>();
  const paths = new Map<string, string>();
  const fileKey = (file: string) => {
    let key = paths.get(file);
    if (key === undefined) {
      try {
        key = realpathSync(file);
      } catch {
        // Tests may delete their own source files before emitting an event.
        key = resolve(file);
      }
      paths.set(file, key);
    }
    return key;
  };
  let failed = false;
  for await (const { type, data } of events) {
    if (type === "test:stdout") {
      // Node can report stdout through a symlink and failures through its target.
      const file = fileKey(data.file);
      // Retain bounded context for failing files, without displaying passing logs.
      output.set(file, ((output.get(file) ?? "") + data.message).slice(-65536));
    } else if (type === "test:stderr") {
      process.stderr.write(data.message);
    } else if (
      type === "test:fail" &&
      (data.todo === undefined || data.todo === false) &&
      (data.skip === undefined || data.skip === false)
    ) {
      failed = true;
      const error = data.details.error;
      if ("failureType" in error && error.failureType === "subtestsFailed")
        continue;
      yield `FAIL ${data.name}\n`;
      if (data.file) {
        yield `${[data.file, data.line, data.column].filter((value) => value !== undefined).join(":")}\n`;
        const file = fileKey(data.file);
        const context = output.get(file);
        if (context) yield context.endsWith("\n") ? context : `${context}\n`;
        output.delete(file);
      }
      yield `${inspect(error.cause ?? error, { depth: 5, colors: false })}\n`;
    } else if (type === "test:summary") {
      if (data.file) output.delete(fileKey(data.file));
      else if (data.success) yield "PASS\n";
      else if (!failed) yield "FAIL test run\n";
    }
  }
}
