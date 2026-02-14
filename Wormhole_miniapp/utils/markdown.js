function escapeHtml(input) {
  const text = String(input || '');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text) {
  let html = escapeHtml(text || '');
  html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let inUl = false;
  let inOl = false;

  function closeLists() {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  }

  lines.forEach((line) => {
    const raw = line || '';
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) {
      closeLists();
      if (!inCode) {
        out.push('<pre><code>');
        inCode = true;
      } else {
        out.push('</code></pre>');
        inCode = false;
      }
      return;
    }
    if (inCode) {
      out.push(`${escapeHtml(raw)}\n`);
      return;
    }
    if (!trimmed) {
      closeLists();
      out.push('<p><br/></p>');
      return;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      return;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      closeLists();
      out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      return;
    }

    const ul = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      if (!inUl) {
        if (inOl) {
          out.push('</ol>');
          inOl = false;
        }
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      return;
    }

    const ol = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (!inOl) {
        if (inUl) {
          out.push('</ul>');
          inUl = false;
        }
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      return;
    }

    closeLists();
    out.push(`<p>${renderInline(trimmed)}</p>`);
  });

  closeLists();
  if (inCode) {
    out.push('</code></pre>');
  }
  return out.join('');
}

function markdownToPlainText(markdown) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/\*\*([^*]+?)\*\*/g, '$1')
    .replace(/\*([^*]+?)\*/g, '$1')
    .replace(/~~([^~]+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
  return text;
}

module.exports = {
  renderMarkdown,
  markdownToPlainText
};
