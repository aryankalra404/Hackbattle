/**
 * Minimal syntax highlighter for the Arduino sketch editor — no dependency,
 * just a single-pass tokenizer producing HTML spans, rendered behind the
 * (invisible-text) textarea in QuestCodeEditor. Not a real language parser:
 * good enough to color comments/strings/keywords/types/constants/calls for
 * a sketch this size, not a general C++ highlighter.
 */

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => HTML_ESCAPES[char] ?? char);
}

// Alternation order matters: earlier groups win when they overlap (e.g. a
// keyword like "if" must not also match the generic function-call group).
const TOKEN_RE =
  /(\/\*[\s\S]*?\*\/)|(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(^[ \t]*#\w+[^\n]*)|\b(void|int|float|double|char|bool|boolean|byte|long|short|unsigned|signed|String|const|static|struct|class|enum|typedef|public|private|protected|new|delete|sizeof)\b|\b(if|else|for|while|do|return|break|continue|switch|case|default|true|false|null|NULL)\b|\b(HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN|A[0-5])\b|\b([a-zA-Z_]\w*)(?=\s*\()|\b(0x[0-9a-fA-F]+|\d+\.?\d*)\b/gm;

const GROUP_CLASS = [
  'tok-comment',
  'tok-comment',
  'tok-string',
  'tok-preprocessor',
  'tok-type',
  'tok-keyword',
  'tok-constant',
  'tok-function',
  'tok-number',
];

export function highlightSketch(code: string): string {
  let html = '';
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(code))) {
    if (match.index > lastIndex) html += escapeHtml(code.slice(lastIndex, match.index));
    const groupIndex = match.slice(1).findIndex((group) => group !== undefined);
    const cls = GROUP_CLASS[groupIndex];
    html += cls ? `<span class="${cls}">${escapeHtml(match[0])}</span>` : escapeHtml(match[0]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < code.length) html += escapeHtml(code.slice(lastIndex));
  return html;
}
