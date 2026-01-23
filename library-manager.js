import { db, auth } from './firebase-config.js';
import { initSidebar } from './ui-manager.js';
import { logoutUser } from './auth.js';
import { 
    collection, 
    query, 
    where, 
    onSnapshot,
    doc,
    getDoc,
    addDoc,
    deleteDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let allArchiveData = []; // Local cache for searching/filtering

/**
 * Main entry point for the RFP Library Page
 */
export function initLibrary() {
    // 1. Initialize Global UI
    initSidebar();

    // 2. Setup Global Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser();
        });
    }

    const tableBody = document.getElementById('library-body');
    if (!tableBody) return;

    // 3. Auth State & Data Fetching
    auth.onAuthStateChanged((user) => {
        if (user) {
            console.log("Library authenticated for:", user.uid);
            fetchArchivedBids(user.uid);
        } else {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding:2rem;">
                        Please log in to view the library.
                    </td>
                </tr>`;
        }
    });

    // 4. Setup Search and Filter UI listeners
    setupListeners();
}

/**
 * Fetch data from the 'archived_rfps' collection
 */
function fetchArchivedBids(userId) {
    const archiveQuery = query(
        collection(db, "archived_rfps"),
        where("ownerId", "==", userId)
    );

    onSnapshot(archiveQuery, (snapshot) => {
        allArchiveData = [];
        snapshot.forEach((doc) => {
            allArchiveData.push({ id: doc.id, ...doc.data() });
        });
        
        console.log(`Library loaded ${allArchiveData.length} documents.`);
        renderLibrary(allArchiveData);
    }, (error) => {
        console.error("Firestore Archive Error:", error);
    });
}

function setupListeners() {
    const searchInput = document.getElementById('library-search');
    const industryFilter = document.getElementById('filter-industry');

    searchInput?.addEventListener('input', () => performFilter());
    industryFilter?.addEventListener('change', () => performFilter());
}

function performFilter() {
    const queryStr = document.getElementById('library-search').value.toLowerCase();
    const industry = document.getElementById('filter-industry').value;

    const filtered = allArchiveData.filter(item => {
        const matchesSearch = (item.bidName || "").toLowerCase().includes(queryStr) || 
                             (item.client || "").toLowerCase().includes(queryStr);
        const matchesIndustry = industry === 'all' || item.industry === industry;
        return matchesSearch && matchesIndustry;
    });

    renderLibrary(filtered);
}

/**
 * Render rows into the table with View and Restore actions
 */
function renderLibrary(data) {
    const tableBody = document.getElementById('library-body');
    if (!tableBody) return;

    if (data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; padding:2rem; color: #94a3b8;">
                    No archived documents found.
                </td>
            </tr>`;
        return;
    }

    tableBody.innerHTML = data.map(item => {
        const dateDisplay = item.dateArchived?.toDate 
            ? item.dateArchived.toDate().toLocaleDateString() 
            : 'No Date';

        return `
            <tr>
                <td><strong>${item.bidName || 'Untitled'}</strong></td>
                <td>${item.client || 'N/A'}</td>
                <td><span class="badge">${item.industry || 'General'}</span></td>
                <td>${dateDisplay}</td>
                <td style="text-align: right;">
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="btn-secondary-outline" style="padding: 4px 8px;" onclick="window.viewProject('${item.id}')">
                            <i data-lucide="eye" style="width:14px; height:14px;"></i> View
                        </button>
                        <button class="btn-secondary-outline" style="padding: 4px 8px;" title="Restore to Active" onclick="window.restoreToActive('${item.id}')">
                            <i data-lucide="rotate-ccw" style="width:14px; height:14px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

/**
 * RESTORE LOGIC
 * Moves an archived project back to the active 'bids' collection
 */
window.restoreToActive = async (archiveId) => {
    window.showCustomConfirm(
        "Restore to Active?", 
        "This project will move back to your Dashboard for further editing.", 
        async () => {
            try {
                const archiveRef = doc(db, "archived_rfps", archiveId);
                const archiveSnap = await getDoc(archiveRef);

                if (archiveSnap.exists()) {
                    const data = archiveSnap.data();
                    await addDoc(collection(db, "bids"), {
                        ...data,
                        status: "review",
                        deadline: serverTimestamp(), 
                        createdAt: serverTimestamp()
                    });
                    await deleteDoc(archiveRef);
                }
            } catch (e) {
                console.error("Restore failed:", e);
            }
        }
    );
};

/**
 * MODAL LOGIC
 */
window.viewProject = (id) => {
    const project = allArchiveData.find(p => p.id === id);
    if (!project) return;

    document.getElementById('modal-project-name').innerText = project.bidName || 'Untitled Project';
    document.getElementById('modal-client').innerText = project.client || 'N/A';
    document.getElementById('modal-industry').innerText = project.industry || 'General';
    
    const summaryContent = project.summary || "No archived text available for this entry. You can add a 'summary' field to this document in the Firebase Console to see it here.";
    document.getElementById('modal-text').innerText = summaryContent;

    const modal = document.getElementById('archive-modal');
    modal.style.display = 'flex';

    if (window.lucide) window.lucide.createIcons();
};

window.closeArchiveModal = () => {
    document.getElementById('archive-modal').style.display = 'none';
};

window.onclick = function(event) {
    const modal = document.getElementById('archive-modal');
    if (event.target === modal) {
        modal.style.display = "none";
    }
};

// Utility to show our custom confirmation
window.showCustomConfirm = (title, message, onConfirm) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = message;
    
    const actionBtn = document.getElementById('confirm-action-btn');
    
    // We clone the button to strip old event listeners
    const newActionBtn = actionBtn.cloneNode(true);
    actionBtn.parentNode.replaceChild(newActionBtn, actionBtn);
    
    newActionBtn.addEventListener('click', () => {
        onConfirm();
        closeConfirmModal();
    });

    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons({ root: modal });
};

window.closeConfirmModal = () => {
    document.getElementById('confirm-modal').style.display = 'none';
};