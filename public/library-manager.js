import { db, auth } from './firebase-config.js';
import { initSidebar, showAlert, showConfirm } from './ui-manager.js';
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
    updateDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Global cache for searching/filtering
let allArchiveData = []; 
let currentProjectId = null; 

/**
 * Main entry point for the RFP Library Page
 */
export function initLibrary() {
    initSidebar();

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser();
        });
    }

    const tableBody = document.getElementById('library-body');
    if (!tableBody) return;

    // Monitor Auth State and fetch based on Org and Role
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            await fetchArchivedBids(user.uid);
        } else {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem;">Please log in.</td></tr>`;
        }
    });

    setupListeners();
}

/**
 * Fetches archived documents based on User Role and Organization
 */
async function fetchArchivedBids(userId) {
    try {
        // 1. Get the user's profile to find their role and orgId
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            console.error("User profile not found.");
            return;
        }

        const userData = userSnap.data();
        const orgId = userData.orgId || 'default-org';
        const userRole = userData.role || 'standard';

        // 2. Build Role-Based Query
        let archiveQuery;
        if (userRole === 'admin' || userRole === 'manager') {
            // Admins see everything in the org
            archiveQuery = query(
                collection(db, "archived_rfps"),
                where("orgId", "==", orgId)
            );
        } else {
            // Standard users only see what they personally archived
            archiveQuery = query(
                collection(db, "archived_rfps"),
                where("orgId", "==", orgId),
                where("ownerId", "==", userId)
            );
        }

        onSnapshot(archiveQuery, (snapshot) => {
            allArchiveData = [];
            snapshot.forEach((doc) => {
                allArchiveData.push({ id: doc.id, ...doc.data() });
            });
            renderLibrary(allArchiveData);
        }, (error) => {
            console.error("Firestore Permission Error:", error);
            const tableBody = document.getElementById('library-body');
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color: #ef4444;">Access Denied. Ensure your profile has the correct permissions.</td></tr>`;
            }
        });

    } catch (err) {
        console.error("Error initializing library fetch:", err);
    }
}

function setupListeners() {
    const searchInput = document.getElementById('library-search');
    const industryFilter = document.getElementById('filter-industry');
    searchInput?.addEventListener('input', () => performFilter());
    industryFilter?.addEventListener('change', () => performFilter());
}

function performFilter() {
    const queryStr = document.getElementById('library-search')?.value.toLowerCase() || "";
    const industry = document.getElementById('filter-industry')?.value || "all";

    const filtered = allArchiveData.filter(item => {
        const matchesSearch = (item.bidName || "").toLowerCase().includes(queryStr) || 
                             (item.client || "").toLowerCase().includes(queryStr);
        const matchesIndustry = industry === 'all' || item.industry === industry;
        return matchesSearch && matchesIndustry;
    });
    renderLibrary(filtered);
}

function renderLibrary(data) {
    const tableBody = document.getElementById('library-body');
    if (!tableBody) return;

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color: #94a3b8;">No archived documents found.</td></tr>`;
        return;
    }

    tableBody.innerHTML = data.map(item => {
        const dateDisplay = item.dateArchived?.toDate ? item.dateArchived.toDate().toLocaleDateString() : 'No Date';
        const statusClass = item.outcome === 'won' ? 'won' : (item.outcome === 'lost' ? 'lost' : 'pending');
        const statusLabel = item.outcome ? item.outcome.toUpperCase() : 'PENDING';

        return `
            <tr>
                <td><strong>${item.bidName || 'Untitled'}</strong></td>
                <td>${item.client || 'N/A'}</td>
                <td><span class="badge">${item.industry || 'General'}</span></td>
                <td>${dateDisplay}</td> 
                <td><span class="status-pill ${statusClass}">${statusLabel}</span></td> 
                <td style="text-align: right;">
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="btn-secondary-outline" style="padding: 4px 8px;" onclick="window.viewProject('${item.id}')">
                            <i data-lucide="eye" style="width:14px; height:14px;"></i> View
                        </button>
                        <button class="btn-secondary-outline" style="padding: 4px 8px;" onclick="window.restoreToActive('${item.id}')">
                            <i data-lucide="rotate-ccw" style="width:14px; height:14px;"></i> Restore
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    if (window.lucide) window.lucide.createIcons();
}

/**
 * MODAL LOGIC - View Details
 */
window.viewProject = (id) => {
    currentProjectId = id;
    const project = allArchiveData.find(p => p.id === id);
    if (!project) return;

    document.getElementById('modal-project-name').innerText = project.bidName || 'Untitled Project';
    document.getElementById('modal-client').innerText = project.client || 'N/A';
    document.getElementById('modal-industry').innerText = project.industry || 'General';
    document.getElementById('modal-text').innerText = project.summary || "No archived text available.";

    const statusDropdown = document.getElementById('modal-status-select');
    if (statusDropdown) {
        statusDropdown.value = project.outcome || 'pending';
    }

    const modal = document.getElementById('archive-modal');
    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
};

window.saveProjectStatus = async () => {
    if (!currentProjectId) return;
    const newStatus = document.getElementById('modal-status-select').value;
    try {
        await updateDoc(doc(db, "archived_rfps", currentProjectId), { outcome: newStatus });
        showAlert("Updated", "Project status has been updated successfully.");
        window.closeArchiveModal();
    } catch (e) {
        console.error("Error updating status:", e);
        showAlert("Error", "Could not update status.");
    }
};

/**
 * RESTORE LOGIC - Moves archive back to bids collection
 */
window.restoreToActive = async (archiveId) => {
    const confirmed = await showConfirm(
        "Restore to Active?", 
        "This project will move back to the Dashboard for further editing.",
        "Restore Project"
    );

    if (confirmed) {
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
                showAlert("Success", "Project restored to active dashboard.");
            }
        } catch (e) {
            console.error("Restore failed:", e);
            showAlert("Error", "Failed to restore project.");
        }
    }
};

window.closeArchiveModal = () => { 
    document.getElementById('archive-modal').style.display = 'none'; 
};

window.onclick = function(event) {
    const modal = document.getElementById('archive-modal');
    if (event.target === modal) modal.style.display = "none";
};

initLibrary();