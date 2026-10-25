import consoleEcho from "../examples/console-echo.asm";
import consoleExample from "../examples/console.asm";
import exchange from "../examples/exchange.asm";
import flags from "../examples/flags.asm";
import memory from "../examples/memory.asm";
import sample from "../examples/sample.asm";
import table from "../examples/table.asm";

export interface ExampleProgram {
  id: string;
  label: string;
  filename: string;
  source: string;
}

export const EXAMPLES: readonly ExampleProgram[] = [
  { id: "sample", label: "Sample", filename: "sample.asm", source: sample },
  { id: "console", label: "Console example", filename: "console.asm", source: consoleExample },
  { id: "console-echo", label: "Console echo", filename: "console-echo.asm", source: consoleEcho },
  { id: "flags", label: "Flags", filename: "flags.asm", source: flags },
  { id: "memory", label: "Memory", filename: "memory.asm", source: memory },
  { id: "exchange", label: "Exchange", filename: "exchange.asm", source: exchange },
  { id: "table", label: "Table", filename: "table.asm", source: table },
];

export function exampleById(id: string): ExampleProgram | undefined {
  return EXAMPLES.find((example) => example.id === id);
}

export const SAMPLE_SOURCE = exampleById("sample")?.source ?? "";
export const CONSOLE_SOURCE = exampleById("console")?.source ?? "";
