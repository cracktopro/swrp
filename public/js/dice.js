export function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollDice(notation, modifier = 0) {
  const match = notation.match(/^(\d+)d(\d+)$/i);
  if (!match) throw new Error('Formato inválido. Usa ej: 1d20, 2d6');
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return { rolls, modifier, total, notation: `${count}d${sides}` };
}

/** Texto plano (legacy / logs) */
export function formatRollResult(characterName, roll, label = '') {
  const modStr = roll.modifier >= 0 ? `+${roll.modifier}` : `${roll.modifier}`;
  const rollsStr = roll.rolls.join(' + ');
  const who = characterName || 'Jugador';
  if (roll.rolls.length > 1) {
    return `[${who}] ${label}${roll.notation}: (${rollsStr}) ${modStr} = ${roll.total}`;
  }
  const modPart = roll.modifier ? ` ${modStr}` : '';
  return `[${who}] ${label}${roll.notation}${modPart} = ${roll.total}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML coloreado para el foro de partida */
export function renderDiceResultHtml(roll, label = '') {
  const modStr = roll.modifier >= 0 ? `+${roll.modifier}` : `${roll.modifier}`;
  const labelHtml = label
    ? `<span class="swrp-dice__label">${escapeHtml(label.trim())}</span>`
    : '';

  let rollsHtml;
  if (roll.rolls.length > 1) {
    rollsHtml = roll.rolls.map((r, i) =>
      `${i ? '<span class="swrp-dice__plus">+</span>' : ''}<span class="swrp-dice__die">${r}</span>`
    ).join('');
    rollsHtml = `<span class="swrp-dice__rolls">(${rollsHtml})</span>`;
  } else {
    rollsHtml = `<span class="swrp-dice__die">${roll.rolls[0]}</span>`;
  }

  const modHtml = roll.modifier !== 0
    ? `<span class="swrp-dice__mod">${modStr}</span>`
    : '';

  return `
    <div class="swrp-dice-result">
      ${labelHtml}
      <span class="swrp-dice__notation">${escapeHtml(roll.notation)}</span>
      ${rollsHtml}
      ${modHtml}
      <span class="swrp-dice__eq">=</span>
      <span class="swrp-dice__total">${roll.total}</span>
    </div>`;
}
