import {
  db,
  doc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from './firebase-config.js';
import { rollDice, formatRollResult, renderDiceResultHtml } from './dice.js';
import { renderCharacterTag, getClassMeta } from './character-card.js';
import {
  loadPartyMembers,
  getPartyMember,
  getJoinedCharacterRoster,
  isPartyGMUser,
  buildCharacterSnapshot
} from './party-members.js';
import { buildRosterMap, renderNarrativeContent } from './party-markup.js';
import { mountNarrativeComposer } from './narrative-composer.js';

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
  const {
    onError,
    onOpenCharacter,
    roster = [],
    extraMentionEntities = [],
    currentUserId = null
  } = options;
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
        container.appendChild(renderPost(post, {
          onOpenCharacter,
          rosterMap,
          currentUserId,
          partyId
        }));
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

function renderPost(post, { onOpenCharacter, rosterMap, currentUserId, partyId }) {
  const el = document.createElement('article');
  el.className = 'swrp-post';
  el.dataset.type = post.type || 'narrative';
  el.dataset.postId = post.id;
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

  const canEdit = currentUserId
    && post.authorId === currentUserId
    && post.type === 'narrative';
  if (canEdit) {
    const actions = document.createElement('div');
    actions.className = 'swrp-post__actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-sm btn-swrp btn-swrp-ghost';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => beginPostEdit(el, post, partyId, { rosterMap, onOpenCharacter }));
    actions.appendChild(editBtn);
    el.appendChild(actions);
  }

  return el;
}

function beginPostEdit(postEl, post, partyId, { rosterMap, onOpenCharacter }) {
  const body = postEl.querySelector('.swrp-post__body');
  const actions = postEl.querySelector('.swrp-post__actions');
  if (!body || body.dataset.editing === '1') return;

  body.dataset.editing = '1';
  actions?.classList.add('d-none');

  const wrap = document.createElement('div');
  wrap.className = 'swrp-post__edit-area';

  const textarea = document.createElement('textarea');
  textarea.className = 'form-control form-control-sm mb-2 d-none';
  textarea.id = `post-edit-${post.id}`;
  textarea.rows = 4;
  textarea.value = post.content || '';
  wrap.appendChild(textarea);

  const composerHost = document.createElement('div');
  wrap.appendChild(composerHost);
  body.replaceChildren(wrap);

  const composer = mountNarrativeComposer(textarea, {
    mentionMode: 'party',
    getPartyRoster: () => Array.from(rosterMap.values()),
    resolveMention: (id) => rosterMap.get(id) || null
  });
  composer?.setValue(post.content || '');

  const btnRow = document.createElement('div');
  btnRow.className = 'd-flex gap-2 justify-content-end';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-sm btn-swrp btn-swrp-ghost';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', () => {
    body.removeAttribute('data-editing');
    body.replaceChildren(renderNarrativeContent(post.content || '', { rosterMap, onOpenCharacter }));
    actions?.classList.remove('d-none');
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-sm btn-swrp btn-swrp-primary';
  saveBtn.textContent = 'Guardar';
  saveBtn.addEventListener('click', async () => {
    const next = composer?.getValue().trim() || textarea.value.trim();
    if (!next) {
      alert('El mensaje no puede quedar vacío.');
      return;
    }
    saveBtn.disabled = true;
    try {
      await updateNarrativePost(partyId, post.id, next);
    } catch (err) {
      alert(err.message || 'No se pudo guardar el mensaje.');
      saveBtn.disabled = false;
    }
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  wrap.appendChild(btnRow);
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

export async function updateNarrativePost(partyId, postId, content) {
  const text = String(content || '').trim();
  if (!text) throw new Error('El mensaje no puede quedar vacío.');
  await updateDoc(doc(db, 'parties', partyId, 'posts', postId), {
    content: text,
    updatedAt: serverTimestamp()
  });
}

export async function publishDiceRoll(partyId, user, character, notation, modifier, label, { rollerName } = {}) {
  const name = String(rollerName || character?.name || '').trim();
  if (!name) {
    throw new Error('Indica quién tira los dados o selecciona un personaje activo.');
  }
  const roller = character || { name, type: 'Heroe' };
  const roll = rollDice(notation, modifier);
  const snapshot = character
    ? buildCharacterSnapshot(character)
    : { name, type: 'Heroe' };
  await publishPost(partyId, {
    type: 'dice',
    authorId: user.uid,
    rollLabel: label.trim(),
    roll,
    content: formatRollResult(name, roll, label),
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
