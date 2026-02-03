import { initSidebar } from './ui-manager.js';
import { storage, db } from './firebase-config.js'; 
// NEW: Import our gatekeeper
import { checkAuthState } from './auth.js'; 
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { 
    collection, 
    addDoc, 
    onSnapshot, 
    query, 
    where, 
    getDocs, 
    serverTimestamp,
    doc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Initialize Sidebar
initSidebar();

// 1. Selectors
const libraryGrid = document.getElementById('library-grid');
const fileInput = document.getElementById('knowledge-file-input');
const progressContainer = document.getElementById('knowledge-progress-container');
const progressFill = document.getElementById('knowledge-progress-fill');
const statusText = document.getElementById('knowledge-status-text');
const uploadTrigger = document.getElementById('knowledge-upload-trigger');
const uploadSection = document.getElementById('knowledge-upload-section');

// 2. Auth Guard & Initialization
// This protects the page and wires up the Logout button automatically
checkAuthState((user) => {
    if (user) {
        console.log("Knowledge Base active for:", user.email);
        loadLibrary(user.uid);
        setupUpload(user.uid);
    }
});

// 3. Toggle Upload Section
if (uploadTrigger && uploadSection) {
    uploadSection.style.display = 'none';
    uploadTrigger.addEventListener('click', () => {
        uploadSection.style.display = (uploadSection.style.display === 'none') ? 'block' : 'none';
    });
}

// 4. Handle Upload Logic with Versioning
function setupUpload(userId) {
    if (!fileInput) return;

    // Use a fresh listener to prevent multiple triggers
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        progressContainer.style.display = 'block';
        statusText.innerText = "Checking document versions...";

        try {
            // 4a. Versioning Logic
            const q = query(
                collection(db, "knowledge"), 
                where("ownerId", "==", userId),
                where("fileName", "==", file.name)
            );
            const versionSnap = await getDocs(q);
            const nextVersion = versionSnap.size + 1;

            statusText.innerText = `Uploading Version ${nextVersion}...`;

            // 4b. Storage Upload
            const storageRef = ref(storage, `knowledge/${userId}/v${nextVersion}_${file.name}`);
            const uploadTask = uploadBytesResumable(storageRef, file);

            uploadTask.on('state_changed', 
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    progressFill.style.width = progress + '%';
                }, 
                (error) => {
                    console.error("Upload error:", error);
                    alert("Upload failed.");
                }, 
                async () => {
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

                    // 4c. Firestore Record
                    await addDoc(collection(db, "knowledge"), {
                        ownerId: userId,
                        orgId: "default-org", 
                        fileName: file.name,
                        fileUrl: downloadURL,
                        version: nextVersion,
                        status: "processing", 
                        type: "master-document",
                        uploadedAt: serverTimestamp()
                    });

                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        progressFill.style.width = '0%';
                        uploadSection.style.display = 'none'; 
                        alert(`Master Document v${nextVersion} uploaded successfully! AI is now processing chunks.`);
                    }, 1000);
                }
            );
        } catch (error) {
            console.error("Setup error:", error);
        }
    };
}

// 5. Load Library
function loadLibrary(userId) {
    if (!libraryGrid) return;

    const q = query(collection(db, "knowledge"), where("ownerId", "==", userId));

    onSnapshot(q, (snapshot) => {
        libraryGrid.innerHTML = ''; 

        if (snapshot.empty) {
            libraryGrid.innerHTML = `
                <div class="loading-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                    <p>Your library is empty. Upload a master document to get started.</p>
                </div>`;
            return;
        }

        snapshot.forEach((snapshotDoc) => {
            const data = snapshotDoc.data();
            const docId = snapshotDoc.id; // Capture ID for deletion
            const dateStr = data.uploadedAt?.toDate ? data.uploadedAt.toDate().toLocaleDateString() : 'New Document';
            
            // MODIFIED cardHtml: Added flex layout to footer and the delete button
            const cardHtml = `
                <div class="bid-card">
            <div class="bid-status-row">
                <span class="status-tag won">v${data.version || 1} ${data.status || 'READY'}</span>
                <span class="deadline">${dateStr}</span>
            </div>
            <div class="bid-info">
                <h3>${data.fileName}</h3>
                <p class="client-name">Master Reference</p>
            </div>
            <div class="bid-footer" style="margin-top: 1.5rem; display: flex; gap: 10px;">
                <button class="btn-outline" style="flex: 1;" onclick="window.open('${data.fileUrl}', '_blank')">
                    View Document
                </button>
                
                <button class="btn-secondary-outline btn-danger-hover" title="Delete Document" 
                        onclick="window.deleteKnowledgeDoc('${docId}', '${data.fileName}')"
                        style="width: 42px; padding: 0; justify-content: center;">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        </div>`;
            libraryGrid.insertAdjacentHTML('beforeend', cardHtml);
        });

        // Attach listeners to all delete buttons
        document.querySelectorAll('.delete-btn').forEach(button => {
            button.onclick = async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                if (confirm("Are you sure you want to delete this master document? This will remove all AI context associated with it.")) {
                    try {
                        // This single line triggers your backend Cloud Function fix!
                        await deleteDoc(doc(db, "knowledge", id));
                        console.log("Firestore doc deleted, triggering backend cleanup...");
                    } catch (err) {
                        console.error("Error deleting document:", err);
                        alert("Failed to delete document.");
                    }
                }
            };
        });

        if (window.lucide) lucide.createIcons({ root: libraryGrid });
    });
}

// 6. Delete Function Logic
async function deleteKnowledgeDoc(docId, fileName) {
    // Using a simple confirm for now; you can use your custom modal later
    if (confirm(`Are you sure you want to permanently delete "${fileName}"? This will remove all AI training data for this file.`)) {
        try {
            console.log("Deleting document:", docId);
            await deleteDoc(doc(db, "knowledge", docId));
            // The Cloud Function cleanupKnowledgeBase will handle Storage and Pinecone automatically
        } catch (error) {
            console.error("Error deleting document:", error);
            alert("Failed to delete document: " + error.message);
        }
    }
}

// Expose to window so the onclick works
window.deleteKnowledgeDoc = deleteKnowledgeDoc;