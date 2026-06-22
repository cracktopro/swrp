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
import { insertMention, renderMentionPickerItem } from './party-markup.js';
import { renderCharacterCard } from './character-card.js';

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

  showMain();
  setPartyHeader(party, member, user.uid);

  let members = await loadPartyMembers(partyId);
  let partyRoster = getJoinedCharacterRoster(members);
  const userCharacters = await loadUserCharacters(user.uid);
  const isGM = isPartyGMUser(members, user.uid);

  const roleMode = document.getElementById('role-mode');
  const roleChar = document.getElementById('role-character');
  const roleCharWrap = document.getElementById('role-char-wrap');
  const roleSave = document.getElementById('role-save');
  const activeSelect = document.getElementById('active-character');
  const preview = document.getElementById('active-card-preview');

  function syncRoleForm() {
    const gmTaken = getPartyGM(members);
    const canPickGM = !gmTaken || gmTaken.userId === user.uid;
    roleMode.innerHTML = `
      <option value="character">Jugar con personaje</option>
      ${canPickGM ? '<option value="gm">Actuar como GM</option>' : ''}`;
    roleMode.value = member.playMode || 'character';
    roleChar.innerHTML = userCharacters
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join('');
    if (member.characterId) roleChar.value = member.characterId;
    roleCharWrap.classList.toggle('d-none', roleMode.value === 'gm');
  }

  function refreshActiveSelect() {
    members = members;
    partyRoster = getJoinedCharacterRoster(members);
    if (isGM) {
      activeSelect.innerHTML =
        '<option value="">— GM (sin personaje / situacional) —</option>' +
        partyRoster.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
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

  roleMode.addEventListener('change', () => {
    roleCharWrap.classList.toggle('d-none', roleMode.value === 'gm');
  });

  roleSave.addEventListener('click', async () => {
    try {
      const playMode = roleMode.value;
      const character = playMode === 'character'
        ? userCharacters.find((c) => c.id === roleChar.value)
        : null;
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

  let mentionAtIndex = null;

  function openMentionModal(atIndex) {
    mentionAtIndex = atIndex;
    const list = document.getElementById('mention-list');
    list.innerHTML = '';
    if (!partyRoster.length) {
      list.innerHTML = '<p class="text-muted small mb-0">No hay personajes unidos a la partida.</p>';
    } else {
      partyRoster.forEach((char) => {
        list.appendChild(renderMentionPickerItem(char, (selected) => {
          insertMention(narrativeText, mentionAtIndex, selected.id);
          mentionModal.hide();
        }));
      });
    }
    mentionModal.show();
  }

  narrativeText.addEventListener('input', () => {
    const pos = narrativeText.selectionStart;
    if (pos > 0 && narrativeText.value[pos - 1] === '@') {
      openMentionModal(pos - 1);
    }
  });

  watchPosts(partyId, document.getElementById('posts-feed'), {
    onOpenCharacter: ui.openCharacterModal,
    roster: partyRoster
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
    const text = narrativeText.value.trim();
    if (!text) return;
    let char;
    if (isGM) {
      char = getActiveCharacter();
    } else {
      if (member.playMode !== 'character') {
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
      narrativeText.value = '';
    } catch (err) {
      alert('Error al publicar mensaje: ' + err.message);
    }
  });
}

async function setupJoinFlow(partyId, user, profile, party, ui, onJoined) {
  const joinMode = document.getElementById('join-mode');
  const joinCharWrap = document.getElementById('join-char-wrap');
  const joinChar = document.getElementById('join-character');
  const joinSubmit = document.getElementById('join-submit');
  const joinPartyName = document.getElementById('join-party-name');

  joinPartyName.textContent = party.name;
  const characters = await loadUserCharacters(user.uid);

  const members = await loadPartyMembers(partyId);
  const hasGM = !!getPartyGM(members);

  joinMode.innerHTML = `
    <option value="character">Con uno de mis personajes</option>
    ${hasGM ? '' : '<option value="gm">Como GM de la partida</option>'}`;

  joinChar.innerHTML = characters.length
    ? characters.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')
    : '<option value="">— Crea un personaje primero —</option>';

  joinMode.addEventListener('change', () => {
    joinCharWrap.classList.toggle('d-none', joinMode.value === 'gm');
  });
  joinCharWrap.classList.toggle('d-none', joinMode.value === 'gm');

  joinSubmit.onclick = async () => {
    try {
      const playMode = joinMode.value;
      const character = playMode === 'character'
        ? characters.find((c) => c.id === joinChar.value)
        : null;
      if (playMode === 'character' && !character) {
        alert('Necesitas al menos un personaje creado.');
        return;
      }
      await joinParty(partyId, user, profile, { playMode, character });
      document.getElementById('join-screen').classList.add('d-none');
      await onJoined();
    } catch (err) {
      alert(err.message);
    }
  };
}
