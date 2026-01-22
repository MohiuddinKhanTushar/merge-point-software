import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRrosmMFU9CBlF4r1yMg6nsd13xO5fFqA",
  authDomain: "merge-point-software.firebaseapp.com",
  projectId: "merge-point-software",
  storageBucket: "merge-point-software.firebasestorage.app",
  messagingSenderId: "63484322159",
  appId: "1:63484322159:web:1a491343c3c0b6b205889a",
  measurementId: "G-3NBB5DGYMB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with your specific region settings
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, "default"); 

// Initialize Auth
const auth = getAuth(app);

// Initialize Storage (Crucial for Knowledge Base uploads)
const storage = getStorage(app);

// Option 2: Export both 'db' and 'firestore' as the same object.
// This prevents errors in older files while supporting your new code.
export { app, db, db as firestore, auth, storage };