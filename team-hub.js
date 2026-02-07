import { initSidebar } from './ui-manager.js';
import { db } from './firebase-config.js'; 
import { checkAuthState } from './auth.js'; 
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

initSidebar();

const tableBody = document.getElementById('review-table-body');
const pendingCountEl = document.getElementById('pending-count');

checkAuthState((user) => {
    if (user) {
        console.log("Team Hub active for Manager:", user.email);
        const roleEl = document.getElementById('display-role');
        if (roleEl) roleEl.textContent = "Manager";

        // Pass the user email to filter the queue
        loadReviewQueue(user.email);
    } else {
        window.location.href = 'login.html';
    }
});

function loadReviewQueue(managerEmail) {
    if (!tableBody) return;

    try {
        // FIXED: Changed collection from "tenders" to "bids"
        // ADDED: Filter for assignedReviewer matching the logged-in manager
        const q = query(
            collection(db, "bids"), 
            where("status", "==", "review"),
            where("assignedReviewer", "==", managerEmail)
        );

        onSnapshot(q, (snapshot) => {
            renderTable(snapshot);
        }, (error) => {
            console.warn("Firestore access issue:", error);
            renderTable(null); 
        });
    } catch (err) {
        console.warn("Setup error:", err);
        renderTable(null);
    }
}

function renderTable(snapshot) {
    tableBody.innerHTML = '';

    // --- DEMO FALLBACK ---
    if (!snapshot || snapshot.empty) {
        const demoRow = `
            <tr>
                <td colspan="5" style="text-align:center; padding: 40px; color: #64748b;">
                    <i data-lucide="inbox" style="width:48px; height:48px; margin-bottom:10px; opacity:0.5;"></i>
                    <p>No tenders currently awaiting your review.</p>
                </td>
            </tr>
        `;
        tableBody.innerHTML = demoRow;
        if (pendingCountEl) pendingCountEl.textContent = "0";
        if (window.lucide) lucide.createIcons();
        return;
    }

    // --- REAL DATA RENDERING ---
    let count = 0;
    snapshot.forEach((snapshotDoc) => {
        count++;
        const tender = snapshotDoc.data();
        const tenderId = snapshotDoc.id;
        
        // Use submittedAt (from workspace) or extractedAt as fallback
        const dateObj = tender.submittedAt || tender.extractedAt;
        const submittedDate = dateObj?.toDate ? dateObj.toDate().toLocaleDateString('en-GB') : 'Recently';
        const deadlineDate = tender.deadline?.toDate ? tender.deadline.toDate().toLocaleDateString('en-GB') : 'N/A';

        const rowHtml = `
            <tr>
                <td><strong>${tender.bidName || 'Untitled Bid'}</strong></td>
                <td>
                    <strong>${tender.client || 'General Buyer'}</strong>
                    <br><small style="color: #6366f1;">Pending Review</small>
                </td>
                <td style="color: #64748b;">${submittedDate}</td>
                <td>
                    <span class="urgent">
                        <span style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%; display: inline-block;"></span>
                        ${deadlineDate}
                    </span>
                </td>
                <td style="text-align: right;">
                    <button class="btn-review" onclick="navigateToReview('${tenderId}')">
                        <i data-lucide="eye" style="width:16px; height:16px;"></i>
                        <span>Review</span>
                    </button>
                </td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', rowHtml);
    });

    if (pendingCountEl) pendingCountEl.textContent = count;
    if (window.lucide) lucide.createIcons();
}

window.navigateToReview = function(tenderId) {
    window.location.href = `review-workspace.html?id=${tenderId}`;
};