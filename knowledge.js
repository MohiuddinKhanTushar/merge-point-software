// 1. Updated Import: Added showConfirm and showAlert
import { initSidebar, showConfirm, showAlert } from './ui-manager.js';
import { storage, db } from './firebase-config.js'; 
import { checkAuthState } from './auth.js'; 
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { 
    collection, addDoc, onSnapshot, query, where, getDocs, 
    serverTimestamp, doc, deleteDoc, updateDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Ensure PDF.js worker is correctly pointed to
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

initSidebar();

const libraryGrid = document.getElementById('library-grid');
const fileInput = document.getElementById('knowledge-file-input');
const progressContainer = document.getElementById('knowledge-progress-container');
const progressFill = document.getElementById('knowledge-progress-fill');
const statusText = document.getElementById('knowledge-status-text');
const uploadTrigger = document.getElementById('knowledge-upload-trigger');
const uploadSection = document.getElementById('knowledge-upload-section');
const categorySelect = document.getElementById('doc-category');

// Global Mapper State
let activeField = null;
let currentMappings = {};
let activeDocId = null;

checkAuthState(async (user) => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data();
        const isAdmin = userData?.role === 'admin';

        const roleEl = document.getElementById('display-role');
        if (roleEl) roleEl.textContent = userData?.role || 'User';

        if (isAdmin && uploadTrigger) {
            uploadTrigger.style.display = 'block';
        }

        loadLibrary(user.uid, isAdmin);
        setupUpload(user.uid);
    }
});

if (uploadTrigger && uploadSection) {
    uploadSection.style.display = 'none';
    uploadTrigger.addEventListener('click', () => {
        uploadSection.style.display = (uploadSection.style.display === 'none') ? 'block' : 'none';
    });
}

/**
 * Helper to delete file from Firebase Storage
 */
async function deleteFileFromStorage(fileUrl) {
    if (!fileUrl) return;
    try {
        const fileRef = ref(storage, fileUrl);
        await deleteObject(fileRef);
        console.log("File deleted from storage bucket.");
    } catch (error) {
        console.error("Storage deletion failed:", error);
    }
}

function setupUpload(userId) {
    if (!fileInput) return;

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const selectedOption = categorySelect.options[categorySelect.selectedIndex];
        const categoryValue = selectedOption.value; 
        const categoryLabel = selectedOption.text;
        const priorityLevel = parseInt(selectedOption.getAttribute('data-priority'));
        const isBranding = ['title-page', 'contact-page'].includes(categoryValue);

        progressContainer.style.display = 'block';
        statusText.innerText = `Preparing ${categoryLabel}...`;

        try {
            if (isBranding) {
                const qB = query(collection(db, "knowledge"), where("ownerId", "==", userId), where("category", "==", categoryValue));
                const existingB = await getDocs(qB);
                for (const d of existingB.docs) {
                    const data = d.data();
                    await deleteFileFromStorage(data.fileUrl);
                    await deleteDoc(doc(db, "knowledge", d.id));
                }
            }

            const q = query(collection(db, "knowledge"), where("ownerId", "==", userId), where("fileName", "==", file.name));
            const versionSnap = await getDocs(q);
            const nextVersion = versionSnap.size + 1;

            const storagePath = `knowledge/${userId}/${isBranding ? 'branding' : 'v'+nextVersion}_${file.name}`;
            const storageRef = ref(storage, storagePath);
            const uploadTask = uploadBytesResumable(storageRef, file);

            uploadTask.on('state_changed', 
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    progressFill.style.width = progress + '%';
                }, 
                (error) => { 
                    console.error(error); 
                    showAlert("Upload Failed", "There was an error uploading your file."); // Replacement
                }, 
                async () => {
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

                    const docRef = await addDoc(collection(db, "knowledge"), {
                        ownerId: userId,
                        fileName: file.name,
                        fileUrl: downloadURL,
                        storagePath: storagePath,
                        version: nextVersion,
                        category: categoryValue,
                        priority: priorityLevel,
                        isOverride: categoryValue === 'update',
                        excludeFromAI: isBranding,
                        status: isBranding ? "ready" : "processing", 
                        uploadedAt: serverTimestamp()
                    });

                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        progressFill.style.width = '0%';
                        uploadSection.style.display = 'none'; 
                        
                        if (categoryValue === 'title-page') {
                            openTemplateMapper(downloadURL, docRef.id);
                        } else {
                            showAlert("Success", `${categoryLabel} successfully updated.`); // Replacement
                        }
                    }, 1000);
                }
            );
        } catch (error) { console.error(error); }
    };
}

function loadLibrary(userId, isAdmin) {
    if (!libraryGrid) return;
    const q = query(collection(db, "knowledge"), where("ownerId", "==", userId));

    onSnapshot(q, (snapshot) => {
        libraryGrid.innerHTML = ''; 
        if (snapshot.empty) {
            libraryGrid.innerHTML = `<div class="loading-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem;"><p>Your library is empty.</p></div>`;
            return;
        }

        snapshot.forEach((snapshotDoc) => {
            const data = snapshotDoc.data();
            const docId = snapshotDoc.id;
            const dateStr = data.uploadedAt?.toDate ? data.uploadedAt.toDate().toLocaleDateString() : 'Active';
            const isTitlePage = data.category === 'title-page';
            
            const tagColors = {
                master: '#4f46e5',
                update: '#059669',
                policy: '#ca8a04',
                'case-study': '#db2777',
                'title-page': '#8b5cf6',
                'contact-page': '#8b5cf6'
            };

            const currentTagColor = tagColors[data.category] || '#64748b';
            const isBranding = data.excludeFromAI === true;

            const cardHtml = `
                <div class="bid-card" id="card-${docId}">
                    <div class="bid-status-row">
                        <span class="status-tag" style="background: ${currentTagColor} !important; color: white !important; border: none !important;">
                            ${data.category.replace('-', ' ').toUpperCase()}
                        </span>
                        <span class="deadline">${dateStr}</span>
                    </div>
                    <div class="bid-info">
                        <h3>${data.fileName}</h3>
                        <p class="client-name">
                            ${isBranding ? '<strong>Format Asset</strong>' : `<strong>v${data.version || 1}</strong> • AI Priority: ${data.priority}`}
                        </p>
                    </div>
                    <div class="bid-footer" style="margin-top: 1.5rem; display: flex; gap: 0.5rem;">
                        ${isTitlePage && isAdmin ? `
                            <button class="btn-outline" style="flex: 2; border-color: #4f46e5; color: #4f46e5;" onclick="window.triggerMapper('${data.fileUrl}', '${docId}')">
                                Map Template
                            </button>
                        ` : ''}
                        <button class="btn-outline" style="flex: 1;" onclick="window.open('${data.fileUrl}', '_blank')">View</button>
                        ${isAdmin ? `
                            <button class="btn-outline delete-btn" style="flex: 1; border-color: #ff4d4d; color: #ff4d4d;" 
                                data-id="${docId}" 
                                data-url="${data.fileUrl}">
                                <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>`;
            libraryGrid.insertAdjacentHTML('beforeend', cardHtml);
        });
        if (window.lucide) lucide.createIcons();
        attachDeleteListeners();
    });
}

function attachDeleteListeners() {
    document.querySelectorAll('.delete-btn').forEach(button => {
        button.onclick = async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const fileUrl = e.currentTarget.getAttribute('data-url');
            
            // 2. Updated: Replaced confirm() with showConfirm()
            const confirmed = await showConfirm(
                "Delete Document?", 
                "Are you sure you want to permanently delete this document and its file? This action cannot be undone."
            );

            if (confirmed) {
                try {
                    await deleteFileFromStorage(fileUrl);
                    await deleteDoc(doc(db, "knowledge", id));
                    console.log("Sync delete successful.");
                } catch (err) { 
                    console.error("Delete sequence failed:", err); 
                    showAlert("Delete Error", "Error deleting document. Check console for details."); // Replacement
                }
            }
        };
    });
}

// --- TEMPLATE MAPPER FUNCTIONS ---

window.triggerMapper = openTemplateMapper;

async function openTemplateMapper(url, docId) {
    activeDocId = docId;
    currentMappings = {};
    document.querySelectorAll('.coord-tag').forEach(t => t.innerText = "Not Set");
    document.getElementById('mapper-modal').style.display = 'block';

    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        
        const canvas = document.getElementById('pdf-canvas');
        const context = canvas.getContext('2d');
        
        const viewport = page.getViewport({ scale: 1.2 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        document.querySelectorAll('.field-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.field-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeField = btn.getAttribute('data-field');
            };
        });

        canvas.onclick = (e) => {
            if (!activeField) return showAlert("Field Required", "Please select a field button on the right first!"); // Replacement
            const rect = canvas.getBoundingClientRect();
            const xPercent = (e.clientX - rect.left) / canvas.width;
            const yPercent = (e.clientY - rect.top) / canvas.height;
            currentMappings[activeField] = { x: xPercent, y: yPercent };
            document.getElementById(`tag-${activeField}`).innerText = "Position Set";
            
            context.fillStyle = "#4f46e5";
            context.beginPath();
            context.arc(e.clientX - rect.left, e.clientY - rect.top, 5, 0, Math.PI * 2);
            context.fill();
        };
    } catch (err) {
        console.error("PDF Mapping Error:", err);
        showAlert("Error", "Failed to load PDF preview."); // Replacement
    }
}

document.getElementById('save-mapping-btn').onclick = async () => {
    if (Object.keys(currentMappings).length < 3) {
        return showAlert("Incomplete Mapping", "Please set positions for all 3 fields before saving."); // Replacement
    }
    
    const fontSettings = {
        family: document.getElementById('map-font-family').value,
        size: parseInt(document.getElementById('map-font-size').value) || 20
    };

    try {
        await updateDoc(doc(db, "knowledge", activeDocId), { 
            mapping: currentMappings,
            fontStyle: fontSettings
        });
        showAlert("Mapping Saved", "Template Mapping & Styles have been successfully saved!"); // Replacement
        document.getElementById('mapper-modal').style.display = 'none';
    } catch (e) {
        showAlert("Save Error", "Error saving mapping: " + e.message); // Replacement
    }
};

document.getElementById('close-mapper').onclick = () => document.getElementById('mapper-modal').style.display = 'none';