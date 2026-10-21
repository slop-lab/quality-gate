import type { TestEvent } from "node:test/reporters";
import { inspect } from "node:util";

export default async function* report(events: AsyncIterable<TestEvent>) {
  const output = new Map<string, string>();
  let failed = false;
  for await (const { type, data } of events) {
    if (type === "test:stdout") {
      // Retain bounded context for failing files, without displaying passing logs.
      output.set(
        data.file,
        ((output.get(data.file) ?? "") + data.message).slice(-65536),
      );
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
        const context = output.get(data.file);
        if (context) yield context.endsWith("\n") ? context : `${context}\n`;
        output.delete(data.file);
      }
      yield `${inspect(error.cause ?? error, { depth: 5, colors: false })}\n`;
    } else if (type === "test:summary") {
      if (data.file) output.delete(data.file);
      else if (data.success) yield "PASS\n";
      else if (!failed) yield "FAIL test run\n";
    }
  }
}
