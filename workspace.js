import { db, auth } from './firebase-config.js';
import { doc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const urlParams = new URLSearchParams(window.location.search);
const bidId = urlParams.get('id');

onAuthStateChanged(auth, (user) => {
    if (user && bidId) {
        const docRef = doc(db, "bids", bidId);

        // ONE SINGLE LISTENER FOR EVERYTHING
        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                
                // 1. Update Text Content
                document.getElementById('bid-title').innerText = data.bidName || "Untitled Project";
                document.getElementById('bid-status').innerText = (data.status || "DRAFTING").toUpperCase();
                document.getElementById('client-name').innerHTML = `<strong>Client:</strong> ${data.client || "Not Specified"}`;
                
                if (data.deadline) {
                    document.getElementById('bid-deadline').innerHTML = `<strong>Due:</strong> ${data.deadline.toDate().toLocaleDateString()}`;
                }

                // 2. Update Editor (if not active)
                if (data.aiDraft && document.activeElement !== document.getElementById('ai-content-editor')) {
                    document.getElementById('ai-content-editor').value = data.aiDraft;
                }

                // 3. RENDER CHECKBOXES (This was moved inside the listener)
                const reqList = document.querySelector('.requirements-list');
                const requirements = data.requirements || { "Security": false, "Scalability": false, "Pricing": false };
                
                reqList.innerHTML = ""; 
                Object.keys(requirements).forEach(req => {
                    const label = document.createElement('label');
                    const isChecked = requirements[req];
                    label.innerHTML = `<input type="checkbox" ${isChecked ? 'checked' : ''} data-req="${req}"> ${req}`;
                    
                    // SAVE LOGIC
                    label.querySelector('input').addEventListener('change', async (e) => {
                        const updatedStatus = e.target.checked;
                        requirements[req] = updatedStatus; // Update local object
                        
                        try {
                            await updateDoc(docRef, { requirements: requirements });
                            console.log(`Saved ${req}: ${updatedStatus}`);
                        } catch (err) {
                            console.error("Checkbox save failed", err);
                        }
                    });
                    reqList.appendChild(label);
                });
            }
        });
    } else if (!user) {
        window.location.href = 'login.html';
    }
});

// Save Button (Main Editor)
document.getElementById('save-bid-btn').addEventListener('click', async () => {
    const content = document.getElementById('ai-content-editor').value;
    const bidRef = doc(db, "bids", bidId);
    try {
        await updateDoc(bidRef, { aiDraft: content });
        alert("Draft saved!");
    } catch (e) {
        console.error("Save failed", e);
    }
});

// MODAL CONTROLS
const modal = document.getElementById('review-modal');
document.getElementById('submit-review-btn').onclick = () => modal.style.display = 'block';
window.closeModal = () => modal.style.display = 'none';

// CONFIRM SUBMIT
document.getElementById('confirm-submit-btn').onclick = async () => {
    const email = document.getElementById('reviewer-email').value;
    if (!email) return alert("Please enter an email");

    const bidRef = doc(db, "bids", bidId);
    try {
        await updateDoc(bidRef, {
            status: "review",
            reviewerEmail: email,
            submittedAt: new Date()
        });
        alert(`Status updated to Review! Reviewer: ${email}`);
        closeModal();
    } catch (e) {
        console.error("Submission failed", e);
    }
};