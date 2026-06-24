import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { appUrl } from './app-path.js';

export const BOOTSTRAP_ADMIN_EMAIL = 'cracktopro@gmail.com';

export function isAdmin(profile) {
  return profile?.rol_global === 'Admin';
}

async function ensureUserProfile(user, profile) {
  if (profile) return profile;

  const isBootstrap = user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
  const data = {
    username: user.displayName || user.email?.split('@')[0] || 'Usuario',
    email: user.email || '',
    rol_global: isBootstrap ? 'Admin' : 'User',
    joinedPartyIds: [],
    createdAt: serverTimestamp()
  };
  await setDoc(doc(db, 'users', user.uid), data);
  return { id: user.uid, ...data };
}

async function ensureBootstrapAdmin(user, profile) {
  if (user.email?.toLowerCase() !== BOOTSTRAP_ADMIN_EMAIL) return profile;
  if (profile?.rol_global === 'Admin') return profile;

  await setDoc(doc(db, 'users', user.uid), { rol_global: 'Admin' }, { merge: true });
  return { ...profile, id: user.uid, rol_global: 'Admin' };
}

export async function requireAuth(redirectTo = appUrl('index')) {
  await auth.authStateReady();

  const user = auth.currentUser;
  if (!user) {
    window.location.href = redirectTo;
    throw new Error('No autenticado');
  }

  let profile = await getUserProfile(user.uid);
  profile = await ensureUserProfile(user, profile);
  profile = await ensureBootstrapAdmin(user, profile);
  return { user, profile };
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) return { id: uid, ...snap.data() };
  return null;
}

export async function register(username, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: username });
  const rol_global = email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL ? 'Admin' : 'User';
  await setDoc(doc(db, 'users', cred.user.uid), {
    username,
    email,
    rol_global,
    joinedPartyIds: [],
    createdAt: serverTimestamp()
  });
  return cred.user;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logout() {
  await signOut(auth);
  window.location.href = appUrl('index');
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}
