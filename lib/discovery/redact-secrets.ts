/** Strip an API key query value before it is logged or stored on an errors list. */
export function redactSecretParams(text: string): string {
  return text.replace(/(^|[?&\s])key=[^&\s]*/gi, "$1key=[redacted]");
}
