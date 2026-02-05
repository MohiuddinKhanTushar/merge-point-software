import { initSidebar } from './ui-manager.js';
import { storage, db } from './firebase-config.js'; 
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
const categorySelect = document.getElementById('doc-category');

// 2. Auth Guard & Initialization
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

// 4. Handle Upload Logic
function setupUpload(userId) {
    if (!fileInput) return;

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const selectedOption = categorySelect.options[categorySelect.selectedIndex];
        const categoryValue = selectedOption.value; 
        const categoryLabel = selectedOption.text;
        const priorityLevel = parseInt(selectedOption.getAttribute('data-priority'));

        progressContainer.style.display = 'block';
        statusText.innerText = `Preparing ${categoryLabel}...`;

        try {
            const q = query(
                collection(db, "knowledge"), 
                where("ownerId", "==", userId),
                where("fileName", "==", file.name)
            );
            const versionSnap = await getDocs(q);
            const nextVersion = versionSnap.size + 1;

            statusText.innerText = `Uploading Version ${nextVersion}...`;

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

                    // SAVING METADATA: Including priority and isOverride for the AI
                    await addDoc(collection(db, "knowledge"), {
                        ownerId: userId,
                        orgId: "default-org", 
                        fileName: file.name,
                        fileUrl: downloadURL,
                        version: nextVersion,
                        category: categoryValue,
                        priority: priorityLevel,
                        isOverride: categoryValue === 'update', // True for product updates
                        status: "processing", 
                        uploadedAt: serverTimestamp()
                    });

                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        progressFill.style.width = '0%';
                        uploadSection.style.display = 'none'; 
                        alert(`Successfully added to your library as ${categoryLabel}.`);
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
                    <p>Your library is empty. Upload a document to get started.</p>
                </div>`;
            return;
        }

        snapshot.forEach((snapshotDoc) => {
            const data = snapshotDoc.data();
            const docId = snapshotDoc.id;
            const dateStr = data.uploadedAt?.toDate ? data.uploadedAt.toDate().toLocaleDateString() : 'New Document';
            
            let finalCategory = data.category;
            if (!finalCategory && data.type === "master-document") {
                finalCategory = "master";
            } else if (!finalCategory) {
                finalCategory = "unknown";
            }

            const tagColors = {
                master: '#4f46e5',      // Indigo
                update: '#059669',      // Emerald/Green
                policy: '#ca8a04',      // Yellow/Orange
                'case-study': '#db2777' // Pink
            };

            const currentTagColor = tagColors[finalCategory] || '#64748b';
            const displayCategory = finalCategory.replace('-', ' ').toUpperCase();
            
            // Visual enhancement for priority documents
            const isHighPriority = data.priority >= 4;

            const cardHtml = `
                <div class="bid-card ${isHighPriority ? 'priority-card' : ''}" id="card-${docId}">
                    <div class="bid-status-row">
                        <span class="status-tag" style="background: ${currentTagColor} !important; color: white !important; border: none !important;">
                            ${displayCategory}
                        </span>
                        <span class="deadline">${dateStr}</span>
                    </div>
                    <div class="bid-info">
                        <h3>${data.fileName}</h3>
                        <p class="client-name">
                            <strong>v${data.version || 1}</strong> • 
                            AI Priority: ${data.priority || (finalCategory === 'master' ? 1 : 0)}
                            ${isHighPriority ? ' <span style="color:#059669;">● Override Active</span>' : ''}
                        </p>
                    </div>
                    <div class="bid-footer" style="margin-top: 1.5rem; display: flex; gap: 0.5rem;">
                        <button class="btn-outline" style="flex: 3;" onclick="window.open('${data.fileUrl}', '_blank')">
                            View Document
                        </button>
                        <button class="btn-outline delete-btn" style="flex: 1; border-color: #ff4d4d; color: #ff4d4d;" data-id="${docId}">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                </div>`;
            libraryGrid.insertAdjacentHTML('beforeend', cardHtml);
        });

        if (window.lucide) lucide.createIcons({ root: libraryGrid });
        attachDeleteListeners();
    });
}

function attachDeleteListeners() {
    document.querySelectorAll('.delete-btn').forEach(button => {
        button.onclick = async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            if (confirm("Delete this document? This will remove it from the AI's knowledge base.")) {
                try {
                    await deleteDoc(doc(db, "knowledge", id));
                } catch (err) {
                    console.error("Error:", err);
                }
            }
        };
    });
}