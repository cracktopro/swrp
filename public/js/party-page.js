import { loadUserCharacters } from './characters.js';
import {
  loadParty,
  loadPartyMembers,
  getPartyMember,
  isPartyGMUser,
  watchPosts,
  publishDiceRoll,
  publishNarrative
} from './party.js';
import {
  joinParty,
  updatePartyMembership,
  getPartyGM,
  memberToActiveCharacter,
  getJoinedCharacterRoster
} from './party-members.js';
import { loadAllNpcs, npcToCardData } from './npcs.js';
import { initNpcPicker, initCharacterPicker } from './npc-picker.js';
import { buildRosterMap } from './party-markup.js';
import { mountNarrativeComposer } from './narrative-composer.js';
import { renderCharacterCard } from './character-card.js';
import { boardPageUrl } from './party-url.js';
import { assignSpawnToMember, hasEscaramuzaSlotConfig } from './escaramuza-templates.js';

export async function initPartyPage({ user, profile, partyId, ui }) {
  const {
    showError,
    showJoin,
    showMain,
    setPartyHeader,
    charModal,
    mentionModal,
    narrativeText
  } = ui;

  let party = await loadParty(partyId);
  if (!party) {
    showError(`La partida «${partyId}» no existe.`);
    return;
  }

  let member = await getPartyMember(partyId, user.uid);
  if (!member) {
    showJoin(party);
    await setupJoinFlow(partyId, user, profile, party, ui, () => initPartyPage({ user, profile, partyId, ui }));
    return;
  }

  if (party.type === 'Escaramuza') {
    window.location.assign(boardPageUrl(partyId));
    return;
  }

  showMain();
  setPartyHeader(party, member, user.uid);

  let members = await loadPartyMembers(partyId);
  let partyRoster = getJoinedCharacterRoster(members);
  const userCharacters = await loadUserCharacters(user.uid);
  const partyNpcs = (await loadAllNpcs()).map(npcToCardData);
  const isGM = isPartyGMUser(members, user.uid);

  const mentionMap = buildRosterMap(partyRoster);
  partyNpcs.forEach((npc) => {
    if (npc?.id) mentionMap.set(npc.id, npc);
  });

  const narrativeComposer = mountNarrativeComposer(narrativeText, {
    getPlayers: () => partyRoster,
    getNpcs: () => partyNpcs,
    resolveMention: (id) => mentionMap.get(id) || null
  });

  const roleMode = document.getElementById('role-mode');
  const roleChar = document.getElementById('role-character');
  const roleSave = document.getElementById('role-save');
  const activeSelect = document.getElementById('active-character');
  const preview = document.getElementById('active-card-preview');

  const roleCharLabel = document.getElementById('role-char-label');
  const roleCharHint = document.getElementById('role-char-hint');

  function buildCharacterOptions(characters, { optional } = {}) {
    const empty = optional ? '<option value="">— Ninguno —</option>' : '';
    const list = characters.length
      ? characters.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')
      : '<option value="">— Crea un personaje primero —</option>';
    return empty + list;
  }

  function syncRoleCharUi() {
    const isGmMode = roleMode.value === 'gm';
    roleCharLabel.textContent = isGmMode
      ? 'Mi personaje en la partida (opcional)'
      : 'Personaje asignado';
    roleCharHint.textContent = isGmMode
      ? 'Si eliges uno, podrás colocarlo en el tablero y jugarlo en combate.'
      : '';
    roleChar.innerHTML = buildCharacterOptions(userCharacters, { optional: isGmMode });
    if (member.characterId && userCharacters.some((c) => c.id === member.characterId)) {
      roleChar.value = member.characterId;
    } else if (isGmMode) {
      roleChar.value = '';
    }
  }

  function syncRoleForm() {
    const gmTaken = getPartyGM(members);
    const canPickGM = !gmTaken || gmTaken.userId === user.uid;
    roleMode.innerHTML = `
      <option value="character">Jugar con personaje</option>
      ${canPickGM ? '<option value="gm">Actuar como GM</option>' : ''}`;
    roleMode.value = member.playMode || 'character';
    syncRoleCharUi();
  }

  function refreshActiveSelect() {
    members = members;
    partyRoster = getJoinedCharacterRoster(members);
    if (isGM) {
      activeSelect.innerHTML =
        '<option value="">— GM (sin personaje / situacional) —</option>' +
        partyRoster.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
      if (member.characterId && partyRoster.some((c) => c.id === member.characterId)) {
        activeSelect.value = member.characterId;
      }
      activeSelect.disabled = false;
    } else {
      const mine = memberToActiveCharacter(member);
      activeSelect.innerHTML = mine
        ? `<option value="${mine.id}">${mine.name}</option>`
        : '<option value="">— Sin personaje —</option>';
      activeSelect.disabled = true;
    }
    updatePreview();
  }

  function getActiveCharacter() {
    if (isGM) {
      if (!activeSelect.value) return null;
      return partyRoster.find((c) => c.id === activeSelect.value) || null;
    }
    return memberToActiveCharacter(member);
  }

  function updatePreview() {
    preview.innerHTML = '';
    const char = getActiveCharacter();
    if (char) preview.appendChild(renderCharacterCard(char, { mini: true }));
  }

  syncRoleForm();
  refreshActiveSelect();

  roleMode.addEventListener('change', syncRoleCharUi);

  roleSave.addEventListener('click', async () => {
    try {
      const playMode = roleMode.value;
      const charId = roleChar.value;
      const character = charId ? userCharacters.find((c) => c.id === charId) : null;
      if (playMode === 'character' && !character) {
        alert('Selecciona un personaje.');
        return;
      }
      await updatePartyMembership(partyId, user.uid, user, profile, { playMode, character });
      member = await getPartyMember(partyId, user.uid);
      members = await loadPartyMembers(partyId);
      partyRoster = getJoinedCharacterRoster(members);
      refreshActiveSelect();
      setPartyHeader(party, member, user.uid);
      alert('Participación actualizada.');
      window.location.reload();
    } catch (err) {
      alert(err.message);
    }
  });

  activeSelect.addEventListener('change', updatePreview);

  watchPosts(partyId, document.getElementById('posts-feed'), {
    onOpenCharacter: ui.openCharacterModal,
    roster: partyRoster,
    extraMentionEntities: partyNpcs
  });

  document.getElementById('dice-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const char = getActiveCharacter();
    if (!char) {
      alert(isGM ? 'Selecciona un personaje de la partida para tirar dados.' : 'Debes jugar con un personaje asignado.');
      return;
    }
    const notation = document.getElementById('dice-type').value;
    const mod = parseInt(document.getElementById('dice-mod').value, 10) || 0;
    const label = document.getElementById('dice-label').value.trim();
    const attackMod = label.toLowerCase().includes('ataque') ? char.attack : mod;
    try {
      await publishDiceRoll(partyId, user, char, notation, attackMod, label);
    } catch (err) {
      alert('Error al publicar tirada: ' + err.message);
    }
  });

  document.getElementById('narrative-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = narrativeComposer?.getValue().trim() || narrativeText.value.trim();
    if (!text) return;
    let char;
    if (isGM) {
      char = getActiveCharacter();
    } else {
      if (member.playMode !== 'character' && member.playMode !== 'npc') {
        alert('Debes jugar con un personaje asignado.');
        return;
      }
      char = memberToActiveCharacter(member);
      if (!char) {
        alert('Debes tener un personaje asignado.');
        return;
      }
    }
    try {
      await publishNarrative(partyId, user, char, text);
      narrativeComposer?.clear();
      narrativeText.value = '';
    } catch (err) {
      alert('Error al publicar mensaje: ' + err.message);
    }
  });
}

async function setupJoinFlow(partyId, user, profile, party, ui, onJoined) {
  const joinMode = document.getElementById('join-mode');
  const joinPickerWrap = document.getElementById('join-picker-wrap');
  const joinPickerLabel = document.getElementById('join-picker-label');
  const joinPickerHint = document.getElementById('join-picker-hint');
  const joinFilterEraWrap = document.getElementById('join-filter-era-wrap');
  const joinSubmit = document.getElementById('join-submit');
  const joinPartyName = document.getElementById('join-party-name');

  const isEscaramuza = party.type === 'Escaramuza';
  const isPredefined = !!party.templateId;
  joinPartyName.textContent = party.name;
  const characters = await loadUserCharacters(user.uid);
  const allNpcs = isEscaramuza && !isPredefined
    ? (await loadAllNpcs()).map(npcToCardData)
    : [];

  const members = await loadPartyMembers(partyId);
  const hasGM = !!getPartyGM(members);
  const slotsFull = isEscaramuza && hasEscaramuzaSlotConfig(party) && members.length >= party.maxSlots;

  if (slotsFull) {
    joinSubmit.disabled = true;
    joinPartyName.textContent = `${party.name} — Sin plazas disponibles`;
  }

  if (isPredefined) {
    joinMode.innerHTML = '<option value="character">Con uno de mis personajes</option>';
  } else {
    joinMode.innerHTML = `
    <option value="character">Con uno de mis personajes</option>
    ${isEscaramuza ? '<option value="npc">Con un personaje NPC</option>' : ''}
    ${hasGM ? '' : '<option value="gm">Como GM de la partida</option>'}`;
  }

  let entityPicker = null;
  let pickerMode = null;

  function syncJoinCharUi() {
    const mode = joinMode.value;
    const isGmMode = mode === 'gm';
    const isNpcMode = mode === 'npc';
    const showPicker = !isGmMode || characters.length > 0;

    joinPickerWrap?.classList.toggle('d-none', !showPicker && !isGmMode);
    joinFilterEraWrap?.classList.toggle('d-none', !isNpcMode);

    joinPickerLabel.textContent = isNpcMode
      ? 'Elige un personaje NPC'
      : (isGmMode ? 'Mi personaje en la partida (opcional)' : 'Elige tu personaje');
    joinPickerHint.textContent = isGmMode
      ? 'Opcional: si eliges uno, podrás colocarlo en el tablero y jugarlo en combate.'
      : (isNpcMode ? '' : '');

    if (pickerMode !== mode) {
      entityPicker = null;
      pickerMode = mode;
    }

    if (isNpcMode) {
      if (!entityPicker) {
        entityPicker = initNpcPicker({
          listEl: document.getElementById('join-picker-list'),
          nameInput: document.getElementById('join-filter-name'),
          classSelect: document.getElementById('join-filter-class'),
          eraSelect: document.getElementById('join-filter-era'),
          npcs: allNpcs,
          onSelect: () => {}
        });
      } else {
        entityPicker.refresh(allNpcs);
      }
      return;
    }

    if (!entityPicker) {
      entityPicker = initCharacterPicker({
        listEl: document.getElementById('join-picker-list'),
        nameInput: document.getElementById('join-filter-name'),
        classSelect: document.getElementById('join-filter-class'),
        characters,
        optional: isGmMode,
        onSelect: () => {}
      });
    } else {
      entityPicker.refresh(characters);
    }
  }

  syncJoinCharUi();
  joinMode.addEventListener('change', syncJoinCharUi);

  joinSubmit.onclick = async () => {
    try {
      const playMode = joinMode.value;
      let character = null;
      if (playMode === 'character') {
        character = entityPicker?.getSelected();
        if (!character) {
          alert('Necesitas al menos un personaje creado.');
          return;
        }
      } else if (playMode === 'npc') {
        character = entityPicker?.getSelected();
        if (!character) {
          alert('Selecciona un NPC de la lista.');
          return;
        }
      } else if (playMode === 'gm') {
        character = entityPicker?.getSelected() || null;
      }
      await joinParty(partyId, user, profile, { playMode, character });
      if (hasEscaramuzaSlotConfig(party)) {
        await assignSpawnToMember(party, partyId, user.uid);
      }
      if (party.type === 'Escaramuza') {
        window.location.assign(boardPageUrl(partyId));
        return;
      }
      document.getElementById('join-screen').classList.add('d-none');
      await onJoined();
    } catch (err) {
      alert(err.message);
    }
  };
}
