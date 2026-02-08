import { initSidebar } from './ui-manager.js';
import { db, auth, app } from './firebase-config.js';
import { checkAuthState } from './auth.js'; 
import { doc, onSnapshot, updateDoc, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Initialize Sidebar
initSidebar();

const urlParams = new URLSearchParams(window.location.search);
const bidId = urlParams.get('id');

let activeSectionIndex = null;
let currentBidData = null;

// GATEKEEPER
checkAuthState((user) => {
    if (user && bidId) {
        const docRef = doc(db, "bids", bidId);

        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                currentBidData = data;
                
                // Update Header
                document.getElementById('bid-title').innerText = `Review: ${data.bidName || "Untitled Project"}`;
                
                renderReviewQuestions(data.sections || []);
                
                if (activeSectionIndex !== null && document.activeElement !== document.getElementById('review-editor')) {
                    const activeSection = data.sections[activeSectionIndex];
                    document.getElementById('review-editor').value = activeSection.draftAnswer || activeSection.aiResponse || "";
                }
            }
        });
    } else if (!bidId) {
        window.location.href = 'team-hub.html';
    }
});

// Render the sidebar list for the Manager
function renderReviewQuestions(sections) {
    const container = document.getElementById('review-questions-list');
    container.innerHTML = "";

    sections.forEach((section, index) => {
        const item = document.createElement('div');
        let statusClass = 'status-pending';
        if (section.status === 'approved') statusClass = 'status-approved';
        if (section.status === 'flagged') statusClass = 'status-flagged';

        item.className = `question-item ${activeSectionIndex === index ? 'active' : ''}`;
        item.innerHTML = `
            <span>${section.question.substring(0, 45)}...</span>
            <div class="status-indicator ${statusClass}"></div>
        `;

        item.onclick = () => {
            activeSectionIndex = index;
            document.getElementById('active-question-text').innerText = section.question;
            document.getElementById('review-editor').value = section.draftAnswer || section.aiResponse || "";
            renderReviewQuestions(sections); 
        };
        container.appendChild(item);
    });
}

// APPROVE SINGLE QUESTION
document.getElementById('approve-single-btn').addEventListener('click', async () => {
    if (activeSectionIndex === null) return alert("Select a question first.");
    
    const updatedSections = [...currentBidData.sections];
    updatedSections[activeSectionIndex].status = 'approved';
    updatedSections[activeSectionIndex].draftAnswer = document.getElementById('review-editor').value;
    updatedSections[activeSectionIndex].managerNotes = "";

    try {
        await updateDoc(doc(db, "bids", bidId), { sections: updatedSections });
        
        await addDoc(collection(db, "notifications"), {
            recipientId: currentBidData.ownerId,
            type: "approval",
            message: `Section Approved in ${currentBidData.bidName}`,
            bidId: bidId,
            read: false,
            createdAt: new Date()
        });
    } catch (e) {
        console.error("Approval failed", e);
    }
});

// FLAG FOR REWRITE
document.getElementById('reject-btn').addEventListener('click', async () => {
    if (activeSectionIndex === null) return alert("Select a question first.");
    
    const notes = prompt("Please provide instructions for the re-write:");
    if (notes === null) return; 

    const updatedSections = [...currentBidData.sections];
    updatedSections[activeSectionIndex].status = 'flagged';
    updatedSections[activeSectionIndex].managerNotes = notes;

    try {
        await updateDoc(doc(db, "bids", bidId), { sections: updatedSections });
        
        await addDoc(collection(db, "notifications"), {
            recipientId: currentBidData.ownerId,
            type: "flag",
            message: `Section Flagged for Rewrite: ${currentBidData.bidName}`,
            bidId: bidId,
            read: false,
            createdAt: new Date()
        });

        alert("Marked for rewrite.");
    } catch (e) {
        console.error("Flagging failed", e);
    }
});

// UPDATED: APPROVE ENTIRE TENDER (Notify User only)
document.getElementById('finalize-bid-btn').addEventListener('click', async () => {
    // 1. Check if all sections are approved
    const allApproved = currentBidData.sections.every(s => s.status === 'approved');
    
    if (!allApproved) {
        return alert("Cannot approve the full tender yet. Some sections are still pending or flagged.");
    }

    const confirmFinal = confirm("All sections are approved! Would you like to notify the user to prepare for final submission?");
    
    if (confirmFinal) {
        try {
            // Update status to 'approved' or 'ready_to_send' so user knows it's done
            await updateDoc(doc(db, "bids", bidId), { 
                status: 'approved',
                managerApprovedAt: new Date()
            });

            // Notify the Bidder/User
            await addDoc(collection(db, "notifications"), {
                recipientId: currentBidData.ownerId,
                type: "full_approval",
                message: `🎉 Great news! ${currentBidData.bidName} has been fully approved. You can now perform the final submission.`,
                bidId: bidId,
                read: false,
                createdAt: new Date()
            });

            alert("User has been notified that the tender is fully approved.");
            window.location.href = 'team-hub.html';
        } catch (e) {
            alert("Error: " + e.message);
        }
    }
});