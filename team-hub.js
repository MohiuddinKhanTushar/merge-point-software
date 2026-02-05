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

/**
 * 1. INITIALIZATION
 * Ensures sidebar toggle and persistence work immediately
 */
initSidebar();

const tableBody = document.getElementById('review-table-body');
const pendingCountEl = document.getElementById('pending-count');

/**
 * 2. AUTH GUARD
 * Verifies user session before attempting to load data
 */
checkAuthState((user) => {
    if (user) {
        console.log("Team Hub active for Manager:", user.email);
        
        // Update visual role in sidebar
        const roleEl = document.getElementById('display-role');
        if (roleEl) roleEl.textContent = "Manager";

        loadReviewQueue();
    } else {
        window.location.href = 'login.html';
    }
});

/**
 * 3. DATA LOADING & ERROR HANDLING
 */
function loadReviewQueue() {
    if (!tableBody) return;

    try {
        const q = query(
            collection(db, "tenders"), 
            where("status", "==", "review"), 
            orderBy("createdAt", "desc")
        );

        onSnapshot(q, (snapshot) => {
            renderTable(snapshot);
        }, (error) => {
            console.warn("Firestore access issue, showing Demo Data:", error);
            renderTable(null); 
        });
    } catch (err) {
        console.warn("Setup error, showing Demo Data:", err);
        renderTable(null);
    }
}

/**
 * 4. TABLE RENDERING
 * Cleaned up to match new alignment CSS and remove double-dots
 */
function renderTable(snapshot) {
    tableBody.innerHTML = '';

    // --- DEMO FALLBACK ---
    if (!snapshot || snapshot.empty) {
        const exampleTender = {
            id: "demo-nhs-2026",
            bidName: "NHS Digital Transformation Framework",
            client: "NHS England",
            submittedBy: "Sarah Jenkins",
            date: "05/02/2026",
            deadline: "15/03/2026"
        };

        const demoRow = `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="display:inline;">${exampleTender.bidName}</strong> 
                        <span style="font-size: 0.65rem; background: #fee2e2; color: #ef4444; padding: 2px 6px; border-radius: 4px; font-weight: 700; flex-shrink: 0;">DEMO</span>
                    </div>
                </td>
                <td>
                    <strong>${exampleTender.client}</strong>
                    <small>By: ${exampleTender.submittedBy}</small>
                </td>
                <td style="color: #64748b;">${exampleTender.date}</td>
                <td>
                    <span class="urgent">
                        <span style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%; display: inline-block;"></span>
                        ${exampleTender.deadline}
                    </span>
                </td>
                <td style="text-align: right;">
                    <button class="btn-review" onclick="navigateToReview('${exampleTender.id}')">
                        <i data-lucide="eye" style="width:16px; height:16px;"></i>
                        <span>Review</span>
                    </button>
                </td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', demoRow);
        if (pendingCountEl) pendingCountEl.textContent = "1";
        if (window.lucide) lucide.createIcons();
        return;
    }

    // --- REAL DATA RENDERING ---
    let count = 0;
    snapshot.forEach((snapshotDoc) => {
        count++;
        const tender = snapshotDoc.data();
        const tenderId = snapshotDoc.id;
        
        const submittedDate = tender.createdAt?.toDate ? tender.createdAt.toDate().toLocaleDateString('en-GB') : 'N/A';
        const deadlineDate = tender.deadline?.toDate ? tender.deadline.toDate().toLocaleDateString('en-GB') : 'N/A';

        const rowHtml = `
            <tr>
                <td><strong>${tender.bidName || 'Untitled Bid'}</strong></td>
                <td>
                    <strong>${tender.client || 'General Buyer'}</strong>
                    <small>Submitted for Review</small>
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

/**
 * 5. NAVIGATION
 */
window.navigateToReview = function(tenderId) {
    window.location.href = `review-workspace.html?id=${tenderId}`;
};