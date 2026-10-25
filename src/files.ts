const SOURCE_TYPES = [
  {
    description: "Z80 assembly",
    accept: { "text/plain": [".asm", ".z80", ".s", ".txt"] },
  },
];

interface OpenPickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: typeof SOURCE_TYPES;
}

interface SavePickerOptions {
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
  types?: typeof SOURCE_TYPES;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenPickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: SavePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

export function canOpenWithPicker(target: Window = window): boolean {
  return typeof target.showOpenFilePicker === "function";
}

export function canSaveWithPicker(target: Window = window): boolean {
  return typeof target.showSaveFilePicker === "function";
}

export async function openWithPicker(): Promise<FileSystemFileHandle> {
  const picker = window.showOpenFilePicker;
  if (picker === undefined) {
    throw new Error("This browser has no file picker.");
  }
  const handles = await picker({
    multiple: false,
    excludeAcceptAllOption: false,
    types: SOURCE_TYPES,
  });
  const handle = handles[0];
  if (handle === undefined) {
    throw abort();
  }
  return handle;
}

export async function readHandle(handle: FileSystemFileHandle): Promise<{ name: string; text: string }> {
  const file = await handle.getFile();
  return { name: file.name, text: await file.text() };
}

export async function writeHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const permission = handle as FileSystemFileHandle & {
    requestPermission?: (descriptor: { mode: "read" | "readwrite" }) => Promise<PermissionState | "prompt">;
  };
  if (permission.requestPermission !== undefined) {
    const result = await permission.requestPermission({ mode: "readwrite" });
    if (result === "denied") {
      throw new DOMException("Permission to write the file was denied.", "NotAllowedError");
    }
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function saveWithPicker(suggestedName: string): Promise<FileSystemFileHandle> {
  const picker = window.showSaveFilePicker;
  if (picker === undefined) {
    throw new Error("This browser has no save picker.");
  }
  return picker({
    suggestedName,
    excludeAcceptAllOption: false,
    types: SOURCE_TYPES,
  });
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function isAbortError(error: unknown): boolean {
  return namedError(error, "AbortError");
}

export function isSecurityError(error: unknown): boolean {
  return namedError(error, "SecurityError");
}

export function fileFailure(error: unknown): string {
  const detail = error instanceof Error && error.message !== "" ? ` ${error.message}` : "";
  return `Could not use that file.${detail}`;
}

function abort(): DOMException {
  return new DOMException("The user aborted a request.", "AbortError");
}

function namedError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}
