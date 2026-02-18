import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    setDoc, 
    addDoc, 
    collection, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const signupForm = document.getElementById('signup-form');
const urlParams = new URLSearchParams(window.location.search);
const inviteToken = urlParams.get('token'); // e.g. ?token=XYZ123

let inviteData = null;

// 1. Check for Invitation on Load
async function checkInvite() {
    if (inviteToken) {
        const inviteRef = doc(db, "invites", inviteToken);
        const inviteSnap = await getDoc(inviteRef);

        if (inviteSnap.exists()) {
            inviteData = inviteSnap.data();
            
            // UI Adjustments for Employee
            document.getElementById('signup-title').innerText = "Join " + (inviteData.orgName || "your team");
            document.getElementById('signup-subtitle').innerText = "Set up your personal account";
            document.getElementById('company-field-group').style.display = "none";
            document.getElementById('submit-btn').innerText = "Join Workspace";
            document.getElementById('email').value = inviteData.email;
            document.getElementById('email').disabled = true; // Force use of invited email
        } else {
            alert("This invitation link is invalid or has expired.");
            window.location.href = 'login.html';
        }
    }
}
checkInvite();

// 2. Handle Registration
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const fullName = document.getElementById('user-name').value;
    const companyName = document.getElementById('company-name').value;

    try {
        // Create Firebase Auth User
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        let finalOrgId = "";
        let finalRole = "";

        if (inviteData) {
            // SCENARIO A: Joining an existing company
            finalOrgId = inviteData.orgId;
            finalRole = inviteData.role; // 'standard' or 'manager'
            
            // Optional: Delete the invite token so it can't be reused
            // await deleteDoc(doc(db, "invites", inviteToken));
        } else {
            // SCENARIO B: Creating a brand new company (Admin)
            if (!companyName) throw new Error("Company Name is required for new accounts.");
            
            const orgRef = await addDoc(collection(db, "organizations"), {
                name: companyName,
                createdAt: serverTimestamp(),
                ownerUid: user.uid
            });
            
            finalOrgId = orgRef.id;
            finalRole = "admin";
        }

        // 3. Create the User Profile in Firestore
        await setDoc(doc(db, "users", user.uid), {
            displayName: fullName,
            email: email,
            role: finalRole,
            orgId: finalOrgId,
            createdAt: serverTimestamp()
        });

        window.location.href = 'index.html';

    } catch (error) {
        console.error("Signup Error:", error);
        alert(error.message);
    }
});