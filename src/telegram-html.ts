/**
 * Escapes HTML special characters for Telegram parse_mode: "HTML".
 * Use for user/AI-generated content to prevent "Unsupported start tag" errors
 * when text contains < or > (e.g. "<5 раз", ">30%").
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
