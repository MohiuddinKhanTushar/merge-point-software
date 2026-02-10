import { initSidebar, showConfirm, showAlert } from './ui-manager.js';
import { db, auth, app } from './firebase-config.js'; 
import { checkAuthState, logoutUser } from './auth.js';
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    addDoc, 
    doc, 
    getDoc,
    getDocs, 
    deleteDoc, 
    serverTimestamp,
    Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- STORAGE & FUNCTIONS IMPORTS ---
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Initialize Sidebar and Services
initSidebar();
const firestore = db;
const storage = getStorage(app);

// CRITICAL: Set region to us-east1 to match backend deployment
const functions = getFunctions(app, "us-east1"); 

let selectedFile = null; 

// Protect the page
checkAuthState((user) => {
    console.log("Welcome, user:", user.uid);
    if (document.querySelector('.bids-grid')) {
        loadActiveBids(user.uid);
    }
});

// Hook up Logout
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

// 1. Handle File Selection UI
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            selectedFile = files[0];
            fileList.innerHTML = `<p><strong>Selected:</strong> ${selectedFile.name}</p>`;
        }
    });
}

// 2. Main Creation Logic
async function handleCreateBid() {
    const user = auth.currentUser;
    const buyerName = document.getElementById('buyer-name')?.value;
    const deadlineValue = document.getElementById('tender-deadline-input')?.value;

    if (!user) return showAlert("Auth Error", "Please log in first!");
    if (!selectedFile) return showAlert("Missing File", "Please select a tender document first.");
    if (!buyerName) return showAlert("Missing Info", "Please enter the Buyer Organisation.");

    const progressContainer = document.getElementById('progress-container');
    const statusText = document.getElementById('status-text');
    if (progressContainer) progressContainer.style.display = 'block';

    try {
        // STEP A: Verify Knowledge Base
        if (statusText) statusText.innerText = "Verifying Knowledge Base...";
        const hasMasterDoc = await checkMasterDocument(user.uid);
        if (!hasMasterDoc) {
            showAlert("Action Required", "Please upload your Company Master Document in the Knowledge Base first.");
            window.location.href = 'knowledge.html';
            return;
        }

        // STEP B: Generate unique filename and upload
        if (statusText) statusText.innerText = "Uploading tender document...";
        
        const timestamp = Date.now();
        const cleanName = selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_'); 
        const uniqueFileName = `${timestamp}_${cleanName}`;
        
        const storagePath = `tenders/${user.uid}/${uniqueFileName}`;
        const fileRef = ref(storage, storagePath);
        
        const uploadResult = await uploadBytes(fileRef, selectedFile);
        const downloadUrl = await getDownloadURL(uploadResult.ref);

        // STEP C: Create Firestore Record
        if (statusText) statusText.innerText = "Initializing project...";
        const deadlineDate = deadlineValue ? Timestamp.fromDate(new Date(deadlineValue)) : serverTimestamp();

        const bidDoc = await addDoc(collection(firestore, "bids"), {
            bidName: selectedFile.name.split('.')[0], 
            client: buyerName,
            deadline: deadlineDate, 
            status: "scoping",
            progress: 10, 
            ownerId: user.uid,
            createdAt: serverTimestamp(),
            fileName: uniqueFileName, 
            pdfUrl: downloadUrl 
        });

        // STEP D: Trigger AI Analysis
        if (statusText) statusText.innerText = "AI is extracting mandatory questions...";
        const analyzeTender = httpsCallable(functions, 'analyzeTenderDocument');
        
        const result = await analyzeTender({ 
            bidId: bidDoc.id,
            documentUrl: downloadUrl, 
            fileName: uniqueFileName 
        });

        if (result.data && result.data.success) {
            if (statusText) statusText.innerText = "Analysis Complete! Opening Workspace...";
            setTimeout(() => {
                window.location.href = `workspace.html?id=${bidDoc.id}`;
            }, 1000);
        } else {
            const errorMsg = result.data?.error || "AI Analysis failed.";
            throw new Error(errorMsg);
        }

    } catch (e) { 
        console.error("Error creating bid: ", e); 
        showAlert("Error", "Failed to create bid: " + e.message);
        if (progressContainer) progressContainer.style.display = 'none';
    }
}
window.handleCreateBid = handleCreateBid;

// 3. UI Helpers
function resetUploadForm() {
    selectedFile = null;
    if (document.getElementById('file-input')) document.getElementById('file-input').value = "";
    if (document.getElementById('file-list')) document.getElementById('file-list').innerHTML = "";
    if (document.getElementById('buyer-name')) document.getElementById('buyer-name').value = "";
    if (document.getElementById('tender-deadline-input')) document.getElementById('tender-deadline-input').value = "";
    const pc = document.getElementById('progress-container');
    if (pc) pc.style.display = 'none';
}

function toggleUpload() {
    const section = document.getElementById('upload-section');
    const triggerBtn = document.getElementById('main-upload-trigger');
    if (!section || !triggerBtn) return;

    if (section.style.display === "none" || section.style.display === "") {
        section.style.display = "block";
        triggerBtn.innerHTML = '<i data-lucide="x"></i> Cancel Upload';
    } else {
        section.style.display = "none";
        triggerBtn.innerHTML = '<i data-lucide="sparkles"></i> Create New RFP Response';
        resetUploadForm();
    }
    if (window.lucide) lucide.createIcons();
}
window.toggleUpload = toggleUpload;

// 4. Load Active Bids
function loadActiveBids(userId) {
    const bidsGrid = document.querySelector('.bids-grid');
    if (!bidsGrid) return;

    const bidsQuery = query(
        collection(firestore, "bids"), 
        where("ownerId", "==", userId),
        where("status", "in", ["drafting", "review", "scoping", "approved"])
    );

    onSnapshot(bidsQuery, (snapshot) => {
        if (snapshot.empty) {
            bidsGrid.innerHTML = "<p>No active bids found. Try creating one!</p>";
            return;
        }

        let combinedHtml = "";
        snapshot.forEach((doc) => {
            const bid = doc.data();
            const bidId = doc.id;
            
            let daysLeft = "TBD";
            try {
                if (bid.deadline && typeof bid.deadline.toDate === 'function') {
                    const diff = bid.deadline.toDate() - new Date();
                    daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
                }
            } catch (e) { console.error("Date error:", e); }

            combinedHtml += `
                <div class="bid-card" id="${bidId}">
                    <div class="bid-status-row">
                        <span class="status-tag ${bid.status}">${bid.status.replace('-', ' ')}</span>
                        <span class="deadline">${daysLeft === "TBD" ? "No Deadline" : "Due in " + daysLeft + " days"}</span>
                    </div>
                    <h3>${bid.bidName || 'Untitled Project'}</h3>
                    <p class="client-name">${bid.client || 'Unknown Client'}</p>
                    <div class="progress-container-mini">
                        <div class="progress-label">
                            <span>AI Content Ready</span>
                            <span>${bid.progress || 0}%</span>
                        </div>
                        <div class="progress-bar-mini">
                            <div class="fill" style="width: ${bid.progress || 0}%;"></div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 1rem;">
                        <button class="btn-outline" style="flex: 1;" onclick="window.location.href='/workspace.html?id=${bidId}'">Open Workspace</button>
                        
                        <button class="btn-secondary-outline" title="Archive Bid" onclick="archiveBid('${bidId}')" style="width: 42px; padding: 0; display: flex; align-items: center; justify-content: center;">
                            <i data-lucide="archive" style="width: 18px; height: 18px;"></i>
                        </button>

                        <button class="btn-secondary-outline delete-btn-hover" title="Delete Permanent" onclick="deleteBid('${bidId}')" style="width: 42px; padding: 0; display: flex; align-items: center; justify-content: center; color: #ef4444;">
                            <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        bidsGrid.innerHTML = combinedHtml;
        if (window.lucide) lucide.createIcons({ root: bidsGrid });
    });
}

// 5. Knowledge Check
async function checkMasterDocument(userId) {
    const q = query(
        collection(db, "knowledge"), 
        where("ownerId", "==", userId),
        where("status", "in", ["ready", "processing"])
    );
    const snap = await getDocs(q);
    return !snap.empty; 
}

// 6. Archive Logic
async function archiveBid(bidId) {
    const confirmed = await showConfirm(
        "Archive Project?", 
        "This will move the project to your RFP Library.",
        "Archive"
    );

    if (confirmed) {
        try {
            const bidRef = doc(firestore, "bids", bidId);
            const bidSnap = await getDoc(bidRef);

            if (bidSnap.exists()) {
                await addDoc(collection(firestore, "archived_rfps"), {
                    ...bidSnap.data(),
                    dateArchived: serverTimestamp()
                });
                await deleteDoc(bidRef);
            }
        } catch (error) { 
            console.error("Archive error:", error); 
            showAlert("Error", "Could not archive the project.");
        }
    }
}
window.archiveBid = archiveBid;

// 7. Permanent Delete Logic
async function deleteBid(bidId) {
    const confirmed = await showConfirm(
        "Delete Project Permanently?", 
        "This will delete the AI analysis and the uploaded PDF from storage. This cannot be undone.",
        "Delete"
    );

    if (confirmed) {
        try {
            const user = auth.currentUser;
            if (!user) return;

            const bidRef = doc(firestore, "bids", bidId);
            const bidSnap = await getDoc(bidRef);

            if (bidSnap.exists()) {
                const data = bidSnap.data();
                const fileName = data.fileName;

                // 1. Delete from Firebase Storage
                if (fileName) {
                    try {
                        const storagePath = `tenders/${user.uid}/${fileName}`;
                        const fileRef = ref(storage, storagePath);
                        await deleteObject(fileRef);
                    } catch (storageErr) {
                        console.warn("Storage deletion failed:", storageErr);
                    }
                }

                // 2. Delete from Firestore
                await deleteDoc(bidRef);
                console.log("Firestore document deleted");
            }
        } catch (error) { 
            console.error("Delete error:", error); 
            showAlert("Error", "Failed to delete project: " + error.message);
        }
    }
}
window.deleteBid = deleteBid;