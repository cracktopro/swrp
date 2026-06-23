function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatInline(text) {
  let html = escapeHtml(text);

  html = html.replace(
    /(Tirada\d?\s*1d\d+[^<]*)/gi,
    '<span class="swrp-rules__dice-roll">$1</span>'
  );
  html = html.replace(
    /(\d+d\d+)/gi,
    '<span class="swrp-rules__die">$1</span>'
  );
  html = html.replace(
    /(\+\d+)/g,
    '<span class="swrp-rules__mod">$1</span>'
  );
  html = html.replace(
    /(=\s*\d+)/g,
    '<span class="swrp-rules__result">$1</span>'
  );
  html = html.replace(
    /(\b\d+\s+de\s+daño\b)/gi,
    '<span class="swrp-rules__damage">$1</span>'
  );
  html = html.replace(
    /(Defensa(?:\s+del?|\s+de)?[^.<]*\d+)/gi,
    '<span class="swrp-rules__defense">$1</span>'
  );
  html = html.replace(
    /&quot;([^&]+)&quot;/g,
    '<q class="swrp-rules__quote">$1</q>'
  );
  html = html.replace(
    /"([^"]+)"/g,
    '<q class="swrp-rules__quote">$1</q>'
  );
  html = html.replace(
    /^-\s*([^:]+):\s*/,
    '<strong class="swrp-rules__speaker">$1:</strong> '
  );

  return html;
}

function isInitiativeLine(line) {
  return /^[\w´'`\-]+\s+\d{1,2}$/.test(line.trim())
    && !line.includes('=')
    && !line.toLowerCase().includes('tirada');
}

function isSectionHeading(line) {
  const t = line.trim();
  if (/^---.+---$/.test(t)) return false;
  if (t.length < 8) return false;
  if (/[a-záéíóúñ]/.test(t) && !/^[A-ZÁÉÍÓÚÑ\s:?¿]+$/.test(t)) return false;
  return /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s:?¿]+$/.test(t);
}

/**
 * Convierte el texto plano de RULES.md en HTML semántico con clases de estilo.
 * @param {string} raw
 * @returns {string}
 */
export function renderRulesHtml(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let inExample = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inExample) blocks.push('<div class="swrp-rules__spacer" aria-hidden="true"></div>');
      continue;
    }

    const faq = trimmed.match(/^---(.+)---$/);
    if (faq) {
      blocks.push(`<h2 class="swrp-rules__faq">${escapeHtml(faq[1])}</h2>`);
      continue;
    }

    if (trimmed.startsWith('EJEMPLO de partida')) {
      if (inExample) blocks.push('</div>');
      inExample = true;
      blocks.push(`<h2 class="swrp-rules__heading">${escapeHtml(trimmed)}</h2>`);
      blocks.push('<div class="swrp-rules__example">');
      continue;
    }

    if (isSectionHeading(trimmed)) {
      if (inExample) {
        blocks.push('</div>');
        inExample = false;
      }
      blocks.push(`<h2 class="swrp-rules__heading">${escapeHtml(trimmed)}</h2>`);
      continue;
    }

    const numbered = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numbered) {
      blocks.push(
        `<p class="swrp-rules__rule"><span class="swrp-rules__rule-num">${numbered[1]}.</span> ${formatInline(numbered[2])}</p>`
      );
      continue;
    }

    const lettered = trimmed.match(/^([a-z])\)\s+(.+)/i);
    if (lettered) {
      blocks.push(
        `<p class="swrp-rules__subrule"><span class="swrp-rules__rule-letter">${lettered[1]})</span> ${formatInline(lettered[2])}</p>`
      );
      continue;
    }

    if (inExample && isInitiativeLine(trimmed)) {
      blocks.push(`<p class="swrp-rules__initiative">${formatInline(trimmed)}</p>`);
      continue;
    }

    if (trimmed.startsWith('-') && trimmed.includes(':')) {
      blocks.push(`<p class="swrp-rules__dialogue">${formatInline(trimmed)}</p>`);
      continue;
    }

    if (/tirada/i.test(trimmed) || /1d\d+/i.test(trimmed)) {
      blocks.push(`<p class="swrp-rules__roll">${formatInline(trimmed)}</p>`);
      continue;
    }

    blocks.push(`<p class="swrp-rules__para">${formatInline(trimmed)}</p>`);
  }

  if (inExample) blocks.push('</div>');

  return `
    <header class="swrp-rules__header">
      <h1 class="swrp-rules__title">Reglas de juego</h1>
      <p class="swrp-rules__lead">Normas básicas para rolear y combatir en Star Wars Expanded RP.</p>
    </header>
    <div class="swrp-rules__body">
      ${blocks.join('\n')}
    </div>`;
}
