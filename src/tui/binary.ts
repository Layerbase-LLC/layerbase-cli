// SpinDB start fails closed when the pinned engine build is not on disk.
// PostgreSQL asks to download first. Other engines throw, and the useful
// sentence is one of these.
export function missingEngineBinary(text: string): boolean {
  const value = text.toLowerCase()
  if (value.includes('binary not found')) return true
  if (value.includes('binaries not found')) return true
  if (value.includes('re-download')) return true
  if (value.includes('engines download')) return true
  return false
}
