import {
  db,
  doc,
  getDoc,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from './firebase-config.js';
import { rollDice, formatRollResult, renderDiceResultHtml } from './dice.js';
import { normalizeCharacter, renderCharacterTag, getClassMeta } from './character-card.js';
import {
  loadPartyMembers,
  getPartyMember,
  getJoinedCharacterRoster,
  isPartyGMUser,
  buildCharacterSnapshot
} from './party-members.js';
import { buildRosterMap, renderNarrativeContent } from './party-markup.js';

export async function loadParty(partyId) {
  const snap = await getDoc(doc(db, 'parties', partyId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function loadPartyRoster(partyId) {
  const members = await loadPartyMembers(partyId);
  return getJoinedCharacterRoster(members);
}

export async function isPartyMember(partyId, userId) {
  const member = await getPartyMember(partyId, userId);
  return !!member;
}

export { loadPartyMembers, getPartyMember, getJoinedCharacterRoster, isPartyGMUser };

export function watchPosts(partyId, container, options = {}) {
  const { onError, onOpenCharacter, roster = [], extraMentionEntities = [] } = options;
  const q = query(
    collection(db, 'parties', partyId, 'posts'),
    orderBy('createdAt', 'asc')
  );

  return onSnapshot(
    q,
    (snap) => {
      container.innerHTML = '';
      if (!snap.docs.length) {
        container.innerHTML = '<p class="text-muted small p-2">Aún no hay mensajes. ¡Comienza la aventura!</p>';
        return;
      }

      const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const rosterMap = buildRosterMap(roster, posts);
      extraMentionEntities.forEach((entity) => {
        if (entity?.id) rosterMap.set(entity.id, entity);
      });

      posts.forEach((post) => {
        container.appendChild(renderPost(post, onOpenCharacter, rosterMap));
      });
      container.scrollTop = container.scrollHeight;
    },
    (error) => {
      console.error('watchPosts error:', error);
      container.innerHTML = `<p class="text-warning small p-2">No se pudo cargar el foro: ${error.message}</p>`;
      if (onError) onError(error);
    }
  );
}

function applyPostClassStyle(el, snapshot) {
  if (!snapshot?.class) {
    el.classList.add('swrp-post--ambient');
    return;
  }
  const meta = getClassMeta(snapshot.class);
  el.classList.add('swrp-post--class', `theme-${meta.theme}`);
  el.style.setProperty('--post-class-color', meta.color);
}

function renderPost(post, onOpenCharacter, rosterMap) {
  const el = document.createElement('article');
  el.className = 'swrp-post';
  el.dataset.type = post.type || 'narrative';
  applyPostClassStyle(el, post.characterSnapshot);

  const header = document.createElement('div');
  header.className = 'swrp-post__header';

  if (post.characterSnapshot?.name) {
    const tag = renderCharacterTag(post.characterSnapshot, onOpenCharacter);
    if (tag) header.appendChild(tag);
  }

  const body = document.createElement('div');
  body.className = 'swrp-post__body';

  if (post.type === 'dice' && post.roll) {
    body.innerHTML = renderDiceResultHtml(post.roll, post.rollLabel || '');
  } else if (post.type === 'dice' && post.content) {
    body.innerHTML = `<div class="swrp-dice-result swrp-dice-result--legacy">${escapeHtml(post.content)}</div>`;
  } else {
    body.appendChild(renderNarrativeContent(post.content || '', { rosterMap, onOpenCharacter }));
  }

  if (header.childElementCount) el.appendChild(header);
  el.appendChild(body);
  return el;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function publishPost(partyId, data) {
  await addDoc(collection(db, 'parties', partyId, 'posts'), {
    ...data,
    createdAt: serverTimestamp()
  });
}

export async function publishDiceRoll(partyId, user, character, notation, modifier, label) {
  if (!character) {
    throw new Error('Selecciona un personaje activo para tirar dados.');
  }
  const roll = rollDice(notation, modifier);
  const snapshot = buildCharacterSnapshot(character);
  await publishPost(partyId, {
    type: 'dice',
    authorId: user.uid,
    rollLabel: label.trim(),
    roll,
    content: formatRollResult(character.name, roll, label),
    characterSnapshot: snapshot
  });
  return roll;
}

export async function publishNarrative(partyId, user, character, content) {
  await publishPost(partyId, {
    type: 'narrative',
    authorId: user.uid,
    content,
    characterSnapshot: character ? buildCharacterSnapshot(character) : null
  });
}
