import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-analytics.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot,
  collectionGroup
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCGs_4B_5NsDiGDaolcTHCKmh0To-wAuLw',
  authDomain: 'swrp-f623e.firebaseapp.com',
  projectId: 'swrp-f623e',
  storageBucket: 'swrp-f623e.firebasestorage.app',
  messagingSenderId: '307762971015',
  appId: '1:307762971015:web:075af76ffdfa5898ab5322',
  measurementId: 'G-K5RZT7Z849'
};

const app = initializeApp(firebaseConfig);
const analytics = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? getAnalytics(app)
  : null;
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export {
  app,
  analytics,
  auth,
  db,
  storage,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot,
  collectionGroup,
  ref,
  uploadBytes,
  getDownloadURL
};
