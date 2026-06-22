import { rollDice, renderDiceResultHtml } from './dice.js';
import { findSkillById, getSkillsForClass, skillTypeBadgeClass } from './compendium-store.js';
import { getClassMeta } from './character-card.js';
import { swrpAlert } from './swrp-dialog.js';
import {
  logEntryDice,
  logEntrySkill,
  logEntryAction,
  cellLabel
} from './board.js';
import {
  insertMention,
  renderBoardMentionPickerItem
} from './party-markup.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildTurnOptions(members, tokens) {
  const options = [{
    kind: 'enemy',
    label: 'Enemigos (GM)',
    userId: null,
    sourceId: null,
    tokenId: null
  }];

  members
    .filter((m) => m.playMode === 'character' && m.characterSnapshot && m.characterId)
    .forEach((m) => {
      const onBoard = tokens.find(
        (t) => t.kind === 'character' && t.sourceId === m.characterId
      );
      if (onBoard) {
        options.push({
          kind: 'player',
          label: m.characterSnapshot.name,
          userId: m.userId,
          sourceId: m.characterId,
          tokenId: onBoard.id
        });
      }
    });

  return options;
}

function turnKey(turn) {
  if (!turn) return '';
  return `${turn.kind}:${turn.userId || ''}:${turn.sourceId || ''}:${turn.tokenId || ''}`;
}

function syncTurnUi(activeTurn, turnOptions, turnBannerEl, turnListEl, isGM) {
  if (turnBannerEl) {
    if (!activeTurn) {
      turnBannerEl.textContent = 'Sin turno asignado';
      turnBannerEl.className = 'board-turn-banner board-turn-banner--idle small mb-2';
    } else if (activeTurn.kind === 'enemy') {
      turnBannerEl.textContent = 'Turno activo: Enemigos';
      turnBannerEl.className = 'board-turn-banner board-turn-banner--enemy small mb-2';
    } else {
      turnBannerEl.textContent = `Turno activo: ${activeTurn.label}`;
      turnBannerEl.className = 'board-turn-banner board-turn-banner--player small mb-2';
    }
  }

  if (!turnListEl || !isGM) return;

  turnListEl.innerHTML = turnOptions.map((opt) => {
    const active = turnKey(activeTurn) === turnKey(opt);
    return `
      <button type="button"
        class="board-turn-btn${active ? ' is-active' : ''}"
        data-turn-kind="${opt.kind}"
        data-turn-user="${opt.userId || ''}"
        data-turn-source="${opt.sourceId || ''}"
        data-turn-token="${opt.tokenId || ''}"
        data-turn-label="${escapeHtml(opt.label)}">
        ${escapeHtml(opt.label)}
      </button>`;
  }).join('');
}

function actorFromToken(token) {
  if (!token) return null;
  const base = token.characterSnapshot
    ? { ...token.characterSnapshot, id: token.sourceId, class: token.class || token.characterSnapshot.class }
    : {
        name: token.name,
        class: token.class,
        level: token.level,
        attack: token.attack,
        skills: token.skills || [],
        id: token.sourceId
      };
  const meta = getClassMeta(base.class);
  return {
    actor: { ...base, color: token.color || meta.color },
    cell: cellLabel(token.col, token.row)
  };
}

function resolveActiveActor(ctx, activeSelect) {
  const { board, isGM, member, roster, userCharacterSourceId } = ctx;
  if (isGM) {
    if (!activeSelect?.value) return null;
    const token = board.tokens.find((t) => t.id === activeSelect.value);
    if (token) return actorFromToken(token);
    const char = roster.find((c) => c.id === activeSelect.value);
    if (char) {
      const meta = getClassMeta(char.class);
      return { actor: { ...char, color: meta.color }, cell: null };
    }
    return null;
  }
  const token = board.tokens.find(
    (t) => t.kind === 'character' && t.sourceId === userCharacterSourceId
  );
  if (token) return actorFromToken(token);
  if (member?.characterSnapshot) {
    const meta = getClassMeta(member.characterSnapshot.class);
    return {
      actor: { ...member.characterSnapshot, color: meta.color },
      cell: null
    };
  }
  return null;
}

function canUseCombatActions(board, isGM, userId) {
  if (!board.combatStarted) return false;
  if (isGM) return true;
  const turn = board.activeTurn;
  return turn?.kind === 'player' && turn.userId === userId;
}

function skillTypeKey(type) {
  return String(type || '').toLowerCase();
}

function isSkillRol(skill) {
  return skillTypeKey(skill?.type) === 'rol';
}

function isSkillPasiva(skill) {
  return skillTypeKey(skill?.type) === 'pasiva';
}

function skillUnlockOrder(skill) {
  const level = skill?.unlockLevel;
  if (level === 'always' || level === 'siempre') return 0;
  return Number(level) || 99;
}

function collectBoardSkills(character) {
  if (!character?.class) return [];
  const classKey = character.class;
  const level = Number(character.level) || 1;
  const byId = new Map();

  (character.skills || []).forEach((skillId) => {
    const skill = findSkillById(classKey, skillId);
    if (skill && !isSkillRol(skill)) byId.set(skill.id, skill);
  });

  getSkillsForClass(classKey, level).forEach((skill) => {
    if (isSkillPasiva(skill)) byId.set(skill.id, skill);
  });

  return Array.from(byId.values()).sort((a, b) => {
    const pasivaDiff = Number(isSkillPasiva(b)) - Number(isSkillPasiva(a));
    if (pasivaDiff !== 0) return pasivaDiff;
    return skillUnlockOrder(a) - skillUnlockOrder(b);
  });
}

function renderSkillsList(container, character, onUse) {
  if (!container) return;

  const meta = character?.class ? getClassMeta(character.class) : null;
  container.className = meta
    ? `board-skills-list mb-3 theme-${meta.theme || 'soldado'}`
    : 'board-skills-list mb-3';

  if (!character) {
    container.innerHTML = '<p class="small text-muted mb-0">Sin habilidades disponibles.</p>';
    return;
  }

  const items = collectBoardSkills(character);

  if (!items.length) {
    container.innerHTML = '<p class="small text-muted mb-0">Sin habilidades disponibles.</p>';
    return;
  }

  container.innerHTML = items.map((skill) => `
    <button type="button" class="board-skill-btn" data-skill-id="${escapeHtml(skill.id)}">
      <span class="board-skill-btn__head">
        <strong class="board-skill-btn__name">${escapeHtml(skill.name)}</strong>
        <span class="swrp-skill-badge ${skillTypeBadgeClass(skill.type)}">${escapeHtml(skill.type)}</span>
      </span>
      ${skill.description ? `<span class="board-skill-btn__desc">${escapeHtml(skill.description)}</span>` : ''}
    </button>`).join('');

  container.querySelectorAll('.board-skill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const skill = items.find((s) => s.id === btn.dataset.skillId);
      if (skill) onUse(skill);
    });
  });
}

function refreshActiveCharacterSelect(ctx, selectEl) {
  if (!selectEl) return;
  const { board, isGM, roster, userCharacterSourceId } = ctx;

  if (isGM) {
    const options = board.tokens.map((t) => ({
      id: t.id,
      label: `${t.name} (${cellLabel(t.col, t.row)})`
    }));
    const onBoardCharIds = new Set(
      board.tokens.filter((t) => t.kind === 'character').map((t) => t.sourceId)
    );
    roster
      .filter((c) => !onBoardCharIds.has(c.id))
      .forEach((c) => options.push({ id: c.id, label: c.name }));

    selectEl.innerHTML = options.length
      ? options.map((o) => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('')
      : '<option value="">— Sin chapas en tablero —</option>';
    selectEl.disabled = false;
    return;
  }

  const token = board.tokens.find(
    (t) => t.kind === 'character' && t.sourceId === userCharacterSourceId
  );
  selectEl.innerHTML = token
    ? `<option value="${token.id}">${escapeHtml(token.name)} (${cellLabel(token.col, token.row)})</option>`
    : '<option value="">— Tu personaje no está en el tablero —</option>';
  selectEl.disabled = true;
}

export function initBoardCombatUi(ctx) {
  const {
    board,
    user,
    members,
    member,
    roster,
    isGM,
    userCharacterSourceId,
    mentionUi,
    onOpenMention
  } = ctx;

  const combatPanel = document.getElementById('board-combat-panel');
  const turnPanel = document.getElementById('board-turn-panel');
  const turnBannerEl = document.getElementById('board-turn-banner');
  const turnListEl = document.getElementById('board-turn-list');
  const diceForm = document.getElementById('board-dice-form');
  const actionForm = document.getElementById('board-action-form');
  const actionText = document.getElementById('board-action-text');
  const activeSelect = document.getElementById('board-active-character');
  const skillsList = document.getElementById('board-skills-list');
  const combatHint = document.getElementById('board-combat-hint');

  let mentionAtIndex = null;

  function openBoardMentionModal(atIndex) {
    if (!mentionUi?.modal || !actionText) return;
    mentionAtIndex = atIndex;
    const list = document.getElementById('board-mention-list');
    if (!list) return;
    list.innerHTML = '';
    if (!board.tokens.length) {
      list.innerHTML = '<p class="text-muted small mb-0">No hay chapas en el tablero.</p>';
    } else {
      board.tokens.forEach((token) => {
        list.appendChild(renderBoardMentionPickerItem(token, (selected) => {
          insertMention(actionText, mentionAtIndex, selected.id);
          mentionUi.modal.hide();
        }));
      });
    }
    mentionUi.modal.show();
  }

  actionText?.addEventListener('input', () => {
    const pos = actionText.selectionStart;
    if (pos > 0 && actionText.value[pos - 1] === '@') {
      openBoardMentionModal(pos - 1);
    }
  });

  board.logEl?.addEventListener('click', (e) => {
    const tag = e.target.closest('.swrp-char-tag[data-mention-id]');
    if (!tag || !onOpenMention) return;
    onOpenMention(tag.dataset.mentionId);
  });

  let turnOptions = buildTurnOptions(members, board.tokens);

  function syncPanelsVisibility() {
    const started = board.combatStarted;
    combatPanel?.classList.toggle('d-none', !started);
    turnPanel?.classList.toggle('d-none', !started);
    document.getElementById('board-turn-assign-hint')?.classList.toggle('d-none', !isGM);
    turnListEl?.classList.toggle('d-none', !isGM);
    if (combatHint) {
      combatHint.classList.toggle('d-none', started || !isGM);
    }
  }

  function refreshAll() {
    turnOptions = buildTurnOptions(members, board.tokens);
    syncTurnUi(board.activeTurn, turnOptions, turnBannerEl, turnListEl, isGM);
    refreshActiveCharacterSelect(ctx, activeSelect);
    const { actor: char } = resolveActiveActor(ctx, activeSelect) || {};
    renderSkillsList(skillsList, char, async (skill) => {
      if (!canUseCombatActions(board, isGM, user.uid)) {
        await swrpAlert({ title: 'Fuera de turno', message: 'Solo puedes usar habilidades en tu turno.' });
        return;
      }
      const resolved = resolveActiveActor(ctx, activeSelect);
      if (!resolved?.actor) {
        await swrpAlert({ title: 'Sin actor', message: 'No hay chapa activa para registrar la habilidad.' });
        return;
      }
      await board.appendLog(logEntrySkill(resolved.actor, skill, resolved.cell));
    });
    syncPanelsVisibility();
  }

  const prevOnTokensChange = board.onTokensChange;
  board.onTokensChange = (tokens) => {
    prevOnTokensChange(tokens);
    refreshAll();
  };

  const prevOnCombatStateChange = board.onCombatStateChange;
  board.onCombatStateChange = (started) => {
    prevOnCombatStateChange(started);
    syncPanelsVisibility();
    if (started) refreshAll();
  };

  board.onActiveTurnChange = () => refreshAll();

  turnListEl?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.board-turn-btn');
    if (!btn || !isGM) return;
    const turn = {
      kind: btn.dataset.turnKind,
      userId: btn.dataset.turnUser || null,
      sourceId: btn.dataset.turnSource || null,
      tokenId: btn.dataset.turnToken || null,
      label: btn.dataset.turnLabel
    };
    if (turn.userId === '') turn.userId = null;
    if (turn.sourceId === '') turn.sourceId = null;
    if (turn.tokenId === '') turn.tokenId = null;
    await board.setActiveTurn(turn);
  });

  diceForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canUseCombatActions(board, isGM, user.uid)) {
      await swrpAlert({ title: 'Fuera de turno', message: 'Solo puedes tirar dados en tu turno.' });
      return;
    }
    const resolved = resolveActiveActor(ctx, activeSelect);
    if (!resolved?.actor) {
      await swrpAlert({
        title: 'Sin actor',
        message: isGM
          ? 'Selecciona una chapa del tablero para tirar dados.'
          : 'Tu personaje debe estar en el tablero.'
      });
      return;
    }
    const { actor: char, cell } = resolved;
    const notation = document.getElementById('board-dice-type').value;
    const mod = parseInt(document.getElementById('board-dice-mod').value, 10) || 0;
    const label = document.getElementById('board-dice-label').value.trim();
    const attackMod = label.toLowerCase().includes('ataque') ? (char.attack ?? mod) : mod;
    try {
      const roll = rollDice(notation, attackMod);
      await board.appendLog(logEntryDice(char, roll, label, cell));
    } catch (err) {
      await swrpAlert({ title: 'Error en tirada', message: err.message });
    }
  });

  actionForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canUseCombatActions(board, isGM, user.uid)) {
      await swrpAlert({ title: 'Fuera de turno', message: 'Solo puedes registrar acciones en tu turno.' });
      return;
    }
    const text = document.getElementById('board-action-text').value.trim();
    if (!text) return;
    const resolved = resolveActiveActor(ctx, activeSelect);
    if (!resolved?.actor) {
      await swrpAlert({ title: 'Sin actor', message: 'Selecciona una chapa para registrar la acción.' });
      return;
    }
    await board.appendLog(logEntryAction(resolved.actor, text, resolved.cell));
    document.getElementById('board-action-text').value = '';
  });

  activeSelect?.addEventListener('change', () => {
    const { actor: char } = resolveActiveActor(ctx, activeSelect) || {};
    renderSkillsList(skillsList, char, async (skill) => {
      if (!canUseCombatActions(board, isGM, user.uid)) {
        await swrpAlert({ title: 'Fuera de turno', message: 'Solo puedes usar habilidades en tu turno.' });
        return;
      }
      const resolved = resolveActiveActor(ctx, activeSelect);
      if (!resolved?.actor) return;
      await board.appendLog(logEntrySkill(resolved.actor, skill, resolved.cell));
    });
  });

  refreshAll();
  syncPanelsVisibility();

  return { refreshAll };
}