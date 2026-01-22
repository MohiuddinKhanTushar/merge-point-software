import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRrosmMFU9CBlF4r1yMg6nsd13xO5fFqA",
  authDomain: "merge-point-software.firebaseapp.com",
  projectId: "merge-point-software",
  storageBucket: "merge-point-software.firebasestorage.app",
  messagingSenderId: "63484322159",
  appId: "1:63484322159:web:1a491343c3c0b6b205889a",
  measurementId: "G-3NBB5DGYMB"
};

const app = initializeApp(firebaseConfig);

// CRITICAL CHANGE: We are explicitly naming the database "default" 
// to match the new one you created in europe-west2.
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, "default"); 

const auth = getAuth(app);

export { app, db, auth };