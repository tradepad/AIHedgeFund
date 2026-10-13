/** Read a text field from a form. File inputs and missing fields read as "". */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
