import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
// 1. Add the Functions import
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

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

// Initialize Services
const db = initializeFirestore(app, {}, "default"); 
const auth = getAuth(app);
const storage = getStorage(app);

// 2. Initialize Functions with the region where your functions are deployed (e.g., 'us-east1')
const functions = getFunctions(app, 'us-east1'); // Adjust region as needed

// 3. Export everything including 'functions'
export { app, db, db as firestore, auth, storage, functions };