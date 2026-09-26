#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const [ input, output ] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/render-markdown-report.cjs input.md output.html');

const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = value => escape(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const lines = fs.readFileSync(path.resolve(input), 'utf8').replace(/\r\n/g, '\n').split('\n');
let html = '';
let i = 0;

while (i < lines.length) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  if (line.startsWith('```')) {
    const block = [];
    i++;
    while (i < lines.length && !lines[i].startsWith('```')) block.push(lines[i++]);
    html += `<pre>${escape(block.join('\n'))}</pre>`;
    i++;
  } else if (/^#{1,3} /.test(line)) {
    const level = line.match(/^#+/)[0].length;
    html += `<h${level}>${inline(line.slice(level + 1))}</h${level}>`;
    i++;
  } else if (line === '---') {
    html += '<hr>';
    i++;
  } else if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) {
      if (!/^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[i])) rows.push(lines[i]);
      i++;
    }
    const cells = row => row.split('|').slice(1, -1).map(cell => `<td>${inline(cell.trim())}</td>`).join('');
    html += `<table><thead><tr>${rows[0].split('|').slice(1, -1).map(cell => `<th>${inline(cell.trim())}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${cells(row)}</tr>`).join('')}</tbody></table>`;
  } else if (/^\d+\. /.test(line)) {
    const items = [];
    while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\d+\. /, ''))}</li>`);
    html += `<ol>${items.join('')}</ol>`;
  } else if (line.startsWith('- ')) {
    const items = [];
    while (i < lines.length && lines[i].startsWith('- ')) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
    html += `<ul>${items.join('')}</ul>`;
  } else {
    html += `<p>${inline(line)}</p>`;
    i++;
  }
}

fs.writeFileSync(path.resolve(output), `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 17mm 14mm; } body { font-family: Arial, sans-serif; color:#172033; font-size:10.3pt; line-height:1.48; } h1 { color:#2639a8; font-size:22pt; margin:0 0 12pt; } h2 { color:#2639a8; font-size:15pt; margin:24pt 0 8pt; border-bottom:1px solid #dbe1ee; padding-bottom:4pt; } h3 { color:#1f356c; font-size:12pt; margin:17pt 0 5pt; } p { margin:5pt 0; } table { width:100%; border-collapse:collapse; margin:8pt 0 13pt; font-size:8.5pt; } th { background:#2639a8; color:#fff; font-weight:700; } th, td { border:1px solid #cfd7e6; padding:5pt; text-align:left; vertical-align:top; } tr:nth-child(even) { background:#f7f9fd; } code { background:#edf1f8; padding:1pt 3pt; border-radius:3pt; font-family:Consolas,monospace; font-size:8.5pt; } pre { white-space:pre-wrap; background:#101827; color:#e6edf7; padding:9pt; border-radius:4pt; font-size:8.5pt; } ul, ol { margin:4pt 0 8pt 18pt; padding-left:12pt; } li { margin:2pt 0; } hr { border:0; border-top:1px solid #dbe1ee; margin:15pt 0; }
</style></head><body>${html}</body></html>`);
