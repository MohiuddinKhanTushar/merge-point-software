import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    doc, 
    setDoc, 
    deleteDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function handleSignup(e) {
    e.preventDefault();
    
    const email = document.getElementById('signup-email').value.toLowerCase().trim();
    const password = document.getElementById('signup-password').value;
    const errorBox = document.getElementById('error-box');

    try {
        // 1. Check if an invitation exists for this email
        const inviteQuery = query(collection(db, "invites"), where("email", "==", email));
        const inviteSnap = await getDocs(inviteQuery);

        if (inviteSnap.empty) {
            showError("No invitation found for this email. Please contact your admin.");
            return;
        }

        const inviteData = inviteSnap.docs[0].data();
        const inviteDocId = inviteSnap.docs[0].id;

        // 2. Create the Auth Account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 3. Update the Auth Profile (So user.displayName works immediately)
        // We use the name defined by the admin during the invite process
        await updateProfile(user, {
            displayName: inviteData.name || ""
        });

        // 4. Create the User Document in Firestore using invite data
        await setDoc(doc(db, "users", user.uid), {
            displayName: inviteData.name || "Unnamed User",
            email: email,
            role: inviteData.role,
            orgId: inviteData.orgId,
            createdAt: serverTimestamp()
        });

        // 5. Cleanup: Attempt to delete the invite
        // Note: This may fail depending on your Firestore rules, 
        // which is why it's in a sub-try/catch.
        try {
            await deleteDoc(doc(db, "invites", inviteDocId));
            console.log("Invitation record cleared.");
        } catch (deleteError) {
            console.warn("User created, but invite record remains for admin cleanup.");
        }

        // 6. Success! Redirect to dashboard
        window.location.href = 'index.html';

    } catch (error) {
        console.error("Signup Error:", error);
        showError(error.message);
    }
}

function showError(msg) {
    const errorBox = document.getElementById('error-box');
    if (errorBox) {
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
    }
}