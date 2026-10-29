import assert from "node:assert/strict";
import test from "node:test";

import {
  hasDetailChanges,
  normalizeDetailHtml,
  resolveDetailPreviewHtml,
  sanitizeDetailHtml,
} from "../app/lib/detail-editor.ts";

test("preserves ordinary detail markup and removes executable markup", () => {
  // Catches: imported HTML executing scripts or browser event handlers in the editor/marketplace.
  const input = '<section onclick="bad()"><h2>복숭아</h2><a href="javascript:bad()">링크</a><img src="https://img.example/a.jpg" onerror="bad()"><script>bad()</script><iframe src="https://bad.example"></iframe></section>';
  const output = sanitizeDetailHtml(input);

  assert.match(output, /<h2>복숭아<\/h2>/);
  assert.match(output, /https:\/\/img\.example\/a\.jpg/);
  assert.doesNotMatch(output, /onclick|onerror|javascript:|<script|<iframe/i);
});

test("removes unquoted handlers and executable URL schemes", () => {
  // Catches: sanitizer handling only double-quoted attributes.
  const output = sanitizeDetailHtml("<img src=vbscript:bad onload=bad()><object data='bad'></object><embed src='bad'>");

  assert.doesNotMatch(output, /vbscript:|onload|<object|<embed/i);
});

test("normalizes visually empty editor markup", () => {
  // Catches: the editor saving browser-generated empty wrappers as real detail content.
  assert.equal(normalizeDetailHtml(" <div><br></div> "), "");
  assert.equal(normalizeDetailHtml("<p><br></p>"), "");
});

test("compares semantically equal editor HTML", () => {
  // Catches: a whitespace-only browser change triggering false unsaved-change warnings.
  assert.equal(hasDetailChanges("<p>내용</p>", "  <p>내용</p>  "), false);
  assert.equal(hasDetailChanges("<p>내용</p>", "<p>수정</p>"), true);
});

test("uses the visual editor draft for the detail-page preview", () => {
  // Catches: the right preview ignoring the imported/edited HTML and rendering an unrelated generated template.
  assert.equal(resolveDetailPreviewHtml("<p>저장된 원본</p>", "<p>왼쪽 수정본</p>"), "<p>왼쪽 수정본</p>");
});
