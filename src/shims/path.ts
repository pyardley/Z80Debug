export function dirname(file: string): string {
  const index = file.lastIndexOf("/");
  return index >= 0 ? file.slice(0, index) : "";
}

export function resolve(...parts: string[]): string {
  return parts.join("/");
}

export function parse(file: string): { dir: string; base: string; name: string; ext: string } {
  const base = file.split("/").pop() ?? file;
  const dot = base.lastIndexOf(".");
  return {
    dir: dirname(file),
    base,
    name: dot > 0 ? base.slice(0, dot) : base,
    ext: dot > 0 ? base.slice(dot) : "",
  };
}
