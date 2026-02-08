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

    try {
        await updateDoc(doc(db, "bids", bidId), { sections: updatedSections });
        
        // Notify Bidder
        await addDoc(collection(db, "notifications"), {
            recipientId: currentBidData.ownerId,
            recipientEmail: "", // Bidder logic uses UID
            type: "approval",
            message: `Section Approved in ${currentBidData.bidName}`,
            bidId: bidId,
            read: false,
            createdAt: new Date()
        });

        console.log("Section Approved & Notified");
    } catch (e) {
        console.error("Approval failed", e);
    }
});

// FLAG FOR REWRITE
document.getElementById('reject-btn').addEventListener('click', async () => {
    if (activeSectionIndex === null) return alert("Select a question first.");
    
    const updatedSections = [...currentBidData.sections];
    updatedSections[activeSectionIndex].status = 'flagged';

    try {
        await updateDoc(doc(db, "bids", bidId), { sections: updatedSections });
        
        // Notify Bidder
        await addDoc(collection(db, "notifications"), {
            recipientId: currentBidData.ownerId,
            recipientEmail: "",
            type: "flag",
            message: `Section Flagged for Rewrite: ${currentBidData.bidName}`,
            bidId: bidId,
            read: false,
            createdAt: new Date()
        });

        alert("Marked for rewrite. The bidder will be notified.");
    } catch (e) {
        console.error("Flagging failed", e);
    }
});

// FINALIZE ENTIRE TENDER
document.getElementById('finalize-bid-btn').addEventListener('click', async () => {
    const confirmFinal = confirm("Are you sure? This will move the tender to the RFP Library (Archive) as 'Completed'.");
    if (confirmFinal) {
        try {
            await updateDoc(doc(db, "bids", bidId), { 
                status: 'completed',
                completedAt: new Date()
            });

            // Notify Bidder of completion
            await addDoc(collection(db, "notifications"), {
                recipientId: currentBidData.ownerId,
                type: "completion",
                message: `Tender Finalized: ${currentBidData.bidName}`,
                bidId: bidId,
                read: false,
                createdAt: new Date()
            });

            window.location.href = 'archive.html';
        } catch (e) {
            alert("Error finalizing: " + e.message);
        }
    }
});