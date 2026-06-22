import { rollDice, renderDiceResultHtml } from './dice.js';
import { findSkillById, getSkillsForClass, skillTypeBadgeClass } from './compendium-store.js';
import { getClassMeta } from './character-card.js';
import { swrpAlert, swrpConfirm } from './swrp-dialog.js';
import {
  logEntryDice,
  logEntrySkill,
  logEntryAction,
  cellLabel,
  isCombatEnded
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

function syncTurnUi(activeTurn, turnOptions, turnOrder, turnOrderIndex, turnBannerEl, turnListEl, isGM) {
  if (turnBannerEl) {
    if (!activeTurn) {
      turnBannerEl.textContent = 'Sin turno asignado';
      turnBannerEl.className = 'board-turn-banner board-turn-banner--idle small mb-2';
    } else if (activeTurn.kind === 'enemy') {
      turnBannerEl.textContent = `Turno activo: ${activeTurn.label || 'Enemigos'}`;
      turnBannerEl.className = 'board-turn-banner board-turn-banner--enemy small mb-2';
    } else {
      turnBannerEl.textContent = `Turno activo: ${activeTurn.label}`;
      turnBannerEl.className = 'board-turn-banner board-turn-banner--player small mb-2';
    }
  }

  if (!turnListEl || !isGM) return;

  const options = turnOrder?.length ? turnOrder : turnOptions;
  turnListEl.innerHTML = options.map((opt, index) => {
    const active = turnKey(activeTurn) === turnKey(opt);
    const queued = turnOrder?.length && index === turnOrderIndex;
    const initiative = opt.initiativeTotal != null ? ` (${opt.initiativeTotal})` : '';
    return `
      <button type="button"
        class="board-turn-btn${active ? ' is-active' : ''}${queued ? ' is-queued' : ''}"
        data-turn-kind="${opt.kind}"
        data-turn-user="${opt.userId || ''}"
        data-turn-source="${opt.sourceId || ''}"
        data-turn-token="${opt.tokenId || ''}"
        data-turn-label="${escapeHtml(opt.label)}">
        ${escapeHtml(opt.label)}${initiative}
      </button>`;
  }).join('');
}

export function computeInitiativeOrder(entries, members, tokens) {
  const byKey = new Map();
  (entries || []).forEach((entry) => {
    if (typeof entry === 'string') return;
    const key = entry.actorKey || entry.actorName;
    const total = entry.roll?.total ?? 0;
    const existing = byKey.get(key);
    if (!existing || total > existing.initiativeTotal) {
      byKey.set(key, { ...entry, initiativeTotal: total });
    }
  });

  return Array.from(byKey.values())
    .sort((a, b) => b.initiativeTotal - a.initiativeTotal)
    .map((entry) => turnFromInitiativeEntry(entry, members, tokens));
}

function turnFromInitiativeEntry(entry, members, tokens) {
  if (entry.actorKey === 'enemy' || entry.kind === 'enemy' && !entry.tokenId) {
    return {
      kind: 'enemy',
      label: entry.actorName || 'Enemigos',
      userId: null,
      sourceId: null,
      tokenId: null,
      initiativeTotal: entry.initiativeTotal,
      class: entry.actorClass,
      color: entry.actorColor
    };
  }

  const token = entry.tokenId
    ? tokens.find((t) => t.id === entry.tokenId)
    : tokens.find((t) => t.kind === 'character' && t.sourceId === entry.sourceId);
  const sourceId = entry.sourceId || token?.sourceId || null;
  const member = members.find((m) => m.characterId === sourceId);

  if (entry.kind === 'enemy' || token?.side === 'enemy') {
    return {
      kind: 'enemy',
      label: entry.actorName || token?.name || 'Enemigos',
      userId: null,
      sourceId: sourceId || null,
      tokenId: entry.tokenId || token?.id || null,
      initiativeTotal: entry.initiativeTotal,
      class: entry.actorClass || token?.class,
      color: entry.actorColor
    };
  }

  return {
    kind: 'player',
    label: entry.actorName || token?.name || 'Jugador',
    userId: entry.userId || member?.userId || null,
    sourceId,
    tokenId: entry.tokenId || token?.id || null,
    initiativeTotal: entry.initiativeTotal,
    class: entry.actorClass || token?.class,
    color: entry.actorColor
  };
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

function canUseNarrative(board) {
  if (!board.combatStarted || board.initiativeOpen) return false;
  return board.canControlActiveTurn();
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

function refreshInitiativeCharacterSelect(ctx, selectEl) {
  if (!selectEl) return;
  const { board, isGM, roster, userCharacterSourceId } = ctx;

  if (isGM) {
    const options = [{ id: '__enemies__', label: 'Enemigos (GM)' }];
    board.tokens.forEach((t) => {
      options.push({
        id: t.id,
        label: `${t.name} (${cellLabel(t.col, t.row)})`
      });
    });
    const onBoardCharIds = new Set(
      board.tokens.filter((t) => t.kind === 'character').map((t) => t.sourceId)
    );
    roster
      .filter((c) => !onBoardCharIds.has(c.id))
      .forEach((c) => options.push({ id: c.id, label: c.name }));

    selectEl.innerHTML = options.length
      ? options.map((o) => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('')
      : '<option value="">— Sin opciones —</option>';
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

function resolveInitiativeActor(ctx, selectEl) {
  const { board, isGM, roster, members } = ctx;
  if (!selectEl?.value) return null;

  if (isGM && selectEl.value === '__enemies__') {
    return {
      actor: { name: 'Enemigos', class: 'soldado', color: '#ff1744' },
      actorKey: 'enemy',
      kind: 'enemy',
      userId: null,
      sourceId: null,
      tokenId: null,
      cell: null
    };
  }

  if (isGM) {
    const token = board.tokens.find((t) => t.id === selectEl.value);
    if (token) {
      const resolved = actorFromToken(token);
      const member = members.find((m) => m.characterId === token.sourceId);
      const actorKey = token.kind === 'character'
        ? `player:${token.sourceId}`
        : `token:${token.id}`;
      return {
        ...resolved,
        actorKey,
        kind: token.side === 'enemy' ? 'enemy' : 'player',
        userId: member?.userId || null,
        sourceId: token.sourceId,
        tokenId: token.id
      };
    }
    const char = roster.find((c) => c.id === selectEl.value);
    if (char) {
      const meta = getClassMeta(char.class);
      const member = members.find((m) => m.characterId === char.id);
      return {
        actor: { ...char, color: meta.color },
        actorKey: `player:${char.id}`,
        kind: 'player',
        userId: member?.userId || null,
        sourceId: char.id,
        tokenId: null,
        cell: null
      };
    }
    return null;
  }

  const token = board.tokens.find((t) => t.id === selectEl.value);
  if (token?.kind === 'character' && token.sourceId === ctx.userCharacterSourceId) {
    const resolved = actorFromToken(token);
    const member = members.find((m) => m.characterId === token.sourceId);
    return {
      ...resolved,
      actorKey: `player:${token.sourceId}`,
      kind: 'player',
      userId: member?.userId || null,
      sourceId: token.sourceId,
      tokenId: token.id
    };
  }
  return null;
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
  const initiativePanel = document.getElementById('board-initiative-panel');
  const initiativeSelect = document.getElementById('board-initiative-character');
  const initiativeRollBtn = document.getElementById('board-initiative-roll');
  const initiativeCompleteBtn = document.getElementById('board-initiative-complete');
  const advanceTurnBtn = document.getElementById('board-advance-turn');
  const endCombatBtn = document.getElementById('board-end-combat');
  const turnActionsPanel = document.getElementById('board-turn-actions');
  const actionStatusEl = document.getElementById('board-action-status');
  const actionMoveBtn = document.getElementById('board-action-mode-move');
  const actionAttackBtn = document.getElementById('board-action-mode-attack');
  const attackToolsEl = document.getElementById('board-attack-tools');

  let mentionAtIndex = null;

  function syncTurnActionUi() {
    const inCombat = board.combatStarted && !board.initiativeOpen;
    const hasControl = board.canControlActiveTurn();
    const used = board.getActionsUsed();

    turnActionsPanel?.classList.toggle('d-none', !inCombat || !hasControl);
    advanceTurnBtn?.classList.toggle('d-none', !board.canUserAdvanceTurn());

    if (actionStatusEl) {
      actionStatusEl.textContent = `Acciones: ${used}/2`;
    }

    const canPickMore = hasControl && used < 2;
    if (actionMoveBtn) {
      actionMoveBtn.disabled = !canPickMore;
      actionMoveBtn.classList.toggle('is-active', board.turnActions.activeMode === 'move');
    }
    if (actionAttackBtn) {
      actionAttackBtn.disabled = !canPickMore;
      actionAttackBtn.classList.toggle('is-active', board.turnActions.activeMode === 'attack');
    }

    const attackReady = board.canUseAttackActions();
    attackToolsEl?.classList.toggle('board-attack-tools--disabled', !attackReady);
    diceForm?.querySelectorAll('input, select, button').forEach((el) => {
      el.disabled = !attackReady;
    });
    skillsList?.querySelectorAll('.board-skill-btn').forEach((btn) => {
      btn.disabled = !attackReady;
    });
  }

  function syncCombatControls() {
    const combatEnded = board.combatStarted && isCombatEnded(board.tokens);
    endCombatBtn?.classList.toggle('d-none', !isGM || !combatEnded);
    syncTurnActionUi();
  }

  function refreshInitiativeUi() {
    const order = computeInitiativeOrder(board.initiativeLog, members, board.tokens);
    board.renderInitiativeOrderPreview(order);
    if (initiativeCompleteBtn) {
      initiativeCompleteBtn.classList.toggle('d-none', !isGM || !board.initiativeOpen || !order.length);
    }
  }

  function syncCombatControls() {
    const combatEnded = board.combatStarted && isCombatEnded(board.tokens);
    endCombatBtn?.classList.toggle('d-none', !isGM || !combatEnded);
    syncTurnActionUi();
  }

  function syncPanelsVisibility() {
    const started = board.combatStarted;
    const initiativeOpen = board.initiativeOpen;
    combatPanel?.classList.toggle('d-none', !started || initiativeOpen);
    turnPanel?.classList.toggle('d-none', !started || initiativeOpen);
    initiativePanel?.classList.toggle('d-none', !initiativeOpen);
    document.getElementById('board-turn-assign-hint')?.classList.toggle('d-none', !isGM);
    turnListEl?.classList.toggle('d-none', !isGM);
    if (combatHint) {
      combatHint.classList.toggle('d-none', started || !isGM);
    }
    refreshInitiativeUi();
    syncCombatControls();
  }

  function refreshAll() {
    turnOptions = buildTurnOptions(members, board.tokens);
    syncTurnUi(
      board.activeTurn,
      turnOptions,
      board.turnOrder,
      board.turnOrderIndex,
      turnBannerEl,
      turnListEl,
      isGM
    );
    refreshActiveCharacterSelect(ctx, activeSelect);
    refreshInitiativeCharacterSelect(ctx, initiativeSelect);
    const { actor: char } = resolveActiveActor(ctx, activeSelect) || {};
    renderSkillsList(skillsList, char, async (skill) => {
      if (!board.canUseAttackActions()) {
        await swrpAlert({ title: 'Acción no disponible', message: 'Elige «Atacar» para usar habilidades.' });
        return;
      }
      const resolved = resolveActiveActor(ctx, activeSelect);
      if (!resolved?.actor) {
        await swrpAlert({ title: 'Sin actor', message: 'No hay chapa activa para registrar la habilidad.' });
        return;
      }
      await board.appendLog(logEntrySkill(resolved.actor, skill, resolved.cell));
      await board.consumeAttackAction();
      syncTurnActionUi();
    });
    syncPanelsVisibility();
    syncCombatControls();
  }

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

  const prevOnInitiativeStateChange = board.onInitiativeStateChange;
  board.onInitiativeStateChange = () => {
    prevOnInitiativeStateChange?.();
    syncPanelsVisibility();
    refreshAll();
  };

  board.onTurnActionsChange = () => {
    syncTurnActionUi();
    board.render();
  };

  const prevOnInitiativeLog = board.onInitiativeLogChange;
  board.onInitiativeLogChange = () => {
    prevOnInitiativeLog?.();
    refreshInitiativeUi();
  };

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

  initiativeRollBtn?.addEventListener('click', async () => {
    if (!board.initiativeOpen) {
      await swrpAlert({
        title: 'Iniciativa cerrada',
        message: 'La tirada de iniciativa no está disponible durante el ciclo de turnos.'
      });
      return;
    }
    const resolved = resolveInitiativeActor(ctx, initiativeSelect);
    if (!resolved?.actor) {
      await swrpAlert({
        title: 'Sin actor',
        message: isGM
          ? 'Selecciona un personaje o Enemigos para tirar iniciativa.'
          : 'Tu personaje debe estar en el tablero para tirar iniciativa.'
      });
      return;
    }
    try {
      const roll = rollDice('1d20', 0);
      await board.appendInitiativeRoll({
        name: resolved.actor.name,
        class: resolved.actor.class,
        color: resolved.actor.color,
        actorKey: resolved.actorKey,
        kind: resolved.kind,
        userId: resolved.userId,
        sourceId: resolved.sourceId,
        tokenId: resolved.tokenId
      }, roll);
      refreshInitiativeUi();
    } catch (err) {
      await swrpAlert({ title: 'Error en tirada', message: err.message });
    }
  });

  initiativeCompleteBtn?.addEventListener('click', async () => {
    if (!isGM || !board.initiativeOpen) return;
    const order = computeInitiativeOrder(board.initiativeLog, members, board.tokens);
    if (!order.length) {
      await swrpAlert({
        title: 'Sin tiradas',
        message: 'Registra al menos una tirada de iniciativa antes de completar.'
      });
      return;
    }
    const ok = await swrpConfirm({
      title: 'Completar iniciativa',
      message: `¿Iniciar el combate con este orden?\n\n${order.map((t) => t.label).join(' → ')}`,
      confirmText: 'Completar',
      cancelText: 'Cancelar'
    });
    if (!ok) return;
    await board.completeInitiative(order);
    refreshAll();
  });

  actionMoveBtn?.addEventListener('click', async () => {
    if (!board.canUseMoveMode()) {
      await swrpAlert({
        title: 'Sin acciones',
        message: 'Ya has usado tus 2 acciones este turno.'
      });
      return;
    }
    await board.selectActionMode('move');
    syncTurnActionUi();
  });

  actionAttackBtn?.addEventListener('click', async () => {
    if (!board.canUseAttackMode()) {
      await swrpAlert({
        title: 'Sin acciones',
        message: 'Ya has usado tus 2 acciones este turno.'
      });
      return;
    }
    await board.selectActionMode('attack');
    syncTurnActionUi();
  });

  advanceTurnBtn?.addEventListener('click', async () => {
    await board.advanceTurn();
    refreshAll();
  });

  endCombatBtn?.addEventListener('click', async () => {
    const ok = await swrpConfirm({
      title: 'Finalizar combate',
      message: '¿Finalizar el combate? Se habilitará una nueva tirada de iniciativa.',
      confirmText: 'Finalizar',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;
    await board.endCombat();
    refreshAll();
  });

  diceForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!board.canUseAttackActions()) {
      await swrpAlert({ title: 'Acción no disponible', message: 'Elige «Atacar» para lanzar dados.' });
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
      await board.consumeAttackAction();
      syncTurnActionUi();
    } catch (err) {
      await swrpAlert({ title: 'Error en tirada', message: err.message });
    }
  });

  actionForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canUseNarrative(board)) {
      await swrpAlert({ title: 'Fuera de turno', message: 'Solo puedes registrar acciones narrativas en tu turno.' });
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
      if (!board.canUseAttackActions()) {
        await swrpAlert({ title: 'Acción no disponible', message: 'Elige «Atacar» para usar habilidades.' });
        return;
      }
      const resolved = resolveActiveActor(ctx, activeSelect);
      if (!resolved?.actor) return;
      await board.appendLog(logEntrySkill(resolved.actor, skill, resolved.cell));
      await board.consumeAttackAction();
      syncTurnActionUi();
    });
  });

  refreshAll();
  syncPanelsVisibility();

  return { refreshAll };
}